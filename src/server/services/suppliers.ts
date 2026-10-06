import { and, asc, desc, eq, gt, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { toCsv } from "@/lib/csv";
import { newId } from "@/lib/ids";
import { formatMoney, paiseToRupeeString } from "@/lib/money";
import { buildSearchText } from "@/lib/text";
import { products, purchases, reversals, suppliers, supplierTransactions, users } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import type { createSupplierSchema, ledgerAdjustmentSchema, listPartiesSchema, partyPaymentSchema, updateSupplierSchema } from "@/schemas/parties";
import { requirePermission, type ServiceContext } from "./context";
import { auditStmt, checkIdempotency, commit, eventStmt, type Stmt } from "./engine";
import { ledgerStmts, paymentStmt, resolveTxnDate, reversePaymentsStmt } from "./ledger";
import { searchCondition } from "./products";

type CreateInput = z.output<typeof createSupplierSchema>;
type UpdateInput = z.output<typeof updateSupplierSchema>;
type ListInput = z.output<typeof listPartiesSchema>;

export async function getSupplierRow(ctx: ServiceContext, id: string) {
  const s = await ctx.db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, id), eq(suppliers.businessId, ctx.businessId)))
    .get();
  if (!s) throw new AppError("SUPPLIER_NOT_FOUND", "Supplier not found.");
  return s;
}

export async function createSupplier(ctx: ServiceContext, input: CreateInput, idempotencyKey?: string | null) {
  requirePermission(ctx, "supplier.create");
  const idem = await checkIdempotency<{ id: string; name: string }>(ctx, idempotencyKey, { op: "createSupplier", input });
  if ("replay" in idem) return idem.replay;
  const id = newId(ctx.now);
  const stmts: Stmt[] = [
    ctx.db.insert(suppliers).values({
      id,
      businessId: ctx.businessId,
      name: input.name,
      phone: input.phone ?? null,
      company: input.company ?? null,
      gstin: input.gstin ?? null,
      address: input.address ?? null,
      stateCode: input.stateCode ?? input.gstin?.slice(0, 2) ?? null,
      notes: input.notes ?? null,
      searchText: buildSearchText(input.name, input.company, input.phone),
      createdBy: ctx.userId,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    }),
  ];
  if (input.openingBalancePaise > 0) {
    stmts.push(
      ...ledgerStmts(ctx, "supplier", { partyId: id, type: "ADJUSTMENT", amountPaise: input.openingBalancePaise, note: "Opening balance (carried over)", txnDate: resolveTxnDate(ctx) }),
    );
  }
  stmts.push(auditStmt(ctx, { action: "SUPPLIER_CREATED", entityType: "supplier", entityId: id, summary: `Added supplier ${input.name}`, after: input }));
  return commit(ctx, stmts, { id, name: input.name }, idem.ticket);
}

export async function updateSupplier(ctx: ServiceContext, id: string, input: UpdateInput) {
  requirePermission(ctx, "supplier.create");
  const before = await getSupplierRow(ctx, id);
  if (input.isActive === false && before.balancePaise !== 0) {
    throw new AppError("CONFLICT", `Settle the outstanding ${formatMoney(before.balancePaise)} before archiving this supplier.`);
  }
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const name = input.name ?? before.name;
  await commit(
    ctx,
    [
      ctx.db
        .update(suppliers)
        .set({
          ...patch,
          searchText: buildSearchText(name, input.company !== undefined ? input.company : before.company, input.phone !== undefined ? input.phone : before.phone),
          updatedAt: ctx.now,
        })
        .where(and(eq(suppliers.id, id), eq(suppliers.businessId, ctx.businessId))),
      auditStmt(ctx, {
        action: input.isActive === false ? "SUPPLIER_ARCHIVED" : "SUPPLIER_UPDATED",
        entityType: "supplier",
        entityId: id,
        summary: `${input.isActive === false ? "Archived" : "Updated"} supplier ${name}`,
        before: Object.fromEntries(Object.keys(patch).map((k) => [k, (before as Record<string, unknown>)[k]])),
        after: patch,
      }),
    ],
    null,
  );
  return { id };
}

