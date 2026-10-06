/**
 * Purchases: stock in, weighted-average cost update, supplier ledger, payments, audit.
 */
import { and, desc, eq, gte, inArray, like, lte, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { toCsv } from "@/lib/csv";
import { newId } from "@/lib/ids";
import { formatMoney, paiseToRupeeString, roundDiv } from "@/lib/money";
import { PricingError, isInterstate, priceDocument } from "@/lib/pricing";
import { formatQty, fromMilli } from "@/lib/qty";
import { escapeLike } from "@/lib/text";
import { businessSettings, gstSettings, payments, products, purchaseItems, purchases, reversals, suppliers, users } from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import type { createPurchaseSchema, listPurchasesSchema } from "@/schemas/sales";
import { requirePermission, type ServiceContext } from "./context";
import { auditStmt, checkIdempotency, commit, eventStmt, reserveNumber, withNumberRetry, type Stmt } from "./engine";
import { assertStockAvailable, movementStmts, refreshStockAlerts } from "./inventory";
import { ledgerStmts, paymentStmt, resolveTxnDate, reversePaymentsStmt } from "./ledger";

type CreateInput = z.output<typeof createPurchaseSchema>;
type ListInput = z.output<typeof listPurchasesSchema>;

export async function previewPurchase(ctx: ServiceContext, input: CreateInput) {
  requirePermission(ctx, "purchase.create");
  const txnDate = resolveTxnDate(ctx, input.txnDate);
  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const [rows, gst] = await Promise.all([
    ctx.db.select().from(products).where(and(eq(products.businessId, ctx.businessId), inArray(products.id, productIds))),
    ctx.db.select().from(gstSettings).where(eq(gstSettings.businessId, ctx.businessId)).get(),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of productIds) if (!byId.has(id)) throw new AppError("PRODUCT_NOT_FOUND", "One of the products was not found.");

  let supplier: typeof suppliers.$inferSelect | undefined;
  if (input.supplierId) {
    supplier = await ctx.db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.businessId, ctx.businessId)))
      .get();
    if (!supplier) throw new AppError("SUPPLIER_NOT_FOUND", "Supplier not found.");
  }
  const interstate = isInterstate(gst?.stateCode, supplier?.stateCode);
  let priced;
  try {
    priced = priceDocument({
      lines: input.items.map((it) => ({
        unitPricePaise: it.unitCostPaise,
        quantityMilli: it.quantityMilli,
        discountPaise: it.discountPaise,
        gstRateBp: it.gstRateBp ?? byId.get(it.productId)!.gstRateBp,
      })),
      billDiscountPaise: input.billDiscountPaise,
      pricesIncludeGst: input.pricesIncludeGst,
      interstate,
    });
  } catch (err) {
    if (err instanceof PricingError) throw new AppError("VALIDATION_ERROR", err.message);
    throw err;
  }
  const total = priced.totalPaise;
  const paid = input.payment.status === "PAID" ? total : input.payment.status === "UNPAID" ? 0 : (input.payment.paidPaise ?? 0);
  if (input.payment.status === "PARTIAL" && (paid <= 0 || paid >= total)) {
    throw new AppError("INVALID_AMOUNT", "For a partly paid bill, enter an amount between zero and the bill total.");
  }
  if (paid > total) throw new AppError("INVALID_AMOUNT", "Paid amount cannot be more than the bill total.");
  return { byId, priced, supplier, interstate, txnDate, total, paid, credit: total - paid };
}

export interface PurchaseResult {
  id: string;
  purchaseNumber: string;
  totalPaise: number;
  paidPaise: number;
  creditPaise: number;
  supplierName: string | null;
  lines: Array<{ productName: string; quantityMilli: number; unit: string }>;
}

