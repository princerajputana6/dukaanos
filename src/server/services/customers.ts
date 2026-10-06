import { and, asc, desc, eq, gt, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { toCsv } from "@/lib/csv";
import { newId } from "@/lib/ids";
import { formatMoney, paiseToRupeeString } from "@/lib/money";
import { buildSearchText } from "@/lib/text";
import { customers, customerTransactions, payments, reversals, sales, users } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import type {
  createCustomerSchema,
  customerCreditSchema,
  ledgerAdjustmentSchema,
  listPartiesSchema,
  partyPaymentSchema,
  updateCustomerSchema,
} from "@/schemas/parties";
import { requirePermission, type ServiceContext } from "./context";
import { auditStmt, checkIdempotency, commit, eventStmt, type Stmt } from "./engine";
import { ledgerStmts, paymentStmt, resolveTxnDate, reversePaymentsStmt } from "./ledger";
import { searchCondition } from "./products";

type CreateInput = z.output<typeof createCustomerSchema>;
type UpdateInput = z.output<typeof updateCustomerSchema>;
type ListInput = z.output<typeof listPartiesSchema>;

export async function getCustomerRow(ctx: ServiceContext, id: string) {
  const c = await ctx.db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.businessId, ctx.businessId)))
    .get();
  if (!c) throw new AppError("CUSTOMER_NOT_FOUND", "Customer not found.");
  return c;
}

async function assertPhoneFree(ctx: ServiceContext, phone: string | null | undefined, exceptId?: string) {
  if (!phone) return;
  const other = await ctx.db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.businessId, ctx.businessId), eq(customers.phone, phone), eq(customers.isActive, true)))
    .get();
  if (other && other.id !== exceptId) throw new AppError("DUPLICATE", `This number already belongs to ${other.name}.`);
}

export async function createCustomer(ctx: ServiceContext, input: CreateInput, idempotencyKey?: string | null) {
  requirePermission(ctx, "customer.create");
  const idem = await checkIdempotency<{ id: string; name: string }>(ctx, idempotencyKey, { op: "createCustomer", input });
  if ("replay" in idem) return idem.replay;
  await assertPhoneFree(ctx, input.phone);
  const id = newId(ctx.now);
  const stmts: Stmt[] = [
    ctx.db.insert(customers).values({
      id,
      businessId: ctx.businessId,
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? null,
      stateCode: input.stateCode ?? null,
      notes: input.notes ?? null,
      balancePaise: 0,
      searchText: buildSearchText(input.name, input.phone),
      createdBy: ctx.userId,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    }),
  ];
  if (input.openingBalancePaise > 0) {
    stmts.push(
      ...ledgerStmts(ctx, "customer", {
        partyId: id,
        type: "ADJUSTMENT",
        amountPaise: input.openingBalancePaise,
        note: "Opening balance (carried over)",
        txnDate: resolveTxnDate(ctx),
      }),
    );
  }
  stmts.push(
    auditStmt(ctx, {
      action: "CUSTOMER_CREATED",
      entityType: "customer",
      entityId: id,
      summary: `Added customer ${input.name}${input.openingBalancePaise ? ` (opening ${formatMoney(input.openingBalancePaise)})` : ""}`,
      after: input,
    }),
  );
  return commit(ctx, stmts, { id, name: input.name }, idem.ticket);
}

export async function updateCustomer(ctx: ServiceContext, id: string, input: UpdateInput) {
  requirePermission(ctx, "customer.create");
  const before = await getCustomerRow(ctx, id);
  if (input.phone !== undefined) await assertPhoneFree(ctx, input.phone, id);
  if (input.isActive === false && before.balancePaise !== 0) {
    throw new AppError("CONFLICT", `Settle the outstanding ${formatMoney(before.balancePaise)} before archiving this customer.`);
  }
  const name = input.name ?? before.name;
  const phone = input.phone !== undefined ? input.phone : before.phone;
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  await commit(
    ctx,
    [
      ctx.db
        .update(customers)
        .set({ ...patch, searchText: buildSearchText(name, phone), updatedAt: ctx.now })
        .where(and(eq(customers.id, id), eq(customers.businessId, ctx.businessId))),
      auditStmt(ctx, {
        action: input.isActive === false ? "CUSTOMER_ARCHIVED" : "CUSTOMER_UPDATED",
        entityType: "customer",
        entityId: id,
        summary: `${input.isActive === false ? "Archived" : "Updated"} customer ${name}`,
        before: Object.fromEntries(Object.keys(patch).map((k) => [k, (before as Record<string, unknown>)[k]])),
        after: patch,
      }),
    ],
    null,
  );
  return { id };
}

