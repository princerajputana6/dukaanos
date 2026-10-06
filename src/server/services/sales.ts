/**
 * Sales transaction engine.
 *
 * createSale():
 *  1. permission  2. load & validate products  3. stock check  4–6. price (discount, GST)
 *  7. sale  8. items  9. movements  10. stock  11. customer ledger (credit)  12. payment
 *  13. audit — all in ONE atomic batch, then low-stock alerts post-commit.
 */
import { and, desc, eq, gte, inArray, like, lte, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { toCsv } from "@/lib/csv";
import { newId } from "@/lib/ids";
import { formatMoney, paiseToRupeeString } from "@/lib/money";
import { PricingError, priceDocument, isInterstate } from "@/lib/pricing";
import { formatQty, fromMilli } from "@/lib/qty";
import { escapeLike } from "@/lib/text";
import { businessSettings, customers, gstSettings, payments, products, reversals, saleItems, sales, users } from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import type { createSaleSchema, listSalesSchema } from "@/schemas/sales";
import { requirePermission, type ServiceContext } from "./context";
import { auditStmt, checkIdempotency, commit, eventStmt, reserveNumber, withNumberRetry, type Stmt } from "./engine";
import { assertStockAvailable, movementStmts, refreshStockAlerts } from "./inventory";
import { ledgerStmts, paymentStmt, resolveTxnDate, reversePaymentsStmt } from "./ledger";

type CreateInput = z.output<typeof createSaleSchema>;
type ListInput = z.output<typeof listSalesSchema>;

export interface SalePreviewLine {
  productId: string;
  productName: string;
  unit: string;
  quantityMilli: number;
  unitPricePaise: number;
  discountPaise: number;
  gstRateBp: number;
  taxablePaise: number;
  taxPaise: number;
  totalPaise: number;
  trackStock: boolean;
  stockBeforeMilli: number;
  stockAfterMilli: number;
}

export interface SalePreview {
  lines: SalePreviewLine[];
  customer: { id: string; name: string; balancePaise: number } | null;
  subtotalPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  totalPaise: number;
  paidPaise: number;
  creditPaise: number;
  costPaise: number;
  paymentMethod: string;
  paymentStatus: "PAID" | "PARTIAL" | "UNPAID";
  isInterstate: boolean;
  pricesIncludeGst: boolean;
  txnDate: string;
}

/**
 * Validates and prices a sale WITHOUT writing anything. Used by createSale and by the AI
 * confirmation card, so what the user confirms is exactly what gets recorded.
 */
export async function previewSale(ctx: ServiceContext, input: CreateInput) {
  requirePermission(ctx, "sales.create");
  const txnDate = resolveTxnDate(ctx, input.txnDate);
  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const [rows, settings, gst] = await Promise.all([
    ctx.db
      .select()
      .from(products)
      .where(and(eq(products.businessId, ctx.businessId), inArray(products.id, productIds))),
    ctx.db.select().from(businessSettings).where(eq(businessSettings.businessId, ctx.businessId)).get(),
    ctx.db.select().from(gstSettings).where(eq(gstSettings.businessId, ctx.businessId)).get(),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of productIds) {
    const p = byId.get(id);
    if (!p) throw new AppError("PRODUCT_NOT_FOUND", "One of the products was not found.");
    if (!p.isActive) throw new AppError("VALIDATION_ERROR", `${p.name} is archived. Restore it to sell.`);
  }

  // Stock check per product (aggregated across lines).
  const allowNegative = settings?.allowNegativeStock ?? false;
  const need = new Map<string, number>();
  for (const it of input.items) need.set(it.productId, (need.get(it.productId) ?? 0) + it.quantityMilli);
  for (const [pid, qty] of need) {
    const p = byId.get(pid)!;
    if (p.trackStock) assertStockAvailable(p, qty, allowNegative);
  }

  let customer: typeof customers.$inferSelect | undefined;
  if (input.customerId) {
    customer = await ctx.db
      .select()
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.businessId, ctx.businessId)))
      .get();
    if (!customer) throw new AppError("CUSTOMER_NOT_FOUND", "Customer not found.");
  }

  const pricesIncludeGst = settings?.pricesIncludeGst ?? true;
  const interstate = isInterstate(gst?.stateCode, customer?.stateCode);
  let priced;
  try {
    priced = priceDocument({
      lines: input.items.map((it) => {
        const p = byId.get(it.productId)!;
        return { unitPricePaise: it.unitPricePaise ?? p.sellingPricePaise, quantityMilli: it.quantityMilli, discountPaise: it.discountPaise, gstRateBp: p.gstRateBp };
      }),
      billDiscountPaise: input.billDiscountPaise,
      pricesIncludeGst,
      interstate,
    });
  } catch (err) {
    if (err instanceof PricingError) throw new AppError("VALIDATION_ERROR", err.message);
    throw err;
  }

  const running = new Map<string, number>();
  const lines: SalePreviewLine[] = input.items.map((it, i) => {
    const p = byId.get(it.productId)!;
    const pl = priced.lines[i]!;
    const before = running.get(p.id) ?? p.currentStockMilli;
    const after = p.trackStock ? before - it.quantityMilli : before;
    running.set(p.id, after);
    return {
      productId: p.id,
      productName: p.name,
      unit: p.unit,
      quantityMilli: it.quantityMilli,
      unitPricePaise: it.unitPricePaise ?? p.sellingPricePaise,
      discountPaise: pl.discountPaise,
      gstRateBp: p.gstRateBp,
      taxablePaise: pl.taxablePaise,
      taxPaise: pl.taxPaise,
      totalPaise: pl.totalPaise,
      trackStock: p.trackStock,
      stockBeforeMilli: before,
      stockAfterMilli: after,
    };
  });

  const total = priced.totalPaise;
  const method = input.payment.method;
  const paid = method === "CREDIT" ? 0 : (input.payment.paidPaise ?? total);
  if (paid > total) throw new AppError("INVALID_AMOUNT", `Amount received cannot be more than the bill total (${formatMoney(total)}).`);
  const credit = total - paid;
  if (credit > 0 && !customer) throw new AppError("CUSTOMER_REQUIRED", "Choose a customer to record the unpaid amount as udhaar.");
  const cost = input.items.reduce((sum, it) => {
    const p = byId.get(it.productId)!;
    return sum + Math.round(((p.avgCostPaise || p.purchasePricePaise) * it.quantityMilli) / 1000);
  }, 0);

  const preview: SalePreview = {
    lines,
    customer: customer ? { id: customer.id, name: customer.name, balancePaise: customer.balancePaise } : null,
    subtotalPaise: priced.subtotalPaise,
    discountPaise: priced.discountPaise,
    taxablePaise: priced.taxablePaise,
    cgstPaise: priced.cgstPaise,
    sgstPaise: priced.sgstPaise,
    igstPaise: priced.igstPaise,
    taxPaise: priced.taxPaise,
    totalPaise: total,
    paidPaise: paid,
    creditPaise: credit,
    costPaise: cost,
    paymentMethod: method,
    paymentStatus: credit === 0 ? "PAID" : paid === 0 ? "UNPAID" : "PARTIAL",
    isInterstate: interstate,
    pricesIncludeGst,
    txnDate,
  };
  return { preview, byId, priced, settings };
}