export async function createPurchase(ctx: ServiceContext, input: CreateInput, idempotencyKey?: string | null): Promise<PurchaseResult> {
  requirePermission(ctx, "purchase.create");
  const idem = await checkIdempotency<PurchaseResult>(ctx, idempotencyKey, { op: "createPurchase", input });
  if ("replay" in idem) return idem.replay;

  return withNumberRetry(async () => {
    const p = await previewPurchase(ctx, input);
    const { number, stmt: counterStmt } = await reserveNumber(ctx, "purchase", "PUR");
    const purchaseId = newId(ctx.now);
    const status = p.credit === 0 ? "PAID" : p.paid === 0 ? "UNPAID" : "PARTIAL";
    const stmts: Stmt[] = [
      counterStmt,
      ctx.db.insert(purchases).values({
        id: purchaseId,
        businessId: ctx.businessId,
        purchaseNumber: number,
        supplierId: p.supplier?.id ?? null,
        billNumber: input.billNumber ?? null,
        txnDate: p.txnDate,
        status: "COMPLETED",
        paymentMethod: p.paid > 0 ? input.payment.method : "CREDIT",
        paymentStatus: status,
        subtotalPaise: p.priced.subtotalPaise,
        discountPaise: p.priced.discountPaise,
        taxablePaise: p.priced.taxablePaise,
        cgstPaise: p.priced.cgstPaise,
        sgstPaise: p.priced.sgstPaise,
        igstPaise: p.priced.igstPaise,
        taxPaise: p.priced.taxPaise,
        totalPaise: p.total,
        paidPaise: p.paid,
        creditPaise: p.credit,
        isInterstate: p.interstate,
        pricesIncludeGst: input.pricesIncludeGst,
        itemCount: input.items.length,
        notes: input.notes ?? null,
        source: ctx.source,
        createdBy: ctx.userId,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      }),
    ];
    input.items.forEach((it, i) => {
      const prod = p.byId.get(it.productId)!;
      const pl = p.priced.lines[i]!;
      // Net cost per base unit (before GST — input tax is recoverable), in paise.
      const unitNetCost = roundDiv(pl.taxablePaise * 1000, it.quantityMilli);
      stmts.push(
        ctx.db.insert(purchaseItems).values({
          id: newId(ctx.now),
          businessId: ctx.businessId,
          purchaseId,
          productId: prod.id,
          productName: prod.name,
          unit: prod.unit,
          quantityMilli: it.quantityMilli,
          unitCostPaise: it.unitCostPaise,
          discountPaise: pl.discountPaise,
          gstRateBp: it.gstRateBp ?? prod.gstRateBp,
          taxablePaise: pl.taxablePaise,
          cgstPaise: pl.cgstPaise,
          sgstPaise: pl.sgstPaise,
          igstPaise: pl.igstPaise,
          taxPaise: pl.taxPaise,
          totalPaise: pl.totalPaise,
          createdAt: ctx.now,
        }),
      );
      // Weighted average cost; all SET expressions see the OLD row values.
      const stock = sql`max(${products.currentStockMilli}, 0)`;
      const extraSet = {
        purchasePricePaise: unitNetCost,
        avgCostPaise: sql`case when ${stock} + ${it.quantityMilli} > 0 then cast(round((${stock} * ${products.avgCostPaise} + ${it.quantityMilli} * ${unitNetCost}) * 1.0 / (${stock} + ${it.quantityMilli})) as integer) else ${unitNetCost} end`,
        ...(p.supplier && !prod.supplierId ? { supplierId: p.supplier.id } : {}),
      };
      if (prod.trackStock) {
        stmts.push(
          ...movementStmts(ctx, {
            productId: prod.id,
            deltaMilli: it.quantityMilli,
            type: "PURCHASE",
            referenceType: "purchase",
            referenceId: purchaseId,
            txnDate: p.txnDate,
            extraSet,
          }),
        );
      } else {
        stmts.push(ctx.db.update(products).set({ ...extraSet, updatedAt: ctx.now }).where(and(eq(products.id, prod.id), eq(products.businessId, ctx.businessId))));
      }
    });
    if (p.credit > 0 && p.supplier) {
      stmts.push(
        ...ledgerStmts(ctx, "supplier", {
          partyId: p.supplier.id,
          type: "PURCHASE_CREDIT",
          amountPaise: p.credit,
          referenceType: "purchase",
          referenceId: purchaseId,
          note: `Purchase ${number}${input.billNumber ? ` (bill ${input.billNumber})` : ""}`,
          txnDate: p.txnDate,
        }),
      );
    } else if (p.supplier) {
      stmts.push(ctx.db.update(suppliers).set({ lastTxnAt: ctx.now }).where(and(eq(suppliers.id, p.supplier.id), eq(suppliers.businessId, ctx.businessId))));
    }
    if (p.paid > 0) {
      stmts.push(
        paymentStmt(ctx, {
          direction: "OUT",
          partyType: p.supplier ? "SUPPLIER" : null,
          partyId: p.supplier?.id ?? null,
          method: input.payment.method,
          amountPaise: p.paid,
          referenceType: "purchase",
          referenceId: purchaseId,
          txnDate: p.txnDate,
        }),
      );
    }
    const summary = input.items.map((it) => `${p.byId.get(it.productId)!.name} ×${formatQty(it.quantityMilli)}`).join(", ");
    stmts.push(
      auditStmt(ctx, {
        action: "PURCHASE_CREATED",
        entityType: "purchase",
        entityId: purchaseId,
        summary: `Purchase ${number}${p.supplier ? ` from ${p.supplier.name}` : ""}: ${summary} — ${formatMoney(p.total)}`,
        after: { purchaseNumber: number, supplier: p.supplier?.name ?? null, totalPaise: p.total, paidPaise: p.paid, items: input.items },
      }),
      eventStmt(ctx, "purchase_created", { items: input.items.length }),
    );
    const result: PurchaseResult = {
      id: purchaseId,
      purchaseNumber: number,
      totalPaise: p.total,
      paidPaise: p.paid,
      creditPaise: p.credit,
      supplierName: p.supplier?.name ?? null,
      lines: input.items.map((it) => ({ productName: p.byId.get(it.productId)!.name, quantityMilli: it.quantityMilli, unit: p.byId.get(it.productId)!.unit })),
    };
    const out = await commit(ctx, stmts, result, idem.ticket);
    await refreshStockAlerts(ctx, input.items.map((i) => i.productId));
    return out;
  });
}

