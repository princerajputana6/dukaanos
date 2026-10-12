/**
 * The assistant: VOICE/TEXT → UNDERSTAND → (CLARIFY) → CONFIRM → EXECUTE → RECORD.
 *
 * Every turn is persisted in ai_interactions. Proposals are stored server-side and executed
 * verbatim on confirm — the client only sends an interaction id, never the command itself.
 */
import { and, desc, eq } from "drizzle-orm";
import { formatMoney } from "@/lib/money";
import { formatQty } from "@/lib/qty";
import { newId } from "@/lib/ids";
import { aiInteractions, businessSettings } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { resolveFlags } from "@/server/lib/flags";
import { withSource, type ServiceContext } from "@/server/services/context";
import { createCustomer, recordCustomerCredit, recordCustomerPayment } from "@/server/services/customers";
import { createExpense } from "@/server/services/expenses";
import { adjustStock } from "@/server/services/inventory";
import { createPurchase, reversePurchase } from "@/server/services/purchases";
import { createSale, reverseSale } from "@/server/services/sales";
import { createSupplier, recordSupplierPayment } from "@/server/services/suppliers";
import { reverseExpense } from "@/server/services/expenses";
import { createCustomerSchema, createSupplierSchema, customerCreditSchema, partyPaymentSchema } from "@/schemas/parties";
import { adjustStockSchema } from "@/schemas/inventory";
import { createExpenseSchema } from "@/schemas/expenses";
import { createPurchaseSchema, createSaleSchema } from "@/schemas/sales";
import { latestRefs, loadCatalog, promptContextFor, recentTurns, rememberPreference, type ConversationRefs } from "./catalog";
import { MUTATING_INTENTS, parsedIntentSchema, type ParsedIntent } from "./contract";
import { WorkersAIParser } from "./llm-parser";
import { plan, type Answer, type ClarifyOption, type Proposal, type ProposalView } from "./planner";
import { parseWithRules } from "./rules-parser";

const PROPOSAL_TTL_MS = 10 * 60_000;
const RULES_ACCEPT = 0.85;

export type InteractionStatus = "ANSWERED" | "NEEDS_CLARIFICATION" | "PROPOSED" | "CONFIRMED" | "CANCELLED" | "EXPIRED" | "FAILED";

export interface AssistantResponse {
  interactionId: string;
  status: InteractionStatus;
  intent: string;
  confidence: number;
  language: ParsedIntent["language"];
  parser: string;
  inputText: string;
  message: string;
  contextNote: string | null;
  answer: Answer | null;
  clarification: { slot: string; question: string; options: ClarifyOption[]; allowText?: "number" | "amount" } | null;
  proposal: { kind: string; view: ProposalView; command: Record<string, unknown>; needsReview: boolean } | null;
  result: { type: string; id: string; href: string | null } | null;
  expiresAt: number | null;
  createdAt: number;
}

interface StoredContext {
  refs: ConversationRefs;
  resolutions: Record<string, string>;
  followUp: { refs: ConversationRefs } | null;
  contextNote: string | null;
}

// ─── Parsing ────────────────────────────────────────────────────────────────

