/**
 * Server-side speech-to-text. Business logic depends only on the SttProvider interface, so
 * providers (Workers AI Whisper today; others later) are swappable.
 */
import { AppError } from "@/server/lib/errors";
import { bytesToBase64Url } from "@/server/lib/crypto";
import type { Logger } from "@/server/lib/logger";

export interface Transcript {
  text: string;
  language: string | null;
  durationMs: number | null;
  provider: string;
}

export interface SttProvider {
  readonly name: string;
  transcribe(audio: ArrayBuffer, opts?: { languageHint?: string }): Promise<Transcript>;
  detectLanguage(text: string): string;
}

/** Biases Whisper towards romanised Hinglish shop vocabulary. */
const INITIAL_PROMPT = "Aaj 20 Coke aur 10 Sprite biki. Ramesh ne 500 rupaye diye. Coke kitni bachi hai? Udhaar likh do.";

export class WorkersAIWhisper implements SttProvider {
  readonly name = "workers-ai-whisper";
  constructor(
    private ai: Ai,
    private model: string,
    private logger: Logger,
  ) {}

  async transcribe(audio: ArrayBuffer, opts: { languageHint?: string } = {}): Promise<Transcript> {
    const started = Date.now();
    const b64 = bytesToBase64Url(new Uint8Array(audio)).replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "===".slice((b64.length + 3) % 4);
    try {
      const res = (await this.ai.run(this.model as Parameters<Ai["run"]>[0], {
        audio: padded,
        task: "transcribe",
        initial_prompt: INITIAL_PROMPT,
        ...(opts.languageHint ? { language: opts.languageHint } : {}),
        vad_filter: true,
      } as never)) as { text?: string; transcription_info?: { language?: string; duration?: number } };
      const text = (res.text ?? "").trim();
      this.logger.info("stt", { provider: this.name, ms: Date.now() - started, chars: text.length, language: res.transcription_info?.language });
      return {
        text,
        language: res.transcription_info?.language ?? this.detectLanguage(text),
        durationMs: res.transcription_info?.duration ? Math.round(res.transcription_info.duration * 1000) : null,
        provider: this.name,
      };
    } catch (err) {
      this.logger.error("stt failed", { provider: this.name, error: String(err) });
      throw new AppError("AI_UNAVAILABLE", "Voice recognition is unavailable right now. Please type instead.");
    }
  }

  detectLanguage(text: string): string {
    return /[ऀ-ॿ]/.test(text) ? "hi" : "en";
  }
}

export function getSttProvider(env: Env, logger: Logger): SttProvider | null {
  if (!env.AI) return null;
  return new WorkersAIWhisper(env.AI, env.STT_MODEL ?? "@cf/openai/whisper-large-v3-turbo", logger);
}
