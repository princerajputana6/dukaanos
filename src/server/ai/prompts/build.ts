/**
 * Assembles the LLM request from separate parts: system rules, business context (small,
 * relevant slice only), recent conversation, the user's input and the output schema.
 */
import { SYSTEM_PROMPT } from "./system";

export interface PromptContext {
  businessType: string;
  /** Top candidate names relevant to this input (never the full catalogue). */
  productNames: string[];
  customerNames: string[];
  supplierNames: string[];
  expenseCategories: string[];
  /** Recent turns, oldest first. */
  conversation: Array<{ user: string; intent: string; summary: string }>;
}

export function buildMessages(input: string, ctx: PromptContext) {
  const businessBlock = [
    `Business type: ${ctx.businessType}`,
    ctx.productNames.length ? `Possibly relevant products: ${ctx.productNames.join(" | ")}` : "No matching products in catalogue.",
    ctx.customerNames.length ? `Possibly relevant customers: ${ctx.customerNames.join(" | ")}` : "",
    ctx.supplierNames.length ? `Possibly relevant suppliers: ${ctx.supplierNames.join(" | ")}` : "",
    `Expense categories: ${ctx.expenseCategories.join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");
  const convo = ctx.conversation.length
    ? ctx.conversation.map((t) => `User: ${t.user}\nApp understood: ${t.intent} — ${t.summary}`).join("\n")
    : "(no earlier messages)";
  return [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "system" as const, content: `Business context:\n${businessBlock}` },
    { role: "system" as const, content: `Recent conversation:\n${convo}` },
    { role: "user" as const, content: input.slice(0, 500) },
  ];
}