export interface SaleResult {
  id: string;
  invoiceNumber: string;
  totalPaise: number;
  paidPaise: number;
  creditPaise: number;
  itemCount: number;
  customerName: string | null;
  lines: Array<{ productName: string; quantityMilli: number; unit: string; stockAfterMilli: number; trackStock: boolean }>;
}

export async function createSale(ctx: ServiceContext, input: CreateInput, idempotencyKey?: string | null): Promise<SaleResult> {
  requirePermission(ctx, "sales.create");
  const idem = await checkIdempotency<SaleResult>(ctx, idempotencyKey, { op: "createSale", input });
  if ("replay" in idem) return idem.replay;

  return withNumberRetry(async () => {
    const { preview, byId, priced, settings } = await previewSale(ctx, input);
    const { number, stmt: counterStmt } = await reserveNumber(ctx, "sale", settings?.invoicePrefix ?? "INV");
    const saleId = newId(ctx.now);
    const stmts: Stmt[] = [
      counterStmt,
      ctx.db.insert(sales).values({
        id: saleId,
        businessId: ctx.businessId,
        invoiceNumber: number,
        customerId: preview.customer?.id ?? null,
        txnDate: preview.txnDate,
        status: "COMPLETED",
        paymentMethod: preview.paymentMethod,
        paymentStatus: preview.paymentStatus,
        subtotalPaise: preview.subtotalPaise,
        discountPaise: preview.discountPaise,
        taxablePaise: preview.taxablePaise,
        cgstPaise: preview.cgstPaise,
        sgstPaise: preview.sgstPaise,
        igstPaise: preview.igstPaise,
        taxPaise: preview.taxPaise,
        totalPaise: preview.totalPaise,
        paidPaise: preview.paidPaise,
        creditPaise: preview.creditPaise,
        costPaise: preview.costPaise,
        isInterstate: preview.isInterstate,
        pricesIncludeGst: preview.pricesIncludeGst,
        itemCount: preview.lines.length,
        notes: input.notes ?? null,
        source: ctx.source,
        createdBy: ctx.userId,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      }),
    ];

    preview.lines.forEach((line, i) => {
      const p = byId.get(line.productId)!;
      const pl = priced.lines[i]!;
      const unitCost = p.avgCostPaise || p.purchasePricePaise;
      stmts.push(
        ctx.db.insert(saleItems).values({
          id: newId(ctx.now),
          businessId: ctx.businessId,
          saleId,
          productId: p.id,
          productName: p.name,
          unit: p.unit,
          quantityMilli: line.quantityMilli,
          unitPricePaise: line.unitPricePaise,
          discountPaise: pl.discountPaise,
          gstRateBp: p.gstRateBp,
          hsnCode: p.hsnCode,
          taxablePaise: pl.taxablePaise,
          cgstPaise: pl.cgstPaise,
          sgstPaise: pl.sgstPaise,
          igstPaise: pl.igstPaise,
          taxPaise: pl.taxPaise,
          totalPaise: pl.totalPaise,
          unitCostPaise: unitCost,
          costPaise: Math.round((unitCost * line.quantityMilli) / 1000),
          createdAt: ctx.now,
        }),
      );
      if (p.trackStock) {
        stmts.push(
          ...movementStmts(ctx, { productId: p.id, deltaMilli: -line.quantityMilli, type: "SALE", referenceType: "sale", referenceId: saleId, txnDate: preview.txnDate }),
        );
      }
    });

    if (preview.creditPaise > 0 && preview.customer) {
      stmts.push(
        ...ledgerStmts(ctx, "customer", {
          partyId: preview.customer.id,
          type: "SALE_CREDIT",
          amountPaise: preview.creditPaise,
          referenceType: "sale",
          referenceId: saleId,
          note: `Bill ${number}`,
          txnDate: preview.txnDate,
        }),
      );
    } else if (preview.customer) {
      stmts.push(ctx.db.update(customers).set({ lastTxnAt: ctx.now }).where(and(eq(customers.id, preview.customer.id), eq(customers.businessId, ctx.businessId))));
    }
    if (preview.paidPaise > 0) {
      stmts.push(
        paymentStmt(ctx, {
          direction: "IN",
          partyType: preview.customer ? "CUSTOMER" : null,
          partyId: preview.customer?.id ?? null,
          method: preview.paymentMethod === "CREDIT" ? "CASH" : preview.paymentMethod,
          amountPaise: preview.paidPaise,
          referenceType: "sale",
          referenceId: saleId,
          txnDate: preview.txnDate,
        }),
      );
    }

    const itemsSummary = preview.lines.map((l) => `${l.productName} ×${formatQty(l.quantityMilli)}`).join(", ");
    stmts.push(
      auditStmt(ctx, {
        action: "SALE_CREATED",
        entityType: "sale",
        entityId: saleId,
        summary: `Sale ${number}: ${itemsSummary} — ${formatMoney(preview.totalPaise)}${preview.creditPaise ? ` (udhaar ${formatMoney(preview.creditPaise)})` : ""}`,
        after: {
          invoiceNumber: number,
          items: preview.lines.map((l) => ({ product: l.productName, qtyMilli: l.quantityMilli, pricePaise: l.unitPricePaise, totalPaise: l.totalPaise })),
          totalPaise: preview.totalPaise,
          paidPaise: preview.paidPaise,
          creditPaise: preview.creditPaise,
          method: preview.paymentMethod,
          customer: preview.customer?.name ?? null,
        },
      }),
      eventStmt(ctx, "sale_created", { items: preview.lines.length, totalPaise: preview.totalPaise }),
    );

    const result: SaleResult = {
      id: saleId,
      invoiceNumber: number,
      totalPaise: preview.totalPaise,
      paidPaise: preview.paidPaise,
      creditPaise: preview.creditPaise,
      itemCount: preview.lines.length,
      customerName: preview.customer?.name ?? null,
      lines: preview.lines.map((l) => ({ productName: l.productName, quantityMilli: l.quantityMilli, unit: l.unit, stockAfterMilli: l.stockAfterMilli, trackStock: l.trackStock })),
    };
    const out = await commit(ctx, stmts, result, idem.ticket);
    await refreshStockAlerts(ctx, preview.lines.filter((l) => l.trackStock).map((l) => l.productId));
    return out;
  });
}

