/**
 * LLM intent parser (Workers AI). The model only returns structured intent; its output is
 * validated with zod and discarded if invalid. No tools, no DB access.
 */
import { AppError } from "@/server/lib/errors";
import type { Logger } from "@/server/lib/logger";
import { PARSED_INTENT_JSON_SCHEMA, parsedIntentSchema, type ParsedIntent } from "./contract";
import { buildMessages, type PromptContext } from "./prompts/build";

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: "ok" | "error" | "timeout";
}

export interface IntentParser {
  readonly name: string;
  parse(input: string, context: PromptContext, onUsage?: (u: LlmUsage) => void): Promise<ParsedIntent | null>;
}

export class WorkersAIParser implements IntentParser {
  readonly name = "workers-ai";
  constructor(
    private ai: Ai,
    private model: string,
    private logger: Logger,
    private timeoutMs = 8000,
  ) {}

  async parse(input: string, context: PromptContext, onUsage?: (u: LlmUsage) => void): Promise<ParsedIntent | null> {
    const started = Date.now();
    try {
      const run = this.ai.run(this.model as Parameters<Ai["run"]>[0], {
        messages: buildMessages(input, context),
        response_format: { type: "json_schema", json_schema: PARSED_INTENT_JSON_SCHEMA },
        max_tokens: 600,
        temperature: 0,
      } as never) as Promise<unknown>;
      const res = await withTimeout(run, this.timeoutMs);
      onUsage?.({ ...usageOf(res), latencyMs: Date.now() - started, status: "ok" });
      const raw = extractJson(res);
      const parsed = parsedIntentSchema.safeParse(raw);
      if (!parsed.success) {
        this.logger.warn("llm output failed validation", { model: this.model, issues: parsed.error.issues.slice(0, 3).map((i) => i.message), ms: Date.now() - started });
        return null;
      }
      this.logger.info("llm parse", { model: this.model, intent: parsed.data.intent, confidence: parsed.data.confidence, ms: Date.now() - started });
      return parsed.data;
    } catch (err) {
      const timedOut = err instanceof AppError && err.code === "AI_UNAVAILABLE";
      onUsage?.({ inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - started, status: timedOut ? "timeout" : "error" });
      this.logger.warn("llm parse failed", { model: this.model, error: String(err), ms: Date.now() - started });
      return null;
    }
  }
}

/** Workers AI returns usage counts on most text models; absent → zeros. */
function usageOf(res: unknown): { inputTokens: number; outputTokens: number } {
  const u = (res as { usage?: { prompt_tokens?: number; completion_tokens?: number } })?.usage;
  return { inputTokens: Math.max(0, Math.round(u?.prompt_tokens ?? 0)), outputTokens: Math.max(0, Math.round(u?.completion_tokens ?? 0)) };
}

function extractJson(res: unknown): unknown {
  const r = (res as { response?: unknown })?.response ?? res;
  if (typeof r === "string") {
    const start = r.indexOf("{");
    const end = r.lastIndexOf("}");
    if (start < 0 || end < start) return null;
    try {
      return JSON.parse(r.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return r;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new AppError("AI_UNAVAILABLE", "AI timed out")), ms))]);
}