export async function getPurchaseDetail(ctx: ServiceContext, id: string) {
  const purchase = await ctx.db
    .select()
    .from(purchases)
    .where(and(eq(purchases.id, id), eq(purchases.businessId, ctx.businessId)))
    .get();
  if (!purchase) throw notFound("Purchase");
  const [items, supplier, pays, createdBy] = await Promise.all([
    ctx.db.select().from(purchaseItems).where(and(eq(purchaseItems.purchaseId, id), eq(purchaseItems.businessId, ctx.businessId))),
    purchase.supplierId ? ctx.db.select({ id: suppliers.id, name: suppliers.name, balancePaise: suppliers.balancePaise }).from(suppliers).where(eq(suppliers.id, purchase.supplierId)).get() : Promise.resolve(undefined),
    ctx.db.select().from(payments).where(and(eq(payments.businessId, ctx.businessId), eq(payments.referenceType, "purchase"), eq(payments.referenceId, id))),
    purchase.createdBy ? ctx.db.select({ name: users.name }).from(users).where(eq(users.id, purchase.createdBy)).get() : Promise.resolve(undefined),
  ]);
  return { purchase, items, supplier: supplier ?? null, payments: pays, createdByName: createdBy?.name ?? null };
}

export async function listPurchases(ctx: ServiceContext, input: ListInput) {
  const offset = Number(input.cursor ?? 0) || 0;
  const conds: SQL[] = [eq(purchases.businessId, ctx.businessId)];
  if (input.from) conds.push(gte(purchases.txnDate, input.from));
  if (input.to) conds.push(lte(purchases.txnDate, input.to));
  if (input.status !== "all") conds.push(eq(purchases.status, input.status));
  if (input.supplierId) conds.push(eq(purchases.supplierId, input.supplierId));
  if (input.q) {
    const q = `%${escapeLike(input.q)}%`;
    conds.push(or(like(purchases.purchaseNumber, q), like(purchases.billNumber, q), like(suppliers.name, q))!);
  }
  const where = and(...conds);
  const rows = await ctx.db
    .select({
      id: purchases.id,
      purchaseNumber: purchases.purchaseNumber,
      billNumber: purchases.billNumber,
      txnDate: purchases.txnDate,
      createdAt: purchases.createdAt,
      status: purchases.status,
      paymentStatus: purchases.paymentStatus,
      totalPaise: purchases.totalPaise,
      creditPaise: purchases.creditPaise,
      itemCount: purchases.itemCount,
      supplierId: purchases.supplierId,
      supplierName: suppliers.name,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(where)
    .orderBy(desc(purchases.createdAt), desc(purchases.id))
    .limit(input.limit + 1)
    .offset(offset);
  const [totals] = await ctx.db
    .select({ count: sql<number>`sum(case when ${purchases.status} = 'COMPLETED' then 1 else 0 end)`, totalPaise: sql<number>`coalesce(sum(case when ${purchases.status} = 'COMPLETED' then ${purchases.totalPaise} else 0 end), 0)` })
    .from(purchases)
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(where);
  const hasMore = rows.length > input.limit;
  return { items: rows.slice(0, input.limit), nextCursor: hasMore ? String(offset + input.limit) : null, totals: { count: Number(totals?.count ?? 0), totalPaise: Number(totals?.totalPaise ?? 0) } };
}

/** Reverses a purchase: stock out again (must be available), supplier credit removed. */
export async function reversePurchase(ctx: ServiceContext, id: string, reason: string | undefined, idempotencyKey?: string | null) {
  requirePermission(ctx, "purchase.create");
  requirePermission(ctx, "sales.delete");
  const idem = await checkIdempotency<{ id: string; number: string; status: "REVERSED" }>(ctx, idempotencyKey, { op: "reversePurchase", id });
  if ("replay" in idem) return idem.replay;
  const purchase = await ctx.db
    .select()
    .from(purchases)
    .where(and(eq(purchases.id, id), eq(purchases.businessId, ctx.businessId)))
    .get();
  if (!purchase) throw notFound("Purchase");
  if (purchase.status === "REVERSED") throw new AppError("ALREADY_REVERSED", `Purchase ${purchase.purchaseNumber} was already reversed.`);
  const items = await ctx.db.select().from(purchaseItems).where(and(eq(purchaseItems.purchaseId, id), eq(purchaseItems.businessId, ctx.businessId)));
  const prods = await ctx.db.select().from(products).where(and(eq(products.businessId, ctx.businessId), inArray(products.id, items.map((i) => i.productId))));
  const byId = new Map(prods.map((p) => [p.id, p]));
  const settings = await ctx.db.select().from(businessSettings).where(eq(businessSettings.businessId, ctx.businessId)).get();
  const need = new Map<string, number>();
  for (const i of items) need.set(i.productId, (need.get(i.productId) ?? 0) + i.quantityMilli);
  for (const [pid, qty] of need) {
    const p = byId.get(pid);
    if (p?.trackStock) assertStockAvailable(p, qty, settings?.allowNegativeStock ?? false);
  }
  const txnDate = resolveTxnDate(ctx);
  const stmts: Stmt[] = [
    ctx.db.insert(reversals).values({ businessId: ctx.businessId, entityType: "purchase", entityId: id, reason: reason ?? null, createdBy: ctx.userId, source: ctx.source, createdAt: ctx.now }),
    ctx.db
      .update(purchases)
      .set({ status: "REVERSED", reversedAt: ctx.now, reversedBy: ctx.userId, reversalReason: reason ?? null, updatedAt: ctx.now })
      .where(and(eq(purchases.id, id), eq(purchases.businessId, ctx.businessId))),
    ...items
      .filter((i) => byId.get(i.productId)?.trackStock)
      .flatMap((i) =>
        movementStmts(ctx, { productId: i.productId, deltaMilli: -i.quantityMilli, type: "REVERSAL", referenceType: "purchase", referenceId: id, reason: `Undo ${purchase.purchaseNumber}`, txnDate }),
      ),
    reversePaymentsStmt(ctx, "purchase", id),
  ];
  if (purchase.creditPaise > 0 && purchase.supplierId) {
    stmts.push(
      ...ledgerStmts(ctx, "supplier", { partyId: purchase.supplierId, type: "REVERSAL", amountPaise: -purchase.creditPaise, referenceType: "purchase", referenceId: id, note: `Undo purchase ${purchase.purchaseNumber}`, txnDate }),
    );
  }
  stmts.push(
    auditStmt(ctx, {
      action: "PURCHASE_REVERSED",
      entityType: "purchase",
      entityId: id,
      summary: `Reversed purchase ${purchase.purchaseNumber} (${formatMoney(purchase.totalPaise)})${reason ? ` — ${reason}` : ""}`,
      before: { status: purchase.status },
      after: { status: "REVERSED", reason: reason ?? null },
    }),
  );
  const out = await commit(ctx, stmts, { id, number: purchase.purchaseNumber, status: "REVERSED" as const }, idem.ticket);
  await refreshStockAlerts(ctx, items.map((i) => i.productId));
  return out;
}

export async function exportPurchasesCsv(ctx: ServiceContext, from: string, to: string) {
  const rows = await ctx.db
    .select({
      number: purchases.purchaseNumber,
      bill: purchases.billNumber,
      txnDate: purchases.txnDate,
      status: purchases.status,
      supplier: suppliers.name,
      product: purchaseItems.productName,
      qty: purchaseItems.quantityMilli,
      unit: purchaseItems.unit,
      cost: purchaseItems.unitCostPaise,
      gst: purchaseItems.gstRateBp,
      taxable: purchaseItems.taxablePaise,
      tax: purchaseItems.taxPaise,
      total: purchaseItems.totalPaise,
    })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(and(eq(purchaseItems.businessId, ctx.businessId), gte(purchases.txnDate, from), lte(purchases.txnDate, to)))
    .orderBy(purchases.txnDate, purchases.purchaseNumber);
  const r = paiseToRupeeString;
  return toCsv(
    ["purchase", "supplier_bill", "date", "status", "supplier", "product", "quantity", "unit", "unit_cost", "gst_rate", "taxable", "tax", "line_total"],
    rows.map((x) => [x.number, x.bill, x.txnDate, x.status, x.supplier, x.product, fromMilli(x.qty), x.unit, r(x.cost), x.gst / 100, r(x.taxable), r(x.tax), r(x.total)]),
  );
}