export async function listCustomers(ctx: ServiceContext, input: ListInput) {
  const offset = Number(input.cursor ?? 0) || 0;
  const conds: SQL[] = [eq(customers.businessId, ctx.businessId), eq(customers.isActive, input.status === "active")];
  if (input.filter === "outstanding") conds.push(gt(customers.balancePaise, 0));
  if (input.q) {
    const s = searchCondition(customers.searchText, input.q);
    if (s) conds.push(s);
  }
  const order =
    input.sort === "balance" ? [desc(customers.balancePaise)] : input.sort === "name" ? [asc(sql`lower(${customers.name})`)] : [desc(sql`coalesce(${customers.lastTxnAt}, ${customers.createdAt})`)];
  const rows = await ctx.db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      balancePaise: customers.balancePaise,
      lastTxnAt: customers.lastTxnAt,
      createdAt: customers.createdAt,
      totalPurchasesPaise: sql<number>`(select coalesce(sum(s.total_paise), 0) from sales s where s.business_id = ${ctx.businessId} and s.customer_id = ${customers.id} and s.status = 'COMPLETED')`,
    })
    .from(customers)
    .where(and(...conds))
    .orderBy(...order)
    .limit(input.limit + 1)
    .offset(offset);
  const [totals] = await ctx.db
    .select({ outstanding: sql<number>`coalesce(sum(case when ${customers.balancePaise} > 0 then ${customers.balancePaise} else 0 end), 0)`, count: sql<number>`sum(case when ${customers.balancePaise} > 0 then 1 else 0 end)` })
    .from(customers)
    .where(and(eq(customers.businessId, ctx.businessId), eq(customers.isActive, true)));
  const hasMore = rows.length > input.limit;
  return {
    items: rows.slice(0, input.limit),
    nextCursor: hasMore ? String(offset + input.limit) : null,
    totals: { outstandingPaise: Number(totals?.outstanding ?? 0), withOutstanding: Number(totals?.count ?? 0) },
  };
}

