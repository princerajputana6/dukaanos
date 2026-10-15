/**
 * Versioned AI price map → estimated cost in micro-rupees (₹ × 1,000,000).
 *
 * Workers AI bills in Neurons, not per-token invoices, so these are deliberate, auditable
 * *estimates* for budgeting — not a provider bill. Bump AI_PRICE_VERSION when the numbers change
 * so historical `ai_usage_events.est_cost_micros` stay interpretable under their own version.
 */
export const AI_PRICE_VERSION = "2026-10-15";

/** Micro-rupees per 1,000 tokens / per audio-second, by task. Conservative public estimates. */
const PRICE = {
  // Llama 3.3 70B fp8-fast: ~₹0.65 per 1M input, ~₹0.80 per 1M output (Neuron-based estimate).
  intentInputPer1k: 1, // ₹0.000001/token → 1 micro per 1k
  intentOutputPer1k: 1,
  answerInputPer1k: 1,
  answerOutputPer1k: 1,
  insightInputPer1k: 2,
  insightOutputPer1k: 2,
  // Whisper large v3 turbo: ~₹0.006 per audio-minute → 100 micro-rupees per second.
  sttPerAudioSec: 100,
} as const;

export interface UsageMetrics {
  task: "stt" | "intent" | "answer" | "insight";
  inputTokens?: number;
  outputTokens?: number;
  audioMs?: number;
}

export function estimateCostMicros(u: UsageMetrics): number {
  if (u.task === "stt") return Math.round(((u.audioMs ?? 0) / 1000) * PRICE.sttPerAudioSec);
  const inPer1k = u.task === "insight" ? PRICE.insightInputPer1k : u.task === "answer" ? PRICE.answerInputPer1k : PRICE.intentInputPer1k;
  const outPer1k = u.task === "insight" ? PRICE.insightOutputPer1k : u.task === "answer" ? PRICE.answerOutputPer1k : PRICE.intentOutputPer1k;
  return Math.round(((u.inputTokens ?? 0) / 1000) * inPer1k + ((u.outputTokens ?? 0) / 1000) * outPer1k);
}