export async function getSaleDetail(ctx: ServiceContext, id: string) {
  const sale = await ctx.db
    .select()
    .from(sales)
    .where(and(eq(sales.id, id), eq(sales.businessId, ctx.businessId)))
    .get();
  if (!sale) throw notFound("Sale");
  const [items, customer, pays, createdBy, reversedBy] = await Promise.all([
    ctx.db.select().from(saleItems).where(and(eq(saleItems.saleId, id), eq(saleItems.businessId, ctx.businessId))),
    sale.customerId
      ? ctx.db.select({ id: customers.id, name: customers.name, phone: customers.phone, balancePaise: customers.balancePaise }).from(customers).where(eq(customers.id, sale.customerId)).get()
      : Promise.resolve(undefined),
    ctx.db.select().from(payments).where(and(eq(payments.businessId, ctx.businessId), eq(payments.referenceType, "sale"), eq(payments.referenceId, id))),
    sale.createdBy ? ctx.db.select({ name: users.name }).from(users).where(eq(users.id, sale.createdBy)).get() : Promise.resolve(undefined),
    sale.reversedBy ? ctx.db.select({ name: users.name }).from(users).where(eq(users.id, sale.reversedBy)).get() : Promise.resolve(undefined),
  ]);
  const showCost = ctx.permissions.has("reports.view");
  return {
    sale: showCost ? sale : { ...sale, costPaise: null },
    items: items.map((i) => (showCost ? i : { ...i, unitCostPaise: null, costPaise: null })),
    customer: customer ?? null,
    payments: pays,
    createdByName: createdBy?.name ?? null,
    reversedByName: reversedBy?.name ?? null,
  };
}

