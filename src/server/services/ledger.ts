/**
 * Party ledgers (customer khata & supplier accounts) and the payments register.
 * Balances are cached on the party row but always move together with a ledger row, in the
 * same batch, and the ledger row stores the running balance computed inside the batch.
 */
import { and, eq, sql } from "drizzle-orm";
import { addDays, todayIst } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { customers, customerTransactions, payments, suppliers, supplierTransactions } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import type { ServiceContext } from "./context";
import type { Stmt } from "./engine";

export type PartyKind = "customer" | "supplier";

export interface LedgerEntry {
  partyId: string;
  type: string;
  /** Signed: + increases what the party owes (customer) / what we owe (supplier). */
  amountPaise: number;
  method?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  note?: string | null;
  txnDate: string;
  id?: string;
}

export function ledgerStmts(ctx: ServiceContext, kind: PartyKind, e: LedgerEntry): Stmt[] {
  const id = e.id ?? newId(ctx.now);
  if (kind === "customer") {
    const bal = sql`(SELECT balance_paise FROM customers WHERE id = ${e.partyId} AND business_id = ${ctx.businessId})`;
    return [
      ctx.db.insert(customerTransactions).values({
        id,
        businessId: ctx.businessId,
        customerId: e.partyId,
        type: e.type,
        amountPaise: e.amountPaise,
        balanceAfterPaise: sql`${bal} + ${e.amountPaise}`,
        method: e.method ?? null,
        referenceType: e.referenceType ?? null,
        referenceId: e.referenceId ?? null,
        note: e.note ?? null,
        txnDate: e.txnDate,
        source: ctx.source,
        createdBy: ctx.userId,
        createdAt: ctx.now,
      }),
      ctx.db
        .update(customers)
        .set({ balancePaise: sql`${customers.balancePaise} + ${e.amountPaise}`, lastTxnAt: ctx.now, updatedAt: ctx.now })
        .where(and(eq(customers.id, e.partyId), eq(customers.businessId, ctx.businessId))),
    ];
  }
  const bal = sql`(SELECT balance_paise FROM suppliers WHERE id = ${e.partyId} AND business_id = ${ctx.businessId})`;
  return [
    ctx.db.insert(supplierTransactions).values({
      id,
      businessId: ctx.businessId,
      supplierId: e.partyId,
      type: e.type,
      amountPaise: e.amountPaise,
      balanceAfterPaise: sql`${bal} + ${e.amountPaise}`,
      method: e.method ?? null,
      referenceType: e.referenceType ?? null,
      referenceId: e.referenceId ?? null,
      note: e.note ?? null,
      txnDate: e.txnDate,
      source: ctx.source,
      createdBy: ctx.userId,
      createdAt: ctx.now,
    }),
    ctx.db
      .update(suppliers)
      .set({ balancePaise: sql`${suppliers.balancePaise} + ${e.amountPaise}`, lastTxnAt: ctx.now, updatedAt: ctx.now })
      .where(and(eq(suppliers.id, e.partyId), eq(suppliers.businessId, ctx.businessId))),
  ];
}

export function paymentStmt(
  ctx: ServiceContext,
  p: {
    direction: "IN" | "OUT";
    partyType: "CUSTOMER" | "SUPPLIER" | null;
    partyId: string | null;
    method: string;
    amountPaise: number;
    referenceType: string;
    referenceId: string;
    txnDate: string;
  },
): Stmt {
  return ctx.db.insert(payments).values({ id: newId(ctx.now), businessId: ctx.businessId, ...p, status: "COMPLETED", createdBy: ctx.userId, createdAt: ctx.now });
}

/** Marks every payment of a document as reversed (payments are excluded from cash totals). */
export function reversePaymentsStmt(ctx: ServiceContext, referenceType: string, referenceId: string): Stmt {
  return ctx.db
    .update(payments)
    .set({ status: "REVERSED" })
    .where(and(eq(payments.businessId, ctx.businessId), eq(payments.referenceType, referenceType), eq(payments.referenceId, referenceId)));
}

/** Transaction dates: default today (IST); no future dates; at most one year back. */
export function resolveTxnDate(ctx: ServiceContext, date?: string | null): string {
  const today = todayIst(ctx.now);
  if (!date) return today;
  if (date > today) throw new AppError("VALIDATION_ERROR", "Date cannot be in the future.");
  if (date < addDays(today, -366)) throw new AppError("VALIDATION_ERROR", "Date is too far in the past.");
  return date;
}
