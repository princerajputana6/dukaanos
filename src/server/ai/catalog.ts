/**
 * Business context for the assistant: a compact, read-only view of the catalogue, parties
 * and recent conversation. Loaded per request; only small, relevant slices go to the LLM.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { addDays, todayIst } from "@/lib/dates";
import { normalizeText, tokenize } from "@/lib/text";
import {
  aiInteractions,
  businesses,
  customers,
  expenseCategories,
  productAliases,
  products,
  productUnits,
  saleItems,
  sales,
  suppliers,
} from "@/server/db/schema";
import type { ServiceContext } from "@/server/services/context";
import { rankCandidates, type MatchCandidate } from "./matching";
import type { PromptContext } from "./prompts/build";

export interface CatalogProduct {
  id: string;
  name: string;
  unit: string;
  sellingPricePaise: number;
  purchasePricePaise: number;
  currentStockMilli: number;
  lowStockThresholdMilli: number;
  trackStock: boolean;
  units: Array<{ name: string; factorMilli: number }>;
}

export interface Catalog {
  businessType: string;
  products: MatchCandidate<CatalogProduct>[];
  customers: MatchCandidate<{ id: string; name: string; balancePaise: number; phone: string | null }>[];
  suppliers: MatchCandidate<{ id: string; name: string; balancePaise: number }>[];
  expenseCategories: Array<{ id: string; name: string }>;
}

export async function loadCatalog(ctx: ServiceContext): Promise<Catalog> {
  const since = addDays(todayIst(ctx.now), -30);
  const [biz, prods, aliases, units, popularity, custs, supps, cats] = await Promise.all([
    ctx.db.select({ type: businesses.type }).from(businesses).where(eq(businesses.id, ctx.businessId)).get(),
    ctx.db
      .select({
        id: products.id,
        name: products.name,
        unit: products.unit,
        sellingPricePaise: products.sellingPricePaise,
        purchasePricePaise: products.purchasePricePaise,
        currentStockMilli: products.currentStockMilli,
        lowStockThresholdMilli: products.lowStockThresholdMilli,
        trackStock: products.trackStock,
      })
      .from(products)
      .where(and(eq(products.businessId, ctx.businessId), eq(products.isActive, true)))
      .limit(5000),
    ctx.db.select({ productId: productAliases.productId, alias: productAliases.alias }).from(productAliases).where(eq(productAliases.businessId, ctx.businessId)),
    ctx.db.select({ productId: productUnits.productId, name: productUnits.name, factorMilli: productUnits.factorMilli }).from(productUnits).where(eq(productUnits.businessId, ctx.businessId)),
    ctx.db
      .select({ productId: saleItems.productId, n: sql<number>`count(*)` })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .where(and(eq(saleItems.businessId, ctx.businessId), gte(sales.txnDate, since)))
      .groupBy(saleItems.productId),
    ctx.db
      .select({ id: customers.id, name: customers.name, balancePaise: customers.balancePaise, phone: customers.phone, lastTxnAt: customers.lastTxnAt })
      .from(customers)
      .where(and(eq(customers.businessId, ctx.businessId), eq(customers.isActive, true)))
      .limit(5000),
    ctx.db
      .select({ id: suppliers.id, name: suppliers.name, company: suppliers.company, balancePaise: suppliers.balancePaise })
      .from(suppliers)
      .where(and(eq(suppliers.businessId, ctx.businessId), eq(suppliers.isActive, true)))
      .limit(2000),
    ctx.db.select({ id: expenseCategories.id, name: expenseCategories.name }).from(expenseCategories).where(eq(expenseCategories.businessId, ctx.businessId)),
  ]);
  const aliasBy = new Map<string, string[]>();
  for (const a of aliases) aliasBy.set(a.productId, [...(aliasBy.get(a.productId) ?? []), a.alias]);
  const unitsBy = new Map<string, Array<{ name: string; factorMilli: number }>>();
  for (const u of units) unitsBy.set(u.productId, [...(unitsBy.get(u.productId) ?? []), { name: u.name, factorMilli: u.factorMilli }]);
  const pop = new Map(popularity.map((p) => [p.productId, Number(p.n)]));
  return {
    businessType: biz?.type ?? "other",
    products: prods.map((p) => ({ value: { ...p, units: unitsBy.get(p.id) ?? [] }, name: p.name, aliases: aliasBy.get(p.id) ?? [], popularity: pop.get(p.id) ?? 0 })),
    customers: custs.map((c) => ({ value: { id: c.id, name: c.name, balancePaise: c.balancePaise, phone: c.phone }, name: c.name, aliases: c.phone ? [c.phone] : [], popularity: c.lastTxnAt ?? 0 })),
    suppliers: supps.map((s) => ({ value: { id: s.id, name: s.name, balancePaise: s.balancePaise }, name: s.name, aliases: s.company ? [s.company] : [] })),
    expenseCategories: cats,
  };
}

// ─── Conversation memory ─────────────────────────────────────────────────────

export interface ConversationRefs {
  productIds: string[];
  customerId: string | null;
  supplierId: string | null;
}

export interface RecentTurn {
  id: string;
  inputText: string;
  intent: string;
  responseText: string | null;
  createdAt: number;
  refs: ConversationRefs | null;
}

/** Context memory window. Older turns are ignored so stale context can't drive actions. */
export const CONTEXT_WINDOW_MS = 10 * 60_000;
/** Follow-ups ("10 aur bech di") may only reuse a subject mentioned within this window. */
export const FOLLOW_UP_WINDOW_MS = 5 * 60_000;