export async function listSales(ctx: ServiceContext, input: ListInput) {
  const offset = Number(input.cursor ?? 0) || 0;
  const conds: SQL[] = [eq(sales.businessId, ctx.businessId)];
  if (input.from) conds.push(gte(sales.txnDate, input.from));
  if (input.to) conds.push(lte(sales.txnDate, input.to));
  if (input.status !== "all") conds.push(eq(sales.status, input.status));
  if (input.paymentMethod) conds.push(eq(sales.paymentMethod, input.paymentMethod));
  if (input.customerId) conds.push(eq(sales.customerId, input.customerId));
  if (input.q) {
    const q = `%${escapeLike(input.q)}%`;
    conds.push(or(like(sales.invoiceNumber, q), like(customers.name, q), sql`exists (select 1 from sale_items si where si.sale_id = ${sales.id} and si.product_name like ${q} escape '\\')`)!);
  }
  const where = and(...conds);
  const rows = await ctx.db
    .select({
      id: sales.id,
      invoiceNumber: sales.invoiceNumber,
      txnDate: sales.txnDate,
      createdAt: sales.createdAt,
      status: sales.status,
      paymentMethod: sales.paymentMethod,
      paymentStatus: sales.paymentStatus,
      totalPaise: sales.totalPaise,
      creditPaise: sales.creditPaise,
      itemCount: sales.itemCount,
      source: sales.source,
      customerId: sales.customerId,
      customerName: customers.name,
      itemsPreview: sql<string>`(select group_concat(product_name, ', ') from (select product_name from sale_items si where si.sale_id = ${sales.id} limit 3))`,
    })
    .from(sales)
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(where)
    .orderBy(desc(sales.createdAt), desc(sales.id))
    .limit(input.limit + 1)
    .offset(offset);
  const [totals] = await ctx.db
    .select({
      count: sql<number>`sum(case when ${sales.status} = 'COMPLETED' then 1 else 0 end)`,
      totalPaise: sql<number>`coalesce(sum(case when ${sales.status} = 'COMPLETED' then ${sales.totalPaise} else 0 end), 0)`,
      creditPaise: sql<number>`coalesce(sum(case when ${sales.status} = 'COMPLETED' then ${sales.creditPaise} else 0 end), 0)`,
    })
    .from(sales)
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(where);
  const hasMore = rows.length > input.limit;
  return {
    items: rows.slice(0, input.limit),
    nextCursor: hasMore ? String(offset + input.limit) : null,
    totals: { count: Number(totals?.count ?? 0), totalPaise: Number(totals?.totalPaise ?? 0), creditPaise: Number(totals?.creditPaise ?? 0) },
  };
}

