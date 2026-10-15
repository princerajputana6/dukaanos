/**
 * POS cash-drawer shifts (cashbook). Expected cash is derived from real transactions in the
 * shift window — cash sales + cash received − cash paid out − cash expenses — never stored as a
 * running counter that could drift. Closing records the counted amount and the difference.
 */
import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { newId } from "@/lib/ids";
import type { closeShiftSchema, openShiftSchema } from "@/schemas/shift";
import { payments, posShifts, users } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { requirePermission, type ServiceContext } from "./context";
import { auditStmt, commit, eventStmt } from "./engine";

/** Over this absolute difference at close, the shift is flagged for review in the audit log. */
const MISMATCH_FLAG_PAISE = 10_000; // ₹100

/**
 * All cash flow comes from the unified `payments` ledger (cash sales, cash expenses, customer
 * and supplier cash payments all post a row there), so this never double-counts. The buckets are
 * for display; the expected total is simply opening + cash in − cash out.
 */
async function sumCash(ctx: ServiceContext, from: number, to: number) {
  const q = (dir: "IN" | "OUT", ref: SQL) =>
    ctx.db
      .select({ v: sql<number>`coalesce(sum(${payments.amountPaise}), 0)` })
      .from(payments)
      .where(and(eq(payments.businessId, ctx.businessId), gte(payments.createdAt, from), lt(payments.createdAt, to), eq(payments.method, "CASH"), eq(payments.direction, dir), eq(payments.status, "COMPLETED"), ref))
      .get();
  const [cashSales, cashIn, cashExpense, cashOut] = await Promise.all([
    q("IN", eq(payments.referenceType, "sale")),
    q("IN", sql`${payments.referenceType} <> 'sale'`),
    q("OUT", eq(payments.referenceType, "expense")),
    q("OUT", sql`${payments.referenceType} <> 'expense'`),
  ]);
  const n = (v: unknown) => Number(v ?? 0);
  return { cashSalesPaise: n(cashSales?.v), cashInPaise: n(cashIn?.v), cashOutPaise: n(cashOut?.v), cashExpensePaise: n(cashExpense?.v) };
}

export interface ShiftSummary {
  id: string;
  status: string;
  openingCashPaise: number;
  openedAt: number;
  openedBy: string | null;
  cashSalesPaise: number;
  cashInPaise: number;
  cashOutPaise: number;
  cashExpensePaise: number;
  expectedCashPaise: number;
  countedCashPaise: number | null;
  differencePaise: number | null;
  note: string | null;
  closedAt: number | null;
}

function toSummary(row: typeof posShifts.$inferSelect, cash: Awaited<ReturnType<typeof sumCash>>, openedByName: string | null): ShiftSummary {
  const expected = row.openingCashPaise + cash.cashSalesPaise + cash.cashInPaise - cash.cashOutPaise - cash.cashExpensePaise;
  return {
    id: row.id,
    status: row.status,
    openingCashPaise: row.openingCashPaise,
    openedAt: row.openedAt,
    openedBy: openedByName,
    ...cash,
    expectedCashPaise: row.status === "OPEN" ? expected : (row.expectedCashPaise ?? expected),
    countedCashPaise: row.countedCashPaise,
    differencePaise: row.differencePaise,
    note: row.note,
    closedAt: row.closedAt,
  };
}

/** The business's open shift with a live cash summary, or null. */
export async function currentShift(ctx: ServiceContext): Promise<ShiftSummary | null> {
  const row = await ctx.db.select().from(posShifts).where(and(eq(posShifts.businessId, ctx.businessId), eq(posShifts.status, "OPEN"))).get();
  if (!row) return null;
  const [cash, by] = await Promise.all([sumCash(ctx, row.openedAt, ctx.now), ctx.db.select({ name: users.name }).from(users).where(eq(users.id, row.openedBy ?? "")).get()]);
  return toSummary(row, cash, by?.name ?? null);
}