export async function recentTurns(ctx: ServiceContext, limit = 5): Promise<RecentTurn[]> {
  const rows = await ctx.db
    .select({ id: aiInteractions.id, inputText: aiInteractions.inputText, intent: aiInteractions.intent, responseText: aiInteractions.responseText, createdAt: aiInteractions.createdAt, contextJson: aiInteractions.contextJson })
    .from(aiInteractions)
    .where(and(eq(aiInteractions.businessId, ctx.businessId), eq(aiInteractions.userId, ctx.userId), gte(aiInteractions.createdAt, ctx.now - CONTEXT_WINDOW_MS)))
    .orderBy(desc(aiInteractions.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, refs: ((r.contextJson as { refs?: ConversationRefs } | null)?.refs ?? null) }));
}

/** The latest subject (product / customer / supplier) mentioned within the follow-up window. */
export function latestRefs(turns: RecentTurn[], now: number): { refs: ConversationRefs; turn: RecentTurn } | null {
  for (const t of turns) {
    if (now - t.createdAt > FOLLOW_UP_WINDOW_MS) break;
    if (t.refs && (t.refs.productIds.length || t.refs.customerId || t.refs.supplierId)) return { refs: t.refs, turn: t };
  }
  return null;
}

/** Only the candidates relevant to this input go to the LLM (cost control + privacy). */
export function promptContextFor(input: string, catalog: Catalog, turns: RecentTurn[]): PromptContext {
  const words = tokenize(input).filter((w) => w.length >= 3 && !/^\d/.test(w));
  const pick = <T,>(cands: MatchCandidate<T>[], n: number) => {
    const scores = new Map<T, number>();
    for (const w of words) for (const r of rankCandidates(w, cands).slice(0, n)) scores.set(r.value, Math.max(scores.get(r.value) ?? 0, r.score));
    return [...scores.entries()]
      .filter(([, s]) => s >= 0.5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([v]) => cands.find((c) => c.value === v)!.name);
  };
  return {
    businessType: catalog.businessType,
    productNames: pick(catalog.products, 15),
    customerNames: pick(catalog.customers, 5),
    supplierNames: pick(catalog.suppliers, 5),
    expenseCategories: catalog.expenseCategories.map((c) => c.name),
    conversation: turns
      .slice(0, 3)
      .reverse()
      .map((t) => ({ user: t.inputText.slice(0, 200), intent: t.intent, summary: (t.responseText ?? "").slice(0, 160) })),
  };
}

export function normalizedEquals(a: string, b: string) {
  return normalizeText(a) === normalizeText(b);
}