export interface ReverseResult {
  id: string;
  number: string;
  status: "REVERSED";
  totalPaise: number;
}

/**
 * Undo: never deletes. Marks the sale REVERSED and writes compensating entries —
 * stock back in, udhaar removed from the khata, payments marked reversed.
 */
export async function reverseSale(ctx: ServiceContext, id: string, reason: string | undefined, idempotencyKey?: string | null): Promise<ReverseResult> {
  requirePermission(ctx, "sales.delete");
  const idem = await checkIdempotency<ReverseResult>(ctx, idempotencyKey, { op: "reverseSale", id });
  if ("replay" in idem) return idem.replay;
  const sale = await ctx.db
    .select()
    .from(sales)
    .where(and(eq(sales.id, id), eq(sales.businessId, ctx.businessId)))
    .get();
  if (!sale) throw notFound("Sale");
  if (sale.status === "REVERSED") throw new AppError("ALREADY_REVERSED", `Sale ${sale.invoiceNumber} was already reversed.`);
  const items = await ctx.db.select().from(saleItems).where(and(eq(saleItems.saleId, id), eq(saleItems.businessId, ctx.businessId)));
  const tracked = new Set(
    (
      await ctx.db
        .select({ id: products.id, trackStock: products.trackStock })
        .from(products)
        .where(and(eq(products.businessId, ctx.businessId), inArray(products.id, items.map((i) => i.productId))))
    )
      .filter((p) => p.trackStock)
      .map((p) => p.id),
  );
  const txnDate = resolveTxnDate(ctx);
  const stmts: Stmt[] = [
    ctx.db.insert(reversals).values({ businessId: ctx.businessId, entityType: "sale", entityId: id, reason: reason ?? null, createdBy: ctx.userId, source: ctx.source, createdAt: ctx.now }),
    ctx.db
      .update(sales)
      .set({ status: "REVERSED", reversedAt: ctx.now, reversedBy: ctx.userId, reversalReason: reason ?? null, updatedAt: ctx.now })
      .where(and(eq(sales.id, id), eq(sales.businessId, ctx.businessId))),
    ...items.filter((i) => tracked.has(i.productId)).flatMap((i) =>
      movementStmts(ctx, { productId: i.productId, deltaMilli: i.quantityMilli, type: "REVERSAL", referenceType: "sale", referenceId: id, reason: `Undo ${sale.invoiceNumber}`, txnDate }),
    ),
    reversePaymentsStmt(ctx, "sale", id),
  ];
  if (sale.creditPaise > 0 && sale.customerId) {
    stmts.push(
      ...ledgerStmts(ctx, "customer", {
        partyId: sale.customerId,
        type: "REVERSAL",
        amountPaise: -sale.creditPaise,
        referenceType: "sale",
        referenceId: id,
        note: `Undo bill ${sale.invoiceNumber}`,
        txnDate,
      }),
    );
  }
  stmts.push(
    auditStmt(ctx, {
      action: "SALE_REVERSED",
      entityType: "sale",
      entityId: id,
      summary: `Reversed sale ${sale.invoiceNumber} (${formatMoney(sale.totalPaise)})${reason ? ` — ${reason}` : ""}`,
      before: { status: sale.status },
      after: { status: "REVERSED", reason: reason ?? null, restocked: items.filter((i) => tracked.has(i.productId)).map((i) => ({ product: i.productName, qtyMilli: i.quantityMilli })) },
    }),
    eventStmt(ctx, "sale_reversed"),
  );
  const out = await commit(ctx, stmts, { id, number: sale.invoiceNumber, status: "REVERSED" as const, totalPaise: sale.totalPaise }, idem.ticket);
  await refreshStockAlerts(ctx, [...tracked]);
  return out;
}

