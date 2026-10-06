import { describe, expect, it } from "vitest";
import { PARSED_INTENT_JSON_SCHEMA, parsedIntentSchema } from "@/server/ai/contract";

describe("AI output contract", () => {
  it("accepts the documented example", () => {
    const r = parsedIntentSchema.safeParse({
      intent: "CREATE_SALE",
      confidence: 0.94,
      language: "hinglish",
      entities: { customer: null, items: [{ query: "Coke", quantity: 20 }], payment_method: null },
      requires_confirmation: true,
      clarification: null,
    });
    expect(r.success).toBe(true);
  });
  it("rejects invalid or dangerous output (nothing executes)", () => {
    for (const bad of [
      { intent: "DELETE_DATABASE", confidence: 1, language: "english", entities: {}, requires_confirmation: false, clarification: null },
      { intent: "CREATE_SALE", confidence: 7, language: "english", entities: {}, requires_confirmation: true, clarification: null },
      { intent: "CREATE_SALE", confidence: 0.9, language: "english", entities: { items: [{ query: "x", quantity: -5 }] }, requires_confirmation: true, clarification: null },
      "not json",
      null,
    ]) {
      expect(parsedIntentSchema.safeParse(bad).success).toBe(false);
    }
  });
  it("exports a JSON schema for the LLM", () => {
    expect(JSON.stringify(PARSED_INTENT_JSON_SCHEMA)).toContain("CREATE_SALE");
  });
});