export async function listSuppliers(ctx: ServiceContext, input: ListInput) {
  const offset = Number(input.cursor ?? 0) || 0;
  const conds: SQL[] = [eq(suppliers.businessId, ctx.businessId), eq(suppliers.isActive, input.status === "active")];
  if (input.filter === "outstanding") conds.push(gt(suppliers.balancePaise, 0));
  if (input.q) {
    const s = searchCondition(suppliers.searchText, input.q);
    if (s) conds.push(s);
  }
  const order =
    input.sort === "balance" ? [desc(suppliers.balancePaise)] : input.sort === "name" ? [asc(sql`lower(${suppliers.name})`)] : [desc(sql`coalesce(${suppliers.lastTxnAt}, ${suppliers.createdAt})`)];
  const rows = await ctx.db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      company: suppliers.company,
      phone: suppliers.phone,
      gstin: suppliers.gstin,
      balancePaise: suppliers.balancePaise,
      lastTxnAt: suppliers.lastTxnAt,
      createdAt: suppliers.createdAt,
    })
    .from(suppliers)
    .where(and(...conds))
    .orderBy(...order)
    .limit(input.limit + 1)
    .offset(offset);
  const [totals] = await ctx.db
    .select({ outstanding: sql<number>`coalesce(sum(case when ${suppliers.balancePaise} > 0 then ${suppliers.balancePaise} else 0 end), 0)` })
    .from(suppliers)
    .where(and(eq(suppliers.businessId, ctx.businessId), eq(suppliers.isActive, true)));
  const hasMore = rows.length > input.limit;
  return { items: rows.slice(0, input.limit), nextCursor: hasMore ? String(offset + input.limit) : null, totals: { outstandingPaise: Number(totals?.outstanding ?? 0) } };
}

export async function getSupplierDetail(ctx: ServiceContext, id: string, opts: { cursor?: string; limit?: number } = {}) {
  const supplier = await getSupplierRow(ctx, id);
  const limit = opts.limit ?? 50;
  const offset = Number(opts.cursor ?? 0) || 0;
  const [ledger, stats, supplied] = await Promise.all([
    ctx.db
      .select({
        id: supplierTransactions.id,
        type: supplierTransactions.type,
        amountPaise: supplierTransactions.amountPaise,
        balanceAfterPaise: supplierTransactions.balanceAfterPaise,
        method: supplierTransactions.method,
        referenceType: supplierTransactions.referenceType,
        referenceId: supplierTransactions.referenceId,
        note: supplierTransactions.note,
        status: supplierTransactions.status,
        txnDate: supplierTransactions.txnDate,
        source: supplierTransactions.source,
        createdAt: supplierTransactions.createdAt,
        createdByName: users.name,
      })
      .from(supplierTransactions)
      .leftJoin(users, eq(users.id, supplierTransactions.createdBy))
      .where(and(eq(supplierTransactions.businessId, ctx.businessId), eq(supplierTransactions.supplierId, id)))
      .orderBy(desc(supplierTransactions.createdAt), desc(supplierTransactions.id))
      .limit(limit + 1)
      .offset(offset),
    ctx.db
      .select({ count: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${purchases.totalPaise}), 0)` })
      .from(purchases)
      .where(and(eq(purchases.businessId, ctx.businessId), eq(purchases.supplierId, id), eq(purchases.status, "COMPLETED")))
      .get(),
    ctx.db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(and(eq(products.businessId, ctx.businessId), eq(products.supplierId, id), eq(products.isActive, true)))
      .orderBy(asc(products.name))
      .limit(50),
  ]);
  return {
    supplier,
    stats: { purchases: Number(stats?.count ?? 0), totalPurchasesPaise: Number(stats?.total ?? 0) },
    productsSupplied: supplied,
    ledger: ledger.slice(0, limit),
    nextCursor: ledger.length > limit ? String(offset + limit) : null,
  };
}

export interface SupplierLedgerResult {
  entryId: string;
  supplierId: string;
  supplierName: string;
  amountPaise: number;
  balanceAfterPaise: number;
}

export async function recordSupplierPayment(ctx: ServiceContext, supplierId: string, input: z.output<typeof partyPaymentSchema>, idempotencyKey?: string | null) {
  requirePermission(ctx, "supplier.ledger");
  const idem = await checkIdempotency<SupplierLedgerResult>(ctx, idempotencyKey, { op: "supplierPayment", supplierId, input });
  if ("replay" in idem) return idem.replay;
  const s = await getSupplierRow(ctx, supplierId);
  const txnDate = resolveTxnDate(ctx, input.txnDate);
  const entryId = newId(ctx.now);
  const result: SupplierLedgerResult = { entryId, supplierId, supplierName: s.name, amountPaise: input.amountPaise, balanceAfterPaise: s.balancePaise - input.amountPaise };
  return commit(
    ctx,
    [
      ...ledgerStmts(ctx, "supplier", { id: entryId, partyId: supplierId, type: "PAYMENT", amountPaise: -input.amountPaise, method: input.method, note: input.note, txnDate }),
      paymentStmt(ctx, { direction: "OUT", partyType: "SUPPLIER", partyId: supplierId, method: input.method, amountPaise: input.amountPaise, referenceType: "supplier_txn", referenceId: entryId, txnDate }),
      auditStmt(ctx, {
        action: "SUPPLIER_PAYMENT",
        entityType: "supplier",
        entityId: supplierId,
        summary: `Paid ${formatMoney(input.amountPaise)} to ${s.name} (${input.method})`,
        before: { balancePaise: s.balancePaise },
        after: { balancePaise: result.balanceAfterPaise, entryId },
      }),
      eventStmt(ctx, "supplier_payment"),
    ],
    result,
    idem.ticket,
  );
}

export async function adjustSupplierBalance(ctx: ServiceContext, supplierId: string, input: z.output<typeof ledgerAdjustmentSchema>, idempotencyKey?: string | null) {
  requirePermission(ctx, "supplier.ledger");
  const idem = await checkIdempotency<SupplierLedgerResult>(ctx, idempotencyKey, { op: "supplierAdjust", supplierId, input });
  if ("replay" in idem) return idem.replay;
  const s = await getSupplierRow(ctx, supplierId);
  const entryId = newId(ctx.now);
  const result: SupplierLedgerResult = { entryId, supplierId, supplierName: s.name, amountPaise: input.amountPaise, balanceAfterPaise: s.balancePaise + input.amountPaise };
  return commit(
    ctx,
    [
      ...ledgerStmts(ctx, "supplier", { id: entryId, partyId: supplierId, type: "ADJUSTMENT", amountPaise: input.amountPaise, note: input.note, txnDate: resolveTxnDate(ctx, input.txnDate) }),
      auditStmt(ctx, {
        action: "SUPPLIER_ADJUSTMENT",
        entityType: "supplier",
        entityId: supplierId,
        summary: `Adjusted ${s.name}'s balance by ${formatMoney(input.amountPaise)} — ${input.note}`,
        before: { balancePaise: s.balancePaise },
        after: { balancePaise: result.balanceAfterPaise },
      }),
    ],
    result,
    idem.ticket,
  );
}