/** The most recent reversible sale by this user within 24h — for "undo last sale". */
export async function findLastSale(ctx: ServiceContext) {
  return ctx.db
    .select({ id: sales.id, invoiceNumber: sales.invoiceNumber, totalPaise: sales.totalPaise, createdAt: sales.createdAt, itemCount: sales.itemCount })
    .from(sales)
    .where(and(eq(sales.businessId, ctx.businessId), eq(sales.createdBy, ctx.userId), eq(sales.status, "COMPLETED"), gte(sales.createdAt, ctx.now - 24 * 3600_000)))
    .orderBy(desc(sales.createdAt))
    .limit(1)
    .get();
}

export async function exportSalesCsv(ctx: ServiceContext, from: string, to: string) {
  const rows = await ctx.db
    .select({
      invoiceNumber: sales.invoiceNumber,
      txnDate: sales.txnDate,
      status: sales.status,
      customer: customers.name,
      productName: saleItems.productName,
      hsn: saleItems.hsnCode,
      quantityMilli: saleItems.quantityMilli,
      unit: saleItems.unit,
      unitPricePaise: saleItems.unitPricePaise,
      discountPaise: saleItems.discountPaise,
      gstRateBp: saleItems.gstRateBp,
      taxablePaise: saleItems.taxablePaise,
      cgstPaise: saleItems.cgstPaise,
      sgstPaise: saleItems.sgstPaise,
      igstPaise: saleItems.igstPaise,
      totalPaise: saleItems.totalPaise,
      paymentMethod: sales.paymentMethod,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(and(eq(saleItems.businessId, ctx.businessId), gte(sales.txnDate, from), lte(sales.txnDate, to)))
    .orderBy(sales.txnDate, sales.invoiceNumber);
  const r = paiseToRupeeString;
  return toCsv(
    ["invoice", "date", "status", "customer", "product", "hsn", "quantity", "unit", "rate", "discount", "gst_rate", "taxable", "cgst", "sgst", "igst", "line_total", "payment_method"],
    rows.map((x) => [x.invoiceNumber, x.txnDate, x.status, x.customer, x.productName, x.hsn, fromMilli(x.quantityMilli), x.unit, r(x.unitPricePaise), r(x.discountPaise), x.gstRateBp / 100, r(x.taxablePaise), r(x.cgstPaise), r(x.sgstPaise), r(x.igstPaise), r(x.totalPaise), x.paymentMethod]),
  );
}
