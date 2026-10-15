/**
 * The AI output contract. Every parser (rules or LLM) must produce exactly this shape; it is
 * validated with zod and anything invalid becomes UNKNOWN. The AI never produces IDs, prices
 * shown as facts, stock figures or totals — only what the user SAID.
 */
import { z } from "zod";

export const INTENTS = [
  "CREATE_SALE",
  "CREATE_PURCHASE",
  "ADJUST_STOCK",
  "CREATE_CUSTOMER",
  "CREATE_SUPPLIER",
  "CREATE_EXPENSE",
  "CREATE_PAYMENT",
  "CREATE_CREDIT",
  "SEARCH_PRODUCT",
  "SEARCH_CUSTOMER",
  "SEARCH_SUPPLIER",
  "CHECK_STOCK",
  "CHECK_SALES",
  "CHECK_PROFIT",
  "CHECK_OUTSTANDING",
  "LOW_STOCK_QUERY",
  "CHECK_INVENTORY",
  "DAILY_SUMMARY",
  "MONTHLY_SUMMARY",
  "UNDO_TRANSACTION",
  "UNKNOWN",
] as const;
export type Intent = (typeof INTENTS)[number];

export const MUTATING_INTENTS: ReadonlySet<Intent> = new Set([
  "CREATE_SALE",
  "CREATE_PURCHASE",
  "ADJUST_STOCK",
  "CREATE_CUSTOMER",
  "CREATE_SUPPLIER",
  "CREATE_EXPENSE",
  "CREATE_PAYMENT",
  "CREATE_CREDIT",
  "UNDO_TRANSACTION",
]);

export const PERIODS = ["today", "yesterday", "this_week", "last_7_days", "this_month", "last_month", "last_30_days"] as const;
export type Period = (typeof PERIODS)[number];

const nullableString = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const quantity = z.number().positive().max(1_000_000).nullable().optional();
const rupees = z.number().positive().max(10_000_000).nullable().optional();

export const itemEntitySchema = z.object({
  query: nullableString(80),
  quantity,
  unit: nullableString(20),
  price_rupees: rupees,
});
export type ItemEntity = z.infer<typeof itemEntitySchema>;

export const parsedIntentSchema = z.object({
  intent: z.enum(INTENTS),
  confidence: z.number().min(0).max(1),
  language: z.enum(["english", "hindi", "hinglish"]),
  entities: z
    .object({
      items: z.array(itemEntitySchema).max(30).optional(),
      customer: nullableString(80),
      supplier: nullableString(80),
      amount_rupees: rupees,
      payment_method: z.enum(["CASH", "UPI", "CARD", "CREDIT"]).nullable().optional(),
      /** For CREATE_PAYMENT: money received from a customer, or paid to a supplier. */
      direction: z.enum(["received", "paid"]).nullable().optional(),
      expense_category: nullableString(60),
      period: z.enum(PERIODS).nullable().optional(),
      date: z.enum(["today", "yesterday"]).nullable().optional(),
      adjustment_type: z.enum(["ADJUSTMENT", "DAMAGE", "RETURN"]).nullable().optional(),
      stock_direction: z.enum(["increase", "decrease", "set"]).nullable().optional(),
      phone: z.string().trim().max(20).nullable().optional(),
      note: nullableString(200),
      undo_target: z.enum(["sale", "purchase", "expense"]).nullable().optional(),
      search_query: nullableString(80),
    })
    .default({}),
  requires_confirmation: z.boolean(),
  clarification: z.string().max(200).nullable(),
});
export type ParsedIntent = z.infer<typeof parsedIntentSchema>;

export function unknownIntent(language: ParsedIntent["language"] = "hinglish"): ParsedIntent {
  return { intent: "UNKNOWN", confidence: 0, language, entities: {}, requires_confirmation: false, clarification: null };
}

/** JSON Schema handed to the LLM (kept in sync with parsedIntentSchema by tests). */
export const PARSED_INTENT_JSON_SCHEMA = z.toJSONSchema(parsedIntentSchema, { target: "draft-7", io: "input" });
