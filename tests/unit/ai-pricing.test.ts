import { describe, expect, it } from "vitest";
import { AI_PRICE_VERSION, estimateCostMicros } from "@/server/ai/pricing";

describe("AI cost estimation", () => {
  it("prices STT by audio seconds, deterministically", () => {
    expect(estimateCostMicros({ task: "stt", audioMs: 1000 })).toBe(100); // 1s → 100 micro-₹
    expect(estimateCostMicros({ task: "stt", audioMs: 5500 })).toBe(550);
    expect(estimateCostMicros({ task: "stt", audioMs: 0 })).toBe(0);
  });
  it("prices LLM intent by input+output tokens", () => {
    expect(estimateCostMicros({ task: "intent", inputTokens: 1000, outputTokens: 1000 })).toBe(2);
    expect(estimateCostMicros({ task: "intent", inputTokens: 0, outputTokens: 0 })).toBe(0);
    expect(estimateCostMicros({ task: "insight", inputTokens: 1000, outputTokens: 0 })).toBe(2);
  });
  it("exposes a stable price version string", () => {
    expect(AI_PRICE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
