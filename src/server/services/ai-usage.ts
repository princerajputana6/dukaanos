/**
 * AI cost metering & budgets (AI_COST_MODEL.md, plan §17).
 *
 * Recording never throws into the AI path — if metering fails, AI still answers. Budget checks
 * are advisory: when a business is over its cap or has the kill switch on, the caller skips the
 * paid provider and degrades gracefully. Core POS/stock never depend on this module.
 */
import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { istMonthStartMs } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { AI_PRICE_VERSION, estimateCostMicros, type UsageMetrics } from "@/server/ai/pricing";
import type { Db } from "@/server/db/client";
import { aiBudgets, aiUsageEvents, businesses } from "@/server/db/schema";
import type { Logger } from "@/server/lib/logger";
import type { ServiceContext } from "./context";

export interface AiUsageInput extends UsageMetrics {
  provider: string;
  model: string;
  status: "ok" | "error" | "timeout";
  latencyMs?: number;
  retryCount?: number;
  routingReason?: string;
  interactionId?: string | null;
}

/** Records one provider call. Fire-and-forget safe: swallows its own errors. */
export async function recordAiUsage(ctx: ServiceContext, u: AiUsageInput): Promise<void> {
  try {
    await ctx.db.insert(aiUsageEvents).values({
      id: newId(ctx.now),
      businessId: ctx.businessId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      interactionId: u.interactionId ?? null,
      provider: u.provider,
      model: u.model,
      task: u.task,
      inputTokens: u.inputTokens ?? 0,
      outputTokens: u.outputTokens ?? 0,
      cachedTokens: 0,
      audioMs: u.audioMs ?? 0,
      estCostMicros: estimateCostMicros(u),
      priceVersion: AI_PRICE_VERSION,
      latencyMs: u.latencyMs ?? null,
      status: u.status,
      retryCount: u.retryCount ?? 0,
      routingReason: u.routingReason ?? null,
      createdAt: ctx.now,
    });
  } catch (err) {
    ctx.logger.warn("ai usage not recorded", { error: String(err) });
  }
}

/** Month-to-date spend for the current business, in micro-rupees. */
export async function monthToDateSpendMicros(db: Db, businessId: string, now: number): Promise<number> {
  const row = await db
    .select({ total: sql<number>`coalesce(sum(${aiUsageEvents.estCostMicros}), 0)` })
    .from(aiUsageEvents)
    .where(and(eq(aiUsageEvents.businessId, businessId), gte(aiUsageEvents.createdAt, istMonthStartMs(now))))
    .get();
  return Number(row?.total ?? 0);
}

export interface BudgetDecision {
  allowed: boolean;
  reason: "ok" | "kill_switch" | "cap_reached";
  capMicros: number | null;
  spentMicros: number;
}

/**
 * Advisory check before a paid AI call. Does not throw: the caller skips the provider and
 * degrades when `allowed` is false, so billing/stock flows (which never call this) keep working.
 */
export async function checkAiBudget(ctx: ServiceContext): Promise<BudgetDecision> {
  try {
    const budget = await ctx.db.select().from(aiBudgets).where(eq(aiBudgets.businessId, ctx.businessId)).get();
    if (budget?.killSwitch) return { allowed: false, reason: "kill_switch", capMicros: budget.monthlyCapMicros ?? null, spentMicros: 0 };
    const cap = budget?.monthlyCapMicros ?? null;
    if (cap == null) return { allowed: true, reason: "ok", capMicros: null, spentMicros: 0 };
    const spent = await monthToDateSpendMicros(ctx.db, ctx.businessId, ctx.now);
    if (spent >= cap) return { allowed: false, reason: "cap_reached", capMicros: cap, spentMicros: spent };
    return { allowed: true, reason: "ok", capMicros: cap, spentMicros: spent };
  } catch (err) {
    // Never let a metering failure block AI; fail open.
    ctx.logger.warn("ai budget check failed, allowing", { error: String(err) });
    return { allowed: true, reason: "ok", capMicros: null, spentMicros: 0 };
  }
}

// ─── Platform admin AI-usage overview ────────────────────────────────────────

/** Minimal context the overview needs — avoids importing admin.ts (and its import cycle). */
export interface AiUsageQueryContext {
  db: Db;
  now: number;
}

