import { eq } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { clarifySchema, interpretSchema } from "@/schemas/ai";
import * as assistant from "@/server/ai/assistant";
import { getSttProvider } from "@/server/ai/stt";
import { businessSettings, voiceCommands } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { resolveFlags } from "@/server/lib/flags";
import { body, ok } from "../respond";
import { bizRouter, rateLimit } from "../middleware";

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

export const aiRoutes = bizRouter()
  .get("/interactions", async (c) => ok(c, await assistant.history(c.get("ctx"))))
  .get("/interactions/:id", async (c) => ok(c, await assistant.getInteraction(c.get("ctx"), c.req.param("id"))))
  .post("/interpret", rateLimit("AI_LIMITER", "user"), async (c) => {
    const ctx = c.get("ctx");
    const input = await body(c, interpretSchema);
    let voiceCommandId: string | null = null;
    if (input.voice) {
      voiceCommandId = newId(ctx.now);
      await ctx.db.insert(voiceCommands).values({
        id: voiceCommandId,
        businessId: ctx.businessId,
        userId: ctx.userId,
        transcript: input.text,
        language: input.voice.language ?? null,
        sttProvider: input.voice.provider,
        durationMs: input.voice.durationMs ?? null,
        createdAt: ctx.now,
      });
    }
    return ok(c, await assistant.interpret(ctx, { text: input.text, voiceCommandId }));
  })
  .post("/voice", rateLimit("AI_LIMITER", "user"), async (c) => {
    const ctx = c.get("ctx");
    const settings = await ctx.db.select().from(businessSettings).where(eq(businessSettings.businessId, ctx.businessId)).get();
    if (!resolveFlags(c.env, settings?.featureFlags).VOICE_ENABLED) throw new AppError("FEATURE_DISABLED", "Voice is turned off for your business.");
    const len = Number(c.req.header("content-length") ?? 0);
    if (len > MAX_AUDIO_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "Recording is too long. Keep it under a minute.");
    const form = await c.req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File) || audio.size === 0) throw new AppError("VALIDATION_ERROR", "No audio received.");
    if (audio.size > MAX_AUDIO_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "Recording is too long. Keep it under a minute.");
    const stt = getSttProvider(c.env, ctx.logger);
    if (!stt) throw new AppError("AI_UNAVAILABLE", "Server voice recognition is not configured. Use your browser's microphone or type.");
    const transcript = await stt.transcribe(await audio.arrayBuffer());
    if (!transcript.text) throw new AppError("VALIDATION_ERROR", "I couldn't hear anything. Please try again closer to the phone.");
    const voiceCommandId = newId(ctx.now);
    await ctx.db.insert(voiceCommands).values({
      id: voiceCommandId,
      businessId: ctx.businessId,
      userId: ctx.userId,
      transcript: transcript.text.slice(0, 1000),
      language: transcript.language,
      sttProvider: transcript.provider,
      durationMs: transcript.durationMs,
      createdAt: ctx.now,
    });
    // Audio is not stored — only the transcript.
    return ok(c, await assistant.interpret(ctx, { text: transcript.text, voiceCommandId }));
  })
  .post("/interactions/:id/clarify", async (c) => ok(c, await assistant.clarify(c.get("ctx"), c.req.param("id"), await body(c, clarifySchema))))
  .post("/interactions/:id/confirm", async (c) => ok(c, await assistant.confirm(c.get("ctx"), c.req.param("id"))))
  .post("/interactions/:id/cancel", async (c) => ok(c, await assistant.cancel(c.get("ctx"), c.req.param("id"))));
