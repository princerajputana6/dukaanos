import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { toCsv } from "@/lib/csv";
import { newId } from "@/lib/ids";
import { formatMoney, paiseToRupeeString } from "@/lib/money";
import { expenseCategories, expenses, reversals, users } from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import type { createExpenseSchema, listExpensesSchema } from "@/schemas/expenses";
import { requirePermission, type ServiceContext } from "./context";
import { auditStmt, checkIdempotency, commit, eventStmt, type Stmt } from "./engine";
import { paymentStmt, resolveTxnDate, reversePaymentsStmt } from "./ledger";

type CreateInput = z.output<typeof createExpenseSchema>;

export async function listExpenseCategories(ctx: ServiceContext) {
  return ctx.db
    .select({ id: expenseCategories.id, name: expenseCategories.name, isSystem: expenseCategories.isSystem })
    .from(expenseCategories)
    .where(eq(expenseCategories.businessId, ctx.businessId))
    .orderBy(asc(expenseCategories.name));
}

async function resolveCategory(ctx: ServiceContext, categoryId?: string, categoryName?: string) {
  if (categoryId) {
    const c = await ctx.db
      .select()
      .from(expenseCategories)
      .where(and(eq(expenseCategories.id, categoryId), eq(expenseCategories.businessId, ctx.businessId)))
      .get();
    if (!c) throw new AppError("VALIDATION_ERROR", "Expense category not found.");
    return { id: c.id, name: c.name, stmt: null as Stmt | null };
  }
  const name = categoryName!.trim();
  const existing = await ctx.db
    .select()
    .from(expenseCategories)
    .where(and(eq(expenseCategories.businessId, ctx.businessId), sql`lower(${expenseCategories.name}) = lower(${name})`))
    .get();
  if (existing) return { id: existing.id, name: existing.name, stmt: null };
  const id = newId(ctx.now);
  return { id, name, stmt: ctx.db.insert(expenseCategories).values({ id, businessId: ctx.businessId, name, createdAt: ctx.now }) as Stmt };
}

export async function createExpenseCategory(ctx: ServiceContext, name: string) {
  requirePermission(ctx, "expense.create");
  const c = await resolveCategory(ctx, undefined, name);
  if (c.stmt) await commit(ctx, [c.stmt, auditStmt(ctx, { action: "EXPENSE_CATEGORY_CREATED", entityType: "expense_category", entityId: c.id, summary: `Added expense category ${name}` })], null);
  return { id: c.id, name: c.name };
}

export interface ExpenseResult {
  id: string;
  amountPaise: number;
  categoryName: string;
  txnDate: string;
}

export async function createExpense(ctx: ServiceContext, input: CreateInput, idempotencyKey?: string | null) {
  requirePermission(ctx, "expense.create");
  const idem = await checkIdempotency<ExpenseResult>(ctx, idempotencyKey, { op: "createExpense", input });
  if ("replay" in idem) return idem.replay;
  const cat = await resolveCategory(ctx, input.categoryId, input.categoryName);
  const txnDate = resolveTxnDate(ctx, input.txnDate);
  const id = newId(ctx.now);
  const stmts: Stmt[] = [];
  if (cat.stmt) stmts.push(cat.stmt);
  stmts.push(
    ctx.db.insert(expenses).values({
      id,
      businessId: ctx.businessId,
      categoryId: cat.id,
      amountPaise: input.amountPaise,
      txnDate,
      paymentMethod: input.paymentMethod,
      notes: input.notes ?? null,
      source: ctx.source,
      createdBy: ctx.userId,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    }),
    paymentStmt(ctx, { direction: "OUT", partyType: null, partyId: null, method: input.paymentMethod, amountPaise: input.amountPaise, referenceType: "expense", referenceId: id, txnDate }),
    auditStmt(ctx, {
      action: "EXPENSE_CREATED",
      entityType: "expense",
      entityId: id,
      summary: `Expense ${formatMoney(input.amountPaise)} — ${cat.name}${input.notes ? ` (${input.notes})` : ""}`,
      after: { amountPaise: input.amountPaise, category: cat.name, txnDate, method: input.paymentMethod, notes: input.notes ?? null },
    }),
    eventStmt(ctx, "expense_created"),
  );
  return commit(ctx, stmts, { id, amountPaise: input.amountPaise, categoryName: cat.name, txnDate }, idem.ticket);
}