async function parseIntent(ctx: ServiceContext, text: string, llmContext: () => Promise<Parameters<WorkersAIParser["parse"]>[1]>) {
  const rules = parseWithRules(text);
  if (rules.intent !== "UNKNOWN" && rules.confidence >= RULES_ACCEPT) return { parsed: rules, parser: "rules", model: null as string | null };

  const settings = await ctx.db.select().from(businessSettings).where(eq(businessSettings.businessId, ctx.businessId)).get();
  if (ctx.env.AI && settings?.aiEnabled !== false) {
    const model = ctx.env.AI_MODEL ?? "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
    const llm = await new WorkersAIParser(ctx.env.AI, model, ctx.logger).parse(text, await llmContext());
    if (llm && llm.intent !== "UNKNOWN" && llm.confidence >= rules.confidence) {
      // Safety: mutations always need confirmation regardless of what the model said.
      const safe: ParsedIntent = { ...llm, requires_confirmation: MUTATING_INTENTS.has(llm.intent) ? true : llm.requires_confirmation };
      return { parsed: safe, parser: "llm", model };
    }
    if (llm?.intent === "UNKNOWN" && rules.intent === "UNKNOWN") return { parsed: llm, parser: "llm", model };
  }
  return { parsed: rules, parser: "rules", model: null };
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function interpret(ctx: ServiceContext, input: { text: string; voiceCommandId?: string | null }): Promise<AssistantResponse> {
  const started = Date.now();
  const text = input.text.trim().slice(0, 500);
  if (!text) throw new AppError("VALIDATION_ERROR", "Say or type something.");
  const [catalog, turns] = await Promise.all([loadCatalog(ctx), recentTurns(ctx)]);
  const { parsed: rawParsed, parser, model } = await parseIntent(ctx, text, async () => promptContextFor(text, catalog, turns));
  const valid = parsedIntentSchema.safeParse(rawParsed);
  const parsed = valid.success ? valid.data : parseWithRules("");

  const follow = latestRefs(turns, ctx.now);
  const stored: StoredContext = { refs: { productIds: [], customerId: null, supplierId: null }, resolutions: {}, followUp: follow ? { refs: follow.refs } : null, contextNote: null };

  // Low-confidence understanding: ask rather than act.
  if (parsed.intent !== "UNKNOWN" && parsed.confidence < 0.7) {
    const id = newId(ctx.now);
    const message =
      parsed.language === "english"
        ? "I'm not sure I understood. Could you say it again with the item and quantity? e.g. “20 Coke sold”."
        : "Theek se samajh nahi aaya. Item aur quantity ke saath dobara boliye, jaise “20 Coke biki”.";
    await insertInteraction(ctx, { id, input: text, voiceCommandId: input.voiceCommandId ?? null, parser, model, parsed, status: "FAILED", message, stored, latencyMs: Date.now() - started, errorCode: "LOW_CONFIDENCE" });
    return toResponse(await getRow(ctx, id));
  }

  const id = newId(ctx.now);
  const outcome = await plan(ctx, catalog, { parsed, resolutions: {}, followUp: stored.followUp, text });
  stored.refs = outcome.refs;
  stored.contextNote = outcome.contextNote;
  await insertInteraction(ctx, { id, input: text, voiceCommandId: input.voiceCommandId ?? null, parser, model, parsed, stored, latencyMs: Date.now() - started, ...outcomeFields(outcome.result, ctx.now) });
  return toResponse(await getRow(ctx, id));
}

/** Answers a clarification ("Which Coke?") with an option id or free text (number/amount). */
/**
 * Answers a clarification ("Which Coke?") with an option id or free text (number/amount), or —
 * on a proposal — switches an automatically picked product to one of its alternatives.
 */
export async function clarify(ctx: ServiceContext, interactionId: string, choice: { optionId?: string; text?: string; slot?: string }): Promise<AssistantResponse> {
  const row = await getOwnRow(ctx, interactionId);
  if (row.status !== "NEEDS_CLARIFICATION" && row.status !== "PROPOSED") throw new AppError("CONFLICT", "This request was already completed.");
  if (row.expiresAt && row.expiresAt < ctx.now) {
    await ctx.db.update(aiInteractions).set({ status: "EXPIRED", updatedAt: ctx.now }).where(eq(aiInteractions.id, row.id));
    throw new AppError("INTERACTION_EXPIRED", "This request expired. Please say it again.");
  }
  let slot: string;
  let value: string | null = null;
  if (row.status === "PROPOSED") {
    const pick = (row.proposalJson as Proposal | null)?.view.autoPicks?.find((a) => a.slot === choice.slot);
    if (!pick) throw new AppError("VALIDATION_ERROR", "Nothing to change here.");
    slot = pick.slot;
    if (choice.optionId && pick.options.some((o) => o.id === choice.optionId)) value = choice.optionId;
  } else {
    const clar = row.clarificationJson as { slot: string; options: ClarifyOption[]; allowText?: "number" | "amount" };
    slot = clar.slot;
    if (choice.optionId && clar.options.some((o) => o.id === choice.optionId)) value = choice.optionId;
    else if (choice.text && clar.allowText) {
      const n = Number(choice.text.replace(/[₹,\s]/g, "").replace(/rs\.?/i, ""));
      if (Number.isFinite(n) && n > 0 && n < 10_000_000) value = String(n);
    }
  }
  if (!value) throw new AppError("VALIDATION_ERROR", "Please choose one of the options.");

  const stored = row.contextJson as StoredContext;
  stored.resolutions = { ...stored.resolutions, [slot]: value };
  const parsed = parsedIntentSchema.parse(row.parsedJson);
  // Learn what this shop means by the word ("coke" → Coke 500ml) for next time.
  const itemIdx = slot.startsWith("item:") ? Number(slot.slice(5)) : -1;
  const spoken = itemIdx >= 0 ? parsed.entities.items?.[itemIdx]?.query : null;
  if (spoken) await rememberPreference(ctx, spoken, value).catch(() => undefined);
  const catalog = await loadCatalog(ctx);
  const outcome = await plan(ctx, catalog, { parsed, resolutions: stored.resolutions, followUp: stored.followUp, text: row.inputText });
  stored.refs = outcome.refs;
  stored.contextNote = outcome.contextNote ?? stored.contextNote;
  const fields = outcomeFields(outcome.result, ctx.now);
  await ctx.db
    .update(aiInteractions)
    .set({
      status: fields.status,
      responseText: fields.message,
      proposalJson: fields.proposal ?? null,
      clarificationJson: fields.clarification ?? null,
      contextJson: { ...stored, answer: fields.answer ?? null },
      expiresAt: fields.expiresAt,
      updatedAt: ctx.now,
    })
    .where(eq(aiInteractions.id, row.id));
  return toResponse(await getRow(ctx, row.id));
}

export async function cancel(ctx: ServiceContext, interactionId: string): Promise<AssistantResponse> {
  const row = await getOwnRow(ctx, interactionId);
  if (row.status === "PROPOSED" || row.status === "NEEDS_CLARIFICATION") {
    await ctx.db.update(aiInteractions).set({ status: "CANCELLED", updatedAt: ctx.now }).where(eq(aiInteractions.id, row.id));
  }
  return toResponse(await getRow(ctx, row.id));
}

/**
 * Executes the STORED proposal through the transaction engine (source = VOICE). The
 * interaction id is the idempotency key, so double-taps and retries execute once.
 */
export async function confirm(ctx: ServiceContext, interactionId: string): Promise<AssistantResponse> {
  const row = await getOwnRow(ctx, interactionId);
  if (row.status === "CONFIRMED") return toResponse(row);
  if (row.status !== "PROPOSED") throw new AppError("CONFLICT", "There is nothing to confirm for this request.");
  if (!row.expiresAt || row.expiresAt < ctx.now) {
    await ctx.db.update(aiInteractions).set({ status: "EXPIRED", updatedAt: ctx.now }).where(eq(aiInteractions.id, row.id));
    throw new AppError("INTERACTION_EXPIRED", "This confirmation expired. Please say it again.");
  }
  const proposal = row.proposalJson as Proposal;
  const vctx = withSource(ctx, "VOICE");
  const key = `ai-${row.id}`;
  const lang = (row.language as ParsedIntent["language"]) ?? "hinglish";
  const L = (en: string, hi: string) => (lang === "english" ? en : hi);
  let result: { type: string; id: string; href: string | null };
  let message: string;
  try {
    switch (proposal.kind) {
      case "CREATE_SALE": {
        const r = await createSale(vctx, createSaleSchema.parse(proposal.command), key);
        result = { type: "sale", id: r.id, href: `/sales/${r.id}` };
        const stock = r.lines.filter((l) => l.trackStock).map((l) => `${l.productName}: ${formatQty(Math.max(0, l.stockAfterMilli))} ${l.unit} ${L("left", "bache")}`);
        message = `${L("Done ✓", "Ho gaya ✓")} ${r.invoiceNumber} · ${formatMoney(r.totalPaise, { compact: true })}. ${L("Stock updated.", "Stock update ho gaya.")}${stock.length ? `\n${stock.join("\n")}` : ""}`;
        break;
      }
      case "CREATE_PURCHASE": {
        const r = await createPurchase(vctx, createPurchaseSchema.parse(proposal.command), key);
        result = { type: "purchase", id: r.id, href: `/purchases` };
        message = `${L("Done ✓", "Ho gaya ✓")} ${r.purchaseNumber} · ${formatMoney(r.totalPaise, { compact: true })}. ${L("Stock added.", "Stock jud gaya.")}`;
        break;
      }
      case "ADJUST_STOCK": {
        const r = await adjustStock(vctx, adjustStockSchema.parse(proposal.command), key);
        result = { type: "product", id: r.productId, href: `/inventory/${r.productId}` };
        message = `${L("Done ✓", "Ho gaya ✓")} ${r.productName}: ${formatQty(r.afterMilli)} ${L("in stock now.", "ab stock mein.")}`;
        break;
      }
      case "CREATE_EXPENSE": {
        const r = await createExpense(vctx, createExpenseSchema.parse(proposal.command), key);
        result = { type: "expense", id: r.id, href: "/expenses" };
        message = `${L("Saved ✓", "Save ho gaya ✓")} ${r.categoryName} · ${formatMoney(r.amountPaise, { compact: true })}.`;
        break;
      }
      case "CUSTOMER_PAYMENT": {
        const { customerId, ...rest } = proposal.command as { customerId: string };
        const r = await recordCustomerPayment(vctx, customerId, partyPaymentSchema.parse(rest), key);
        result = { type: "customer", id: customerId, href: `/customers/${customerId}` };
        message = `${L("Done ✓", "Ho gaya ✓")} ${r.customerName}: ${L("outstanding now", "ab baki")} ${formatMoney(r.balanceAfterPaise)}.`;
        break;
      }
      case "SUPPLIER_PAYMENT": {
        const { supplierId, ...rest } = proposal.command as { supplierId: string };
        const r = await recordSupplierPayment(vctx, supplierId, partyPaymentSchema.parse(rest), key);
        result = { type: "supplier", id: supplierId, href: `/suppliers/${supplierId}` };
        message = `${L("Done ✓", "Ho gaya ✓")} ${r.supplierName}: ${L("payable now", "ab dena")} ${formatMoney(r.balanceAfterPaise)}.`;
        break;
      }
      case "CREATE_CREDIT": {
        const { customerId, ...rest } = proposal.command as { customerId: string };
        const r = await recordCustomerCredit(vctx, customerId, customerCreditSchema.parse(rest), key);
        result = { type: "customer", id: customerId, href: `/customers/${customerId}` };
        message = `${L("Done ✓", "Likh diya ✓")} ${r.customerName}: ${L("outstanding now", "ab baki")} ${formatMoney(r.balanceAfterPaise)}.`;
        break;
      }
      case "CREATE_CUSTOMER": {
        const r = await createCustomer(vctx, createCustomerSchema.parse(proposal.command), key);
        result = { type: "customer", id: r.id, href: `/customers/${r.id}` };
        message = `${L("Added ✓", "Add ho gaya ✓")} ${r.name}.`;
        break;
      }
      case "CREATE_SUPPLIER": {
        const r = await createSupplier(vctx, createSupplierSchema.parse(proposal.command), key);
        result = { type: "supplier", id: r.id, href: `/suppliers/${r.id}` };
        message = `${L("Added ✓", "Add ho gaya ✓")} ${r.name}.`;
        break;
      }
      case "REVERSE_SALE": {
        const c = proposal.command as { saleId: string; reason: string };
        const r = await reverseSale(vctx, c.saleId, c.reason, key);
        result = { type: "sale", id: r.id, href: `/sales/${r.id}` };
        message = `${L("Undone ✓", "Undo ho gaya ✓")} ${r.number}. ${L("Stock restored.", "Stock wapas jud gaya.")}`;
        break;
      }
      case "REVERSE_PURCHASE": {
        const c = proposal.command as { purchaseId: string; reason: string };
        const r = await reversePurchase(vctx, c.purchaseId, c.reason, key);
        result = { type: "purchase", id: r.id, href: `/purchases` };
        message = `${L("Undone ✓", "Undo ho gaya ✓")} ${r.number}.`;
        break;
      }
      case "REVERSE_EXPENSE": {
        const c = proposal.command as { expenseId: string; reason: string };
        const r = await reverseExpense(vctx, c.expenseId, c.reason, key);
        result = { type: "expense", id: r.id, href: "/expenses" };
        message = L("Undone ✓ Expense reversed.", "Undo ho gaya ✓ Kharcha hata diya.");
        break;
      }
      default:
        throw new AppError("VALIDATION_ERROR", "Unknown action.");
    }
  } catch (err) {
    if (err instanceof AppError && err.status < 500) {
      await ctx.db.update(aiInteractions).set({ status: "FAILED", errorCode: err.code, responseText: err.message, updatedAt: ctx.now }).where(eq(aiInteractions.id, row.id));
    }
    throw err;
  }
  // Confirming an automatic pick teaches it as this shop's usual meaning of the word.
  for (const a of proposal.view.autoPicks ?? []) await rememberPreference(ctx, a.query, a.chosenId).catch(() => undefined);
  await ctx.db
    .update(aiInteractions)
    .set({ status: "CONFIRMED", resultType: result.type, resultId: result.id, responseText: message, updatedAt: ctx.now })
    .where(eq(aiInteractions.id, row.id));
  return toResponse(await getRow(ctx, row.id));
}

export async function history(ctx: ServiceContext, limit = 30) {
  const rows = await ctx.db
    .select()
    .from(aiInteractions)
    .where(and(eq(aiInteractions.businessId, ctx.businessId), eq(aiInteractions.userId, ctx.userId)))
    .orderBy(desc(aiInteractions.createdAt))
    .limit(limit);
  return rows.map(toResponse).reverse();
}

export async function getInteraction(ctx: ServiceContext, id: string) {
  return toResponse(await getOwnRow(ctx, id));
}

// ─── Persistence helpers ────────────────────────────────────────────────────

type Row = typeof aiInteractions.$inferSelect;

function outcomeFields(result: Awaited<ReturnType<typeof plan>>["result"], now: number) {
  switch (result.type) {
    case "answer":
      return { status: "ANSWERED" as const, message: result.answer.message, answer: result.answer, expiresAt: null };
    case "clarify":
      return { status: "NEEDS_CLARIFICATION" as const, message: result.question, clarification: { slot: result.slot, question: result.question, options: result.options, allowText: result.allowText }, expiresAt: now + PROPOSAL_TTL_MS };
    case "proposal":
      return { status: "PROPOSED" as const, message: result.message, proposal: result.proposal, expiresAt: now + PROPOSAL_TTL_MS };
    case "error":
      return { status: "FAILED" as const, message: result.message, answer: { message: result.message, actions: result.actions ?? [] }, expiresAt: null };
  }
}

async function insertInteraction(
  ctx: ServiceContext,
  v: {
    id: string;
    input: string;
    voiceCommandId: string | null;
    parser: string;
    model: string | null;
    parsed: ParsedIntent;
    stored: StoredContext;
    status: InteractionStatus;
    message: string;
    answer?: Answer | null;
    proposal?: Proposal;
    clarification?: unknown;
    expiresAt?: number | null;
    latencyMs: number;
    errorCode?: string;
  },
) {
  await ctx.db.insert(aiInteractions).values({
    id: v.id,
    businessId: ctx.businessId,
    userId: ctx.userId,
    voiceCommandId: v.voiceCommandId,
    inputText: v.input,
    parser: v.parser,
    model: v.model,
    intent: v.parsed.intent,
    confidence: Math.round(v.parsed.confidence * 100),
    language: v.parsed.language,
    parsedJson: v.parsed,
    proposalJson: v.proposal ?? null,
    clarificationJson: v.clarification ?? null,
    contextJson: { ...v.stored, answer: v.answer ?? null },
    status: v.status,
    responseText: v.message,
    latencyMs: v.latencyMs,
    errorCode: v.errorCode ?? null,
    expiresAt: v.expiresAt ?? null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  });
  ctx.logger.info("ai interaction", { interactionId: v.id, intent: v.parsed.intent, confidence: v.parsed.confidence, parser: v.parser, status: v.status, ms: v.latencyMs });
}

async function getRow(ctx: ServiceContext, id: string): Promise<Row> {
  const row = await ctx.db.select().from(aiInteractions).where(and(eq(aiInteractions.id, id), eq(aiInteractions.businessId, ctx.businessId))).get();
  if (!row) throw new AppError("NOT_FOUND", "Request not found.");
  return row;
}

/** Only the user who asked can clarify/confirm their own request. */
async function getOwnRow(ctx: ServiceContext, id: string): Promise<Row> {
  const row = await getRow(ctx, id);
  if (row.userId !== ctx.userId) throw new AppError("NOT_FOUND", "Request not found.");
  return row;
}

function toResponse(row: Row): AssistantResponse {
  const stored = (row.contextJson ?? {}) as Partial<StoredContext> & { answer?: Answer | null };
  const proposal = row.proposalJson as Proposal | null;
  const parsed = row.parsedJson as ParsedIntent | null;
  const clar = row.clarificationJson as AssistantResponse["clarification"];
  const hrefFor = (t: string | null, id: string | null) => (t && id ? (t === "sale" ? `/sales/${id}` : t === "customer" ? `/customers/${id}` : t === "supplier" ? `/suppliers/${id}` : t === "product" ? `/inventory/${id}` : t === "expense" ? "/expenses" : "/purchases") : null);
  return {
    interactionId: row.id,
    status: row.status as InteractionStatus,
    intent: row.intent,
    confidence: row.confidence / 100,
    language: (row.language as ParsedIntent["language"]) ?? "hinglish",
    parser: row.parser,
    inputText: row.inputText,
    message: row.responseText ?? "",
    contextNote: stored.contextNote ?? null,
    answer: stored.answer ?? null,
    clarification: row.status === "NEEDS_CLARIFICATION" ? clar : null,
    proposal: proposal ? { kind: proposal.kind, view: proposal.view, command: proposal.command, needsReview: (parsed?.confidence ?? 1) < 0.9 } : null,
    result: row.resultType && row.resultId ? { type: row.resultType, id: row.resultId, href: hrefFor(row.resultType, row.resultId) } : null,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

export function voiceEnabled(env: Env, overrides?: Partial<Record<string, boolean>> | null) {
  return resolveFlags(env, overrides).VOICE_ENABLED;
}