export async function reverseSupplierEntry(ctx: ServiceContext, supplierId: string, entryId: string, reason: string | undefined, idempotencyKey?: string | null) {
  requirePermission(ctx, "supplier.ledger");
  requirePermission(ctx, "sales.delete");
  const idem = await checkIdempotency<SupplierLedgerResult>(ctx, idempotencyKey, { op: "reverseSupplierEntry", supplierId, entryId });
  if ("replay" in idem) return idem.replay;
  const s = await getSupplierRow(ctx, supplierId);
  const entry = await ctx.db
    .select()
    .from(supplierTransactions)
    .where(and(eq(supplierTransactions.id, entryId), eq(supplierTransactions.businessId, ctx.businessId), eq(supplierTransactions.supplierId, supplierId)))
    .get();
  if (!entry) throw new AppError("NOT_FOUND", "Entry not found.");
  if (entry.status === "REVERSED") throw new AppError("ALREADY_REVERSED", "This entry has already been reversed.");
  if (!["PAYMENT", "ADJUSTMENT"].includes(entry.type)) throw new AppError("VALIDATION_ERROR", "Purchase entries are reversed by undoing the purchase.");
  const reversalId = newId(ctx.now);
  const result: SupplierLedgerResult = { entryId: reversalId, supplierId, supplierName: s.name, amountPaise: -entry.amountPaise, balanceAfterPaise: s.balancePaise - entry.amountPaise };
  const stmts: Stmt[] = [
    ctx.db.insert(reversals).values({ businessId: ctx.businessId, entityType: "supplier_txn", entityId: entryId, reason: reason ?? null, createdBy: ctx.userId, source: ctx.source, createdAt: ctx.now }),
    ctx.db.update(supplierTransactions).set({ status: "REVERSED" }).where(and(eq(supplierTransactions.id, entryId), eq(supplierTransactions.businessId, ctx.businessId))),
    ...ledgerStmts(ctx, "supplier", {
      id: reversalId,
      partyId: supplierId,
      type: "REVERSAL",
      amountPaise: -entry.amountPaise,
      referenceType: "supplier_txn",
      referenceId: entryId,
      note: reason ? `Reversal: ${reason}` : "Reversal",
      txnDate: resolveTxnDate(ctx),
    }),
    auditStmt(ctx, {
      action: "SUPPLIER_ENTRY_REVERSED",
      entityType: "supplier",
      entityId: supplierId,
      summary: `Reversed ${entry.type.toLowerCase()} of ${formatMoney(Math.abs(entry.amountPaise))} for ${s.name}`,
      before: { entry, balancePaise: s.balancePaise },
      after: { balancePaise: result.balanceAfterPaise, reason },
    }),
  ];
  if (entry.type === "PAYMENT") stmts.push(reversePaymentsStmt(ctx, "supplier_txn", entryId));
  return commit(ctx, stmts, result, idem.ticket);
}

export async function exportSuppliersCsv(ctx: ServiceContext) {
  const rows = await ctx.db.select().from(suppliers).where(eq(suppliers.businessId, ctx.businessId)).orderBy(asc(suppliers.name));
  return toCsv(
    ["name", "company", "phone", "gstin", "address", "state_code", "outstanding", "active", "notes"],
    rows.map((r) => [r.name, r.company, r.phone, r.gstin, r.address, r.stateCode, paiseToRupeeString(r.balancePaise), r.isActive ? "yes" : "no", r.notes]),
  );
}