export async function listExpenses(ctx: ServiceContext, input: z.output<typeof listExpensesSchema>) {
  requirePermission(ctx, "expense.create");
  const offset = Number(input.cursor ?? 0) || 0;
  const conds: SQL[] = [eq(expenses.businessId, ctx.businessId)];
  if (input.from) conds.push(gte(expenses.txnDate, input.from));
  if (input.to) conds.push(lte(expenses.txnDate, input.to));
  if (input.categoryId) conds.push(eq(expenses.categoryId, input.categoryId));
  if (input.status !== "all") conds.push(eq(expenses.status, input.status));
  const where = and(...conds);
  const rows = await ctx.db
    .select({
      id: expenses.id,
      amountPaise: expenses.amountPaise,
      txnDate: expenses.txnDate,
      paymentMethod: expenses.paymentMethod,
      notes: expenses.notes,
      status: expenses.status,
      source: expenses.source,
      createdAt: expenses.createdAt,
      categoryId: expenses.categoryId,
      categoryName: expenseCategories.name,
      createdByName: users.name,
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .leftJoin(users, eq(users.id, expenses.createdBy))
    .where(where)
    .orderBy(desc(expenses.txnDate), desc(expenses.createdAt))
    .limit(input.limit + 1)
    .offset(offset);
  const byCategory = await ctx.db
    .select({ categoryName: expenseCategories.name, totalPaise: sql<number>`coalesce(sum(${expenses.amountPaise}), 0)` })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .where(and(where, eq(expenses.status, "COMPLETED")))
    .groupBy(expenseCategories.name)
    .orderBy(desc(sql`sum(${expenses.amountPaise})`));
  const hasMore = rows.length > input.limit;
  return {
    items: rows.slice(0, input.limit),
    nextCursor: hasMore ? String(offset + input.limit) : null,
    totals: { totalPaise: byCategory.reduce((a, b) => a + Number(b.totalPaise), 0), byCategory: byCategory.map((b) => ({ ...b, totalPaise: Number(b.totalPaise) })) },
  };
}

export async function reverseExpense(ctx: ServiceContext, id: string, reason: string | undefined, idempotencyKey?: string | null) {
  requirePermission(ctx, "expense.create");
  const idem = await checkIdempotency<{ id: string; status: "REVERSED" }>(ctx, idempotencyKey, { op: "reverseExpense", id });
  if ("replay" in idem) return idem.replay;
  const e = await ctx.db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.businessId, ctx.businessId)))
    .get();
  if (!e) throw notFound("Expense");
  if (e.status === "REVERSED") throw new AppError("ALREADY_REVERSED", "This expense was already reversed.");
  return commit(
    ctx,
    [
      ctx.db.insert(reversals).values({ businessId: ctx.businessId, entityType: "expense", entityId: id, reason: reason ?? null, createdBy: ctx.userId, source: ctx.source, createdAt: ctx.now }),
      ctx.db.update(expenses).set({ status: "REVERSED", reversedAt: ctx.now, reversedBy: ctx.userId, updatedAt: ctx.now }).where(and(eq(expenses.id, id), eq(expenses.businessId, ctx.businessId))),
      reversePaymentsStmt(ctx, "expense", id),
      auditStmt(ctx, {
        action: "EXPENSE_REVERSED",
        entityType: "expense",
        entityId: id,
        summary: `Reversed expense of ${formatMoney(e.amountPaise)}${reason ? ` — ${reason}` : ""}`,
        before: { status: e.status },
        after: { status: "REVERSED", reason: reason ?? null },
      }),
    ],
    { id, status: "REVERSED" as const },
    idem.ticket,
  );
}

export async function exportExpensesCsv(ctx: ServiceContext, from: string, to: string) {
  requirePermission(ctx, "expense.create");
  const rows = await ctx.db
    .select({ txnDate: expenses.txnDate, category: expenseCategories.name, amountPaise: expenses.amountPaise, method: expenses.paymentMethod, status: expenses.status, notes: expenses.notes })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .where(and(eq(expenses.businessId, ctx.businessId), gte(expenses.txnDate, from), lte(expenses.txnDate, to)))
    .orderBy(expenses.txnDate);
  return toCsv(["date", "category", "amount", "payment_method", "status", "notes"], rows.map((r) => [r.txnDate, r.category, paiseToRupeeString(r.amountPaise), r.method, r.status, r.notes]));
}