export async function openShift(ctx: ServiceContext, input: z.output<typeof openShiftSchema>) {
  requirePermission(ctx, "sales.create");
  const existing = await ctx.db.select({ id: posShifts.id }).from(posShifts).where(and(eq(posShifts.businessId, ctx.businessId), eq(posShifts.status, "OPEN"))).get();
  if (existing) throw new AppError("INVALID_STATE", "A shift is already open. Close it before opening a new one.");
  const id = newId(ctx.now);
  await commit(ctx, [
    ctx.db.insert(posShifts).values({ id, businessId: ctx.businessId, status: "OPEN", openingCashPaise: input.openingCashPaise, openedBy: ctx.userId, openedAt: ctx.now, createdAt: ctx.now }),
    auditStmt(ctx, { action: "SHIFT_OPENED", entityType: "pos_shift", entityId: id, summary: `Opened shift with ₹${(input.openingCashPaise / 100).toFixed(2)} float`, after: { openingCashPaise: input.openingCashPaise } }),
    eventStmt(ctx, "shift_opened", {}),
  ], null);
  return (await currentShift(ctx))!;
}

export async function closeShift(ctx: ServiceContext, input: z.output<typeof closeShiftSchema>) {
  requirePermission(ctx, "sales.create");
  const row = await ctx.db.select().from(posShifts).where(and(eq(posShifts.businessId, ctx.businessId), eq(posShifts.status, "OPEN"))).get();
  if (!row) throw new AppError("INVALID_STATE", "There is no open shift to close.");
  const cash = await sumCash(ctx, row.openedAt, ctx.now);
  const expected = row.openingCashPaise + cash.cashSalesPaise + cash.cashInPaise - cash.cashOutPaise - cash.cashExpensePaise;
  const difference = input.countedCashPaise - expected;
  const flagged = Math.abs(difference) >= MISMATCH_FLAG_PAISE;
  if (flagged && !input.note) throw new AppError("VALIDATION_ERROR", `Cash is off by ₹${Math.abs(difference / 100).toFixed(2)}. Add a note explaining the difference before closing.`);
  await commit(ctx, [
    ctx.db.update(posShifts).set({ status: "CLOSED", expectedCashPaise: expected, countedCashPaise: input.countedCashPaise, differencePaise: difference, note: input.note ?? null, closedBy: ctx.userId, closedAt: ctx.now }).where(eq(posShifts.id, row.id)),
    auditStmt(ctx, {
      action: flagged ? "SHIFT_CLOSED_MISMATCH" : "SHIFT_CLOSED",
      entityType: "pos_shift",
      entityId: row.id,
      summary: `Closed shift — expected ₹${(expected / 100).toFixed(2)}, counted ₹${(input.countedCashPaise / 100).toFixed(2)}, diff ₹${(difference / 100).toFixed(2)}`,
      after: { expectedCashPaise: expected, countedCashPaise: input.countedCashPaise, differencePaise: difference, flagged },
    }),
    eventStmt(ctx, "shift_closed", { flagged, differencePaise: difference }),
  ], null);
  return toSummary({ ...row, status: "CLOSED", expectedCashPaise: expected, countedCashPaise: input.countedCashPaise, differencePaise: difference, note: input.note ?? null, closedAt: ctx.now }, cash, null);
}

export async function listShifts(ctx: ServiceContext, limit = 30) {
  return ctx.db
    .select({ id: posShifts.id, status: posShifts.status, openingCashPaise: posShifts.openingCashPaise, expectedCashPaise: posShifts.expectedCashPaise, countedCashPaise: posShifts.countedCashPaise, differencePaise: posShifts.differencePaise, openedAt: posShifts.openedAt, closedAt: posShifts.closedAt, openedBy: users.name })
    .from(posShifts)
    .leftJoin(users, eq(users.id, posShifts.openedBy))
    .where(eq(posShifts.businessId, ctx.businessId))
    .orderBy(desc(posShifts.openedAt))
    .limit(Math.min(100, limit));
}