export async function getCustomerDetail(ctx: ServiceContext, id: string, opts: { cursor?: string; limit?: number } = {}) {
  const customer = await getCustomerRow(ctx, id);
  const limit = opts.limit ?? 50;
  const offset = Number(opts.cursor ?? 0) || 0;
  const [ledger, stats] = await Promise.all([
    ctx.db
      .select({
        id: customerTransactions.id,
        type: customerTransactions.type,
        amountPaise: customerTransactions.amountPaise,
        balanceAfterPaise: customerTransactions.balanceAfterPaise,
        method: customerTransactions.method,
        referenceType: customerTransactions.referenceType,
        referenceId: customerTransactions.referenceId,
        note: customerTransactions.note,
        status: customerTransactions.status,
        txnDate: customerTransactions.txnDate,
        source: customerTransactions.source,
        createdAt: customerTransactions.createdAt,
        createdByName: users.name,
      })
      .from(customerTransactions)
      .leftJoin(users, eq(users.id, customerTransactions.createdBy))
      .where(and(eq(customerTransactions.businessId, ctx.businessId), eq(customerTransactions.customerId, id)))
      .orderBy(desc(customerTransactions.createdAt), desc(customerTransactions.id))
      .limit(limit + 1)
      .offset(offset),
    ctx.db
      .select({ count: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${sales.totalPaise}), 0)`, last: sql<number>`max(${sales.createdAt})` })
      .from(sales)
      .where(and(eq(sales.businessId, ctx.businessId), eq(sales.customerId, id), eq(sales.status, "COMPLETED")))
      .get(),
  ]);
  return {
    customer,
    stats: { orders: Number(stats?.count ?? 0), totalPurchasesPaise: Number(stats?.total ?? 0), lastSaleAt: stats?.last ?? null },
    ledger: ledger.slice(0, limit),
    nextCursor: ledger.length > limit ? String(offset + limit) : null,
  };
}

type PaymentInput = z.output<typeof partyPaymentSchema>;
type CreditInput = z.output<typeof customerCreditSchema>;
type AdjustInput = z.output<typeof ledgerAdjustmentSchema>;

export interface LedgerResult {
  entryId: string;
  customerId: string;
  customerName: string;
  amountPaise: number;
  balanceAfterPaise: number;
}

/** "Ramesh ne ₹500 diye" — payment received against the khata. */
export async function recordCustomerPayment(ctx: ServiceContext, customerId: string, input: PaymentInput, idempotencyKey?: string | null) {
  requirePermission(ctx, "customer.ledger");
  const idem = await checkIdempotency<LedgerResult>(ctx, idempotencyKey, { op: "customerPayment", customerId, input });
  if ("replay" in idem) return idem.replay;
  const c = await getCustomerRow(ctx, customerId);
  const txnDate = resolveTxnDate(ctx, input.txnDate);
  const entryId = newId(ctx.now);
  const result: LedgerResult = { entryId, customerId, customerName: c.name, amountPaise: input.amountPaise, balanceAfterPaise: c.balancePaise - input.amountPaise };
  return commit(
    ctx,
    [
      ...ledgerStmts(ctx, "customer", { id: entryId, partyId: customerId, type: "PAYMENT", amountPaise: -input.amountPaise, method: input.method, note: input.note, txnDate }),
      paymentStmt(ctx, { direction: "IN", partyType: "CUSTOMER", partyId: customerId, method: input.method, amountPaise: input.amountPaise, referenceType: "customer_txn", referenceId: entryId, txnDate }),
      auditStmt(ctx, {
        action: "CUSTOMER_PAYMENT",
        entityType: "customer",
        entityId: customerId,
        summary: `${c.name} paid ${formatMoney(input.amountPaise)} (${input.method})`,
        before: { balancePaise: c.balancePaise },
        after: { balancePaise: result.balanceAfterPaise, amountPaise: input.amountPaise, method: input.method, entryId },
      }),
      eventStmt(ctx, "customer_payment"),
    ],
    result,
    idem.ticket,
  );
}

/** "Ramesh ka ₹850 udhaar likh do" — manual credit entry. */
export async function recordCustomerCredit(ctx: ServiceContext, customerId: string, input: CreditInput, idempotencyKey?: string | null) {
  requirePermission(ctx, "customer.ledger");
  const idem = await checkIdempotency<LedgerResult>(ctx, idempotencyKey, { op: "customerCredit", customerId, input });
  if ("replay" in idem) return idem.replay;
  const c = await getCustomerRow(ctx, customerId);
  const txnDate = resolveTxnDate(ctx, input.txnDate);
  const entryId = newId(ctx.now);
  const result: LedgerResult = { entryId, customerId, customerName: c.name, amountPaise: input.amountPaise, balanceAfterPaise: c.balancePaise + input.amountPaise };
  return commit(
    ctx,
    [
      ...ledgerStmts(ctx, "customer", { id: entryId, partyId: customerId, type: "CREDIT", amountPaise: input.amountPaise, note: input.note, txnDate }),
      auditStmt(ctx, {
        action: "CUSTOMER_CREDIT",
        entityType: "customer",
        entityId: customerId,
        summary: `Udhaar ${formatMoney(input.amountPaise)} for ${c.name}${input.note ? ` — ${input.note}` : ""}`,
        before: { balancePaise: c.balancePaise },
        after: { balancePaise: result.balanceAfterPaise, amountPaise: input.amountPaise, entryId },
      }),
      eventStmt(ctx, "customer_credit"),
    ],
    result,
    idem.ticket,
  );
}

export async function adjustCustomerBalance(ctx: ServiceContext, customerId: string, input: AdjustInput, idempotencyKey?: string | null) {
  requirePermission(ctx, "customer.ledger");
  const idem = await checkIdempotency<LedgerResult>(ctx, idempotencyKey, { op: "customerAdjust", customerId, input });
  if ("replay" in idem) return idem.replay;
  const c = await getCustomerRow(ctx, customerId);
  const entryId = newId(ctx.now);
  const result: LedgerResult = { entryId, customerId, customerName: c.name, amountPaise: input.amountPaise, balanceAfterPaise: c.balancePaise + input.amountPaise };
  return commit(
    ctx,
    [
      ...ledgerStmts(ctx, "customer", { id: entryId, partyId: customerId, type: "ADJUSTMENT", amountPaise: input.amountPaise, note: input.note, txnDate: resolveTxnDate(ctx, input.txnDate) }),
      auditStmt(ctx, {
        action: "CUSTOMER_ADJUSTMENT",
        entityType: "customer",
        entityId: customerId,
        summary: `Adjusted ${c.name}'s balance by ${formatMoney(input.amountPaise)} — ${input.note}`,
        before: { balancePaise: c.balancePaise },
        after: { balancePaise: result.balanceAfterPaise, entryId },
      }),
    ],
    result,
    idem.ticket,
  );
}