export async function platformAiUsage(ctx: AiUsageQueryContext, days = 30) {
  const since = ctx.now - days * 86_400_000;
  const base = (extra: SQL[] = []) => and(gte(aiUsageEvents.createdAt, since), ...extra);
  const [totals, byTask, byModel, topBiz] = await Promise.all([
    ctx.db
      .select({
        calls: sql<number>`count(*)`,
        cost: sql<number>`coalesce(sum(${aiUsageEvents.estCostMicros}), 0)`,
        inTok: sql<number>`coalesce(sum(${aiUsageEvents.inputTokens}), 0)`,
        outTok: sql<number>`coalesce(sum(${aiUsageEvents.outputTokens}), 0)`,
        audioMs: sql<number>`coalesce(sum(${aiUsageEvents.audioMs}), 0)`,
        errors: sql<number>`sum(case when ${aiUsageEvents.status} <> 'ok' then 1 else 0 end)`,
        retries: sql<number>`coalesce(sum(${aiUsageEvents.retryCount}), 0)`,
        businesses: sql<number>`count(distinct ${aiUsageEvents.businessId})`,
      })
      .from(aiUsageEvents)
      .where(base())
      .get(),
    ctx.db.select({ task: aiUsageEvents.task, calls: sql<number>`count(*)`, cost: sql<number>`coalesce(sum(${aiUsageEvents.estCostMicros}), 0)` }).from(aiUsageEvents).where(base()).groupBy(aiUsageEvents.task),
    ctx.db.select({ model: aiUsageEvents.model, calls: sql<number>`count(*)`, cost: sql<number>`coalesce(sum(${aiUsageEvents.estCostMicros}), 0)` }).from(aiUsageEvents).where(base()).groupBy(aiUsageEvents.model),
    ctx.db
      .select({ businessId: aiUsageEvents.businessId, name: businesses.name, calls: sql<number>`count(*)`, cost: sql<number>`coalesce(sum(${aiUsageEvents.estCostMicros}), 0)` })
      .from(aiUsageEvents)
      .leftJoin(businesses, eq(businesses.id, aiUsageEvents.businessId))
      .where(base())
      .groupBy(aiUsageEvents.businessId, businesses.name)
      .orderBy(desc(sql`3`))
      .limit(10),
  ]);
  const n = (v: unknown) => Number(v ?? 0);
  const calls = n(totals?.calls);
  return {
    days,
    priceVersion: AI_PRICE_VERSION,
    totals: {
      calls,
      costMicros: n(totals?.cost),
      inputTokens: n(totals?.inTok),
      outputTokens: n(totals?.outTok),
      audioMs: n(totals?.audioMs),
      errors: n(totals?.errors),
      retries: n(totals?.retries),
      businesses: n(totals?.businesses),
      costPer1kCallsMicros: calls ? Math.round((n(totals?.cost) / calls) * 1000) : 0,
    },
    byTask: byTask.map((t) => ({ task: t.task, calls: n(t.calls), costMicros: n(t.cost) })),
    byModel: byModel.map((m) => ({ model: m.model, calls: n(m.calls), costMicros: n(m.cost) })),
    topBusinesses: topBiz.map((b) => ({ businessId: b.businessId, name: b.name ?? "—", calls: n(b.calls), costMicros: n(b.cost) })),
  };
}

export type PlatformAiUsage = Awaited<ReturnType<typeof platformAiUsage>>;

/** Small helper used by callers to log a skipped (budget-limited) call without a provider hit. */
export function budgetSkipLog(logger: Logger, decision: BudgetDecision) {
  logger.info("ai call skipped by budget", { reason: decision.reason, spentMicros: decision.spentMicros, capMicros: decision.capMicros });
}

/** A shop owner's own month-to-date AI usage and budget (read-only; the cap is set by platform). */
export async function ownAiUsage(ctx: ServiceContext) {
  const since = istMonthStartMs(ctx.now);
  const [budget, spend, byTask, calls] = await Promise.all([
    ctx.db.select().from(aiBudgets).where(eq(aiBudgets.businessId, ctx.businessId)).get(),
    monthToDateSpendMicros(ctx.db, ctx.businessId, ctx.now),
    ctx.db
      .select({ task: aiUsageEvents.task, costMicros: sql<number>`coalesce(sum(${aiUsageEvents.estCostMicros}), 0)`, calls: sql<number>`count(*)` })
      .from(aiUsageEvents)
      .where(and(eq(aiUsageEvents.businessId, ctx.businessId), gte(aiUsageEvents.createdAt, since)))
      .groupBy(aiUsageEvents.task),
    ctx.db.select({ n: sql<number>`count(*)` }).from(aiUsageEvents).where(and(eq(aiUsageEvents.businessId, ctx.businessId), gte(aiUsageEvents.createdAt, since))).get(),
  ]);
  const cap = budget?.monthlyCapMicros ?? null;
  return {
    monthSpendMicros: spend,
    monthCapMicros: cap,
    killSwitch: budget?.killSwitch ?? false,
    pctUsed: cap && cap > 0 ? Math.min(100, Math.round((spend / cap) * 100)) : null,
    callsThisMonth: Number(calls?.n ?? 0),
    byTask: byTask.map((t) => ({ task: t.task, costMicros: Number(t.costMicros), calls: Number(t.calls) })),
  };
}
