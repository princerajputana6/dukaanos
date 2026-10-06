import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { formatMoney } from "@/lib/money";
import { newId } from "@/lib/ids";
import { addDays, todayIst } from "@/lib/dates";
import type { Db } from "@/server/db/client";
import { businesses, businessSettings, customers, dailySummaries, notifications } from "@/server/db/schema";
import type { Logger } from "@/server/lib/logger";
import type { ServiceContext } from "./context";
import { expenseTotal, outstandingTotals, salesTotals, topProducts } from "./reports";

const visibleTo = (ctx: ServiceContext) => and(eq(notifications.businessId, ctx.businessId), or(isNull(notifications.userId), eq(notifications.userId, ctx.userId)));

export async function listNotifications(ctx: ServiceContext, opts: { cursor?: string; limit?: number; unreadOnly?: boolean }) {
  const limit = opts.limit ?? 30;
  const offset = Number(opts.cursor ?? 0) || 0;
  const conds = [visibleTo(ctx)!];
  if (opts.unreadOnly) conds.push(isNull(notifications.readAt));
  // Money-related notifications are only for members who can see money totals.
  if (!ctx.permissions.has("reports.view")) conds.push(sql`${notifications.type} <> 'DAILY_SUMMARY'`);
  const rows = await ctx.db
    .select()
    .from(notifications)
    .where(and(...conds))
    .orderBy(desc(notifications.createdAt))
    .limit(limit + 1)
    .offset(offset);
  return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? String(offset + limit) : null };
}

export async function unreadCount(ctx: ServiceContext) {
  const conds = [visibleTo(ctx)!, isNull(notifications.readAt)];
  if (!ctx.permissions.has("reports.view")) conds.push(sql`${notifications.type} <> 'DAILY_SUMMARY'`);
  const row = await ctx.db.select({ n: sql<number>`count(*)` }).from(notifications).where(and(...conds)).get();
  return Number(row?.n ?? 0);
}

export async function markRead(ctx: ServiceContext, id: string | "all") {
  const where = id === "all" ? and(visibleTo(ctx), isNull(notifications.readAt)) : and(visibleTo(ctx), eq(notifications.id, id));
  await ctx.db.update(notifications).set({ readAt: ctx.now }).where(where);
  return { ok: true };
}

/**
 * Nightly job (cron, 21:00 IST): daily summary + outstanding reminders for every business.
 * Uses a SYSTEM context per business; deduplicated per day so re-runs are harmless.
 */
export async function runDailyJobs(db: Db, env: Env, now: number, logger: Logger) {
  const today = todayIst(now);
  const list = await db
    .select({ id: businesses.id, name: businesses.name, settings: businessSettings })
    .from(businesses)
    .innerJoin(businessSettings, eq(businessSettings.businessId, businesses.id))
    .where(sql`${businesses.onboardedAt} is not null`);
  let done = 0;
  for (const b of list) {
    const ctx: ServiceContext = {
      db,
      env,
      businessId: b.id,
      userId: "system",
      userName: "DukaanOS",
      roleKey: "system",
      permissions: new Set(["reports.view"]),
      source: "SYSTEM",
      requestId: `cron-${today}`,
      ip: null,
      now,
      logger: logger.child({ businessId: b.id, job: "daily" }),
    };
    try {
      const range = { from: today, to: today };
      const [t, exp, top] = await Promise.all([salesTotals(ctx, range), expenseTotal(ctx, range), topProducts(ctx, range, 1)]);
      await db
        .insert(dailySummaries)
        .values({ businessId: b.id, date: today, salesPaise: t.totalPaise, orders: t.orders, grossProfitPaise: t.grossProfitPaise, expensesPaise: exp, createdAt: now })
        .onConflictDoUpdate({
          target: [dailySummaries.businessId, dailySummaries.date],
          set: { salesPaise: t.totalPaise, orders: t.orders, grossProfitPaise: t.grossProfitPaise, expensesPaise: exp, createdAt: now },
        });
      if (b.settings.dailySummaryNotifications) {
        const body =
          t.orders === 0
            ? "No sales were recorded today."
            : `Sales ${formatMoney(t.totalPaise, { compact: true })} from ${t.orders} bill${t.orders > 1 ? "s" : ""} · Profit ${formatMoney(t.grossProfitPaise, { compact: true })}${exp ? ` · Expenses ${formatMoney(exp, { compact: true })}` : ""}${top[0] ? ` · Top: ${top[0].name}` : ""}`;
        await db
          .insert(notifications)
          .values({ id: newId(now), businessId: b.id, type: "DAILY_SUMMARY", title: "Today's summary", body, link: "/reports", dedupeKey: `daily:${today}`, createdAt: now })
          .onConflictDoNothing();
      }
      if (b.settings.outstandingReminders) {
        const o = await outstandingTotals(ctx);
        // Weekly (Mondays in IST) reminder about dues older than 7 days.
        const isMonday = new Date(`${today}T00:00:00Z`).getUTCDay() === 1;
        if (isMonday && o.receivablePaise > 0) {
          const stale = await db
            .select({ n: sql<number>`count(*)` })
            .from(customers)
            .where(and(eq(customers.businessId, b.id), gt(customers.balancePaise, 0), sql`coalesce(${customers.lastTxnAt}, 0) < ${now - 7 * 86_400_000}`))
            .get();
          const n = Number(stale?.n ?? 0);
          if (n > 0) {
            await db
              .insert(notifications)
              .values({
                id: newId(now),
                businessId: b.id,
                type: "OUTSTANDING_REMINDER",
                title: "Pending udhaar",
                body: `${n} customer${n > 1 ? "s haven't" : " hasn't"} paid in over a week. Total outstanding: ${formatMoney(o.receivablePaise, { compact: true })}.`,
                link: "/customers?filter=outstanding",
                dedupeKey: `outstanding:${today}`,
                createdAt: now,
              })
              .onConflictDoNothing();
          }
        }
      }
      done++;
    } catch (err) {
      ctx.logger.error("daily job failed", { error: String(err) });
    }
  }
  // Housekeeping: idempotency keys older than 30 days are no longer needed.
  await db.run(sql`DELETE FROM idempotency_keys WHERE created_at < ${now - 30 * 86_400_000}`);
  await db.run(sql`DELETE FROM sessions WHERE expires_at < ${now}`);
  await db.run(sql`UPDATE ai_interactions SET status = 'EXPIRED' WHERE status IN ('PROPOSED','NEEDS_CLARIFICATION') AND expires_at < ${now}`);
  logger.info("daily jobs complete", { businesses: list.length, done, date: today, yesterday: addDays(today, -1) });
  return { businesses: list.length, done };
}