/**
 * Reverses a manual ledger entry (payment, credit or adjustment) with a compensating entry.
 * Sale credits are reversed by reversing the sale itself.
 */
export async function reverseCustomerEntry(ctx: ServiceContext, customerId: string, entryId: string, reason: string | undefined, idempotencyKey?: string | null) {
  requirePermission(ctx, "customer.ledger");
  requirePermission(ctx, "sales.delete");
  const idem = await checkIdempotency<LedgerResult>(ctx, idempotencyKey, { op: "reverseCustomerEntry", customerId, entryId });
  if ("replay" in idem) return idem.replay;
  const c = await getCustomerRow(ctx, customerId);
  const entry = await ctx.db
    .select()
    .from(customerTransactions)
    .where(and(eq(customerTransactions.id, entryId), eq(customerTransactions.businessId, ctx.businessId), eq(customerTransactions.customerId, customerId)))
    .get();
  if (!entry) throw new AppError("NOT_FOUND", "Entry not found.");
  if (entry.status === "REVERSED") throw new AppError("ALREADY_REVERSED", "This entry has already been reversed.");
  if (!["PAYMENT", "CREDIT", "ADJUSTMENT"].includes(entry.type)) {
    throw new AppError("VALIDATION_ERROR", "Sale entries are reversed by undoing the sale.");
  }
  const reversalId = newId(ctx.now);
  const result: LedgerResult = { entryId: reversalId, customerId, customerName: c.name, amountPaise: -entry.amountPaise, balanceAfterPaise: c.balancePaise - entry.amountPaise };
  const stmts: Stmt[] = [
    ctx.db.insert(reversals).values({ businessId: ctx.businessId, entityType: "customer_txn", entityId: entryId, reason: reason ?? null, createdBy: ctx.userId, source: ctx.source, createdAt: ctx.now }),
    ctx.db.update(customerTransactions).set({ status: "REVERSED" }).where(and(eq(customerTransactions.id, entryId), eq(customerTransactions.businessId, ctx.businessId))),
    ...ledgerStmts(ctx, "customer", {
      id: reversalId,
      partyId: customerId,
      type: "REVERSAL",
      amountPaise: -entry.amountPaise,
      referenceType: "customer_txn",
      referenceId: entryId,
      note: reason ? `Reversal: ${reason}` : "Reversal",
      txnDate: resolveTxnDate(ctx),
    }),
    auditStmt(ctx, {
      action: "CUSTOMER_ENTRY_REVERSED",
      entityType: "customer",
      entityId: customerId,
      summary: `Reversed ${entry.type.toLowerCase()} of ${formatMoney(Math.abs(entry.amountPaise))} for ${c.name}`,
      before: { entry, balancePaise: c.balancePaise },
      after: { balancePaise: result.balanceAfterPaise, reason },
    }),
  ];
  if (entry.type === "PAYMENT") stmts.push(reversePaymentsStmt(ctx, "customer_txn", entryId));
  return commit(ctx, stmts, result, idem.ticket);
}

export async function exportCustomersCsv(ctx: ServiceContext) {
  const rows = await ctx.db
    .select()
    .from(customers)
    .where(eq(customers.businessId, ctx.businessId))
    .orderBy(asc(customers.name));
  return toCsv(
    ["name", "phone", "email", "address", "state_code", "outstanding", "active", "notes"],
    rows.map((r) => [r.name, r.phone, r.email, r.address, r.stateCode, paiseToRupeeString(r.balancePaise), r.isActive ? "yes" : "no", r.notes]),
  );
}

/** Money received today from customers (khata payments), used by dashboards. */
export async function customerCollections(ctx: ServiceContext, from: string, to: string) {
  const row = await ctx.db
    .select({ total: sql<number>`coalesce(sum(${payments.amountPaise}), 0)` })
    .from(payments)
    .where(
      and(
        eq(payments.businessId, ctx.businessId),
        eq(payments.status, "COMPLETED"),
        eq(payments.referenceType, "customer_txn"),
        sql`${payments.txnDate} between ${from} and ${to}`,
      ),
    )
    .get();
  return Number(row?.total ?? 0);
}
