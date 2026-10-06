/**
 * Inventory: the stock movement ledger. Stock is NEVER changed without a movement row that
 * records before/after quantities, a reference and the user.
 */
import { and, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { formatQty } from "@/lib/qty";
import { newId } from "@/lib/ids";
import { addDays, todayIst } from "@/lib/dates";
import type { MovementType } from "@/lib/domain";
import { inventoryMovements, notifications, products, saleItems, sales, stockAlerts, users } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import type { z } from "zod";
import type { adjustStockSchema, listMovementsSchema } from "@/schemas/inventory";
import { requirePermission, type ServiceContext } from "./context";
import { auditStmt, checkIdempotency, commit, eventStmt, type Stmt } from "./engine";

export interface MovementSpec {
  productId: string;
  deltaMilli: number;
  type: MovementType;
  referenceType: string | null;
  referenceId: string | null;
  reason?: string | null;
  txnDate: string;
  /** Extra columns to update on the product in the same statement (e.g. avg cost). */
  extraSet?: Record<string, unknown>;
}

/**
 * Two statements per movement, executed in order inside the caller's batch:
 *  1. insert the movement with before/after computed from the CURRENT row (sub-select)
 *  2. apply the delta (the stock-guard trigger may abort the whole batch)
 */
export function movementStmts(ctx: ServiceContext, m: MovementSpec): Stmt[] {
  const current = sql`(SELECT current_stock_milli FROM products WHERE id = ${m.productId} AND business_id = ${ctx.businessId})`;
  return [
    ctx.db.insert(inventoryMovements).values({
      id: newId(ctx.now),
      businessId: ctx.businessId,
      productId: m.productId,
      type: m.type,
      quantityMilli: m.deltaMilli,
      beforeMilli: current,
      afterMilli: sql`${current} + ${m.deltaMilli}`,
      referenceType: m.referenceType,
      referenceId: m.referenceId,
      reason: m.reason ?? null,
      txnDate: m.txnDate,
      createdBy: ctx.userId,
      createdAt: ctx.now,
    }),
    ctx.db
      .update(products)
      .set({
        currentStockMilli: sql`${products.currentStockMilli} + ${m.deltaMilli}`,
        updatedAt: ctx.now,
        ...(m.extraSet ?? {}),
      })
      .where(and(eq(products.id, m.productId), eq(products.businessId, ctx.businessId))),
  ];
}

/** Friendly pre-check (the DB trigger is the real guard against races). */
export function assertStockAvailable(
  product: { id: string; name: string; unit: string; currentStockMilli: number },
  requiredMilli: number,
  allowNegative: boolean,
): void {
  if (allowNegative) return;
  if (product.currentStockMilli < requiredMilli) {
    const available = Math.max(0, product.currentStockMilli);
    throw new AppError(
      "INSUFFICIENT_STOCK",
      available === 0
        ? `${product.name} is out of stock.`
        : `Only ${formatQty(available)} ${product.unit} of ${product.name} available.`,
      { productId: product.id, availableMilli: available, requiredMilli },
    );
  }
}

type AdjustInput = z.output<typeof adjustStockSchema>;

export async function adjustStock(ctx: ServiceContext, input: AdjustInput, idempotencyKey?: string | null) {
  requirePermission(ctx, "inventory.adjust");
  const idem = await checkIdempotency<AdjustResult>(ctx, idempotencyKey, { op: "adjustStock", input });
  if ("replay" in idem) return idem.replay;

  const product = await ctx.db
    .select()
    .from(products)
    .where(and(eq(products.id, input.productId), eq(products.businessId, ctx.businessId)))
    .get();
  if (!product) throw new AppError("PRODUCT_NOT_FOUND", "Product not found.");

  let delta: number;
  if (input.mode === "set") delta = input.quantityMilli - product.currentStockMilli;
  else if (input.type === "DAMAGE") delta = -Math.abs(input.quantityMilli);
  else if (input.type === "RETURN") delta = Math.abs(input.quantityMilli);
  else delta = input.direction === "decrease" ? -Math.abs(input.quantityMilli) : Math.abs(input.quantityMilli);
  if (delta === 0) throw new AppError("VALIDATION_ERROR", "Stock is already at that quantity.");

  const settings = await ctx.db.query.businessSettings.findFirst({ where: (s, { eq: e }) => e(s.businessId, ctx.businessId) });
  if (delta < 0) assertStockAvailable(product, -delta, settings?.allowNegativeStock ?? false);

  const movementId = newId(ctx.now);
  const after = product.currentStockMilli + delta;
  const result: AdjustResult = {
    adjustmentId: movementId,
    productId: product.id,
    productName: product.name,
    deltaMilli: delta,
    beforeMilli: product.currentStockMilli,
    afterMilli: after,
  };
  const reason = input.reason ?? null;
  const out = await commit(
    ctx,
    [
      ...movementStmts(ctx, {
        productId: product.id,
        deltaMilli: delta,
        type: input.type,
        referenceType: "adjustment",
        referenceId: movementId,
        reason,
        txnDate: todayIst(ctx.now),
      }),
      auditStmt(ctx, {
        action: "STOCK_ADJUSTED",
        entityType: "product",
        entityId: product.id,
        summary: `${input.type === "DAMAGE" ? "Damaged" : input.type === "RETURN" ? "Returned" : "Adjusted"} ${product.name}: ${delta > 0 ? "+" : ""}${formatQty(delta)} ${product.unit}${reason ? ` (${reason})` : ""}`,
        before: { stockMilli: product.currentStockMilli },
        after: { stockMilli: after, type: input.type, reason },
      }),
      eventStmt(ctx, "stock_adjusted", { type: input.type }),
    ],
    result,
    idem.ticket,
  );
  await refreshStockAlerts(ctx, [product.id]);
  return out;
}
export interface AdjustResult {
  adjustmentId: string;
  productId: string;
  productName: string;
  deltaMilli: number;
  beforeMilli: number;
  afterMilli: number;
}

/**
 * Opens/resolves low-stock alerts for the given products and raises a notification the first
 * time a product crosses its threshold. Runs after the main commit (non-critical).
 */
export async function refreshStockAlerts(ctx: ServiceContext, productIds: string[]): Promise<void> {
  if (productIds.length === 0) return;
  try {
    const rows = await ctx.db
      .select({
        id: products.id,
        name: products.name,
        unit: products.unit,
        stock: products.currentStockMilli,
        threshold: products.lowStockThresholdMilli,
        isActive: products.isActive,
      })
      .from(products)
      .where(and(eq(products.businessId, ctx.businessId), inArray(products.id, [...new Set(productIds)])));
    const open = await ctx.db
      .select({ id: stockAlerts.id, productId: stockAlerts.productId })
      .from(stockAlerts)
      .where(and(eq(stockAlerts.businessId, ctx.businessId), eq(stockAlerts.status, "OPEN"), inArray(stockAlerts.productId, rows.map((r) => r.id))));
    const openBy = new Map(open.map((o) => [o.productId, o.id]));
    const settings = await ctx.db.query.businessSettings.findFirst({ where: (s, { eq: e }) => e(s.businessId, ctx.businessId) });

    const stmts: Stmt[] = [];
    for (const p of rows) {
      const low = p.isActive && (p.stock <= 0 || (p.threshold > 0 && p.stock <= p.threshold));
      const openId = openBy.get(p.id);
      if (low && !openId) {
        const alertId = newId(ctx.now);
        stmts.push(
          ctx.db
            .insert(stockAlerts)
            .values({ id: alertId, businessId: ctx.businessId, productId: p.id, status: "OPEN", stockMilli: p.stock, thresholdMilli: p.threshold, createdAt: ctx.now })
            .onConflictDoNothing(),
        );
        if (settings?.lowStockNotifications !== false) {
          stmts.push(
            ctx.db
              .insert(notifications)
              .values({
                id: newId(ctx.now),
                businessId: ctx.businessId,
                type: "LOW_STOCK",
                title: p.stock <= 0 ? `${p.name} is out of stock` : `${p.name} is running low`,
                body: `${formatQty(Math.max(0, p.stock))} ${p.unit} left (alert at ${formatQty(p.threshold)}).`,
                link: `/inventory/${p.id}`,
                dedupeKey: `low_stock:${alertId}`,
                createdAt: ctx.now,
              })
              .onConflictDoNothing(),
          );
        }
      } else if (!low && openId) {
        stmts.push(ctx.db.update(stockAlerts).set({ status: "RESOLVED", resolvedAt: ctx.now }).where(eq(stockAlerts.id, openId)));
      }
    }
    if (stmts.length) await ctx.db.batch(stmts as [Stmt, ...Stmt[]]);
  } catch (err) {
    ctx.logger.warn("stock alert refresh failed", { error: String(err) });
  }
}

export async function inventorySummary(ctx: ServiceContext) {
  const today = todayIst(ctx.now);
  const [totals] = await ctx.db
    .select({
      totalProducts: sql<number>`count(*)`,
      outOfStock: sql<number>`sum(case when ${products.currentStockMilli} <= 0 then 1 else 0 end)`,
      lowStock: sql<number>`sum(case when ${products.currentStockMilli} > 0 and ${products.currentStockMilli} <= ${products.lowStockThresholdMilli} then 1 else 0 end)`,
      costValuePaise: sql<number>`coalesce(sum(case when ${products.currentStockMilli} > 0 then (${products.currentStockMilli} * ${products.avgCostPaise} + 500) / 1000 else 0 end), 0)`,
      retailValuePaise: sql<number>`coalesce(sum(case when ${products.currentStockMilli} > 0 then (${products.currentStockMilli} * ${products.sellingPricePaise} + 500) / 1000 else 0 end), 0)`,
    })
    .from(products)
    .where(and(eq(products.businessId, ctx.businessId), eq(products.isActive, true)));
  const [moves] = await ctx.db
    .select({
      count: sql<number>`count(*)`,
      inMilli: sql<number>`coalesce(sum(case when ${inventoryMovements.quantityMilli} > 0 then ${inventoryMovements.quantityMilli} else 0 end), 0)`,
      outMilli: sql<number>`coalesce(sum(case when ${inventoryMovements.quantityMilli} < 0 then -${inventoryMovements.quantityMilli} else 0 end), 0)`,
    })
    .from(inventoryMovements)
    .where(and(eq(inventoryMovements.businessId, ctx.businessId), eq(inventoryMovements.txnDate, today)));
  return {
    totalProducts: Number(totals?.totalProducts ?? 0),
    lowStock: Number(totals?.lowStock ?? 0),
    outOfStock: Number(totals?.outOfStock ?? 0),
    costValuePaise: Number(totals?.costValuePaise ?? 0),
    retailValuePaise: Number(totals?.retailValuePaise ?? 0),
    todayMovements: { count: Number(moves?.count ?? 0), inMilli: Number(moves?.inMilli ?? 0), outMilli: Number(moves?.outMilli ?? 0) },
  };
}

/** Products at/below threshold with a reorder suggestion based on the last 14 days of sales. */
export async function lowStockProducts(ctx: ServiceContext, limit = 100) {
  const rows = await ctx.db
    .select({
      id: products.id,
      name: products.name,
      unit: products.unit,
      currentStockMilli: products.currentStockMilli,
      lowStockThresholdMilli: products.lowStockThresholdMilli,
      supplierId: products.supplierId,
      purchasePricePaise: products.purchasePricePaise,
    })
    .from(products)
    .where(
      and(
        eq(products.businessId, ctx.businessId),
        eq(products.isActive, true),
        sql`(${products.currentStockMilli} <= 0 OR ${products.currentStockMilli} <= ${products.lowStockThresholdMilli})`,
      ),
    )
    .orderBy(sql`${products.currentStockMilli} - ${products.lowStockThresholdMilli}`)
    .limit(limit);
  if (rows.length === 0) return [];
  const since = addDays(todayIst(ctx.now), -13);
  const velocity = await ctx.db
    .select({ productId: saleItems.productId, qty: sql<number>`sum(${saleItems.quantityMilli})` })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .where(
      and(
        eq(saleItems.businessId, ctx.businessId),
        eq(sales.status, "COMPLETED"),
        gte(sales.txnDate, since),
        inArray(saleItems.productId, rows.map((r) => r.id)),
      ),
    )
    .groupBy(saleItems.productId);
  const soldBy = new Map(velocity.map((v) => [v.productId, Number(v.qty)]));
  return rows.map((r) => {
    const sold14 = soldBy.get(r.id) ?? 0;
    const target = Math.max(r.lowStockThresholdMilli * 2, Math.ceil(sold14 / 2)); // ≈ one week of sales
    const suggestion = Math.max(1000, Math.ceil(Math.max(0, target - r.currentStockMilli) / 1000) * 1000);
    return { ...r, soldLast14DaysMilli: sold14, suggestedReorderMilli: suggestion };
  });
}

type ListMovementsInput = z.output<typeof listMovementsSchema>;

export async function listMovements(ctx: ServiceContext, input: ListMovementsInput) {
  const offset = Number(input.cursor ?? 0) || 0;
  const conds = [eq(inventoryMovements.businessId, ctx.businessId)];
  if (input.productId) conds.push(eq(inventoryMovements.productId, input.productId));
  if (input.type) conds.push(eq(inventoryMovements.type, input.type));
  if (input.from) conds.push(gte(inventoryMovements.txnDate, input.from));
  if (input.to) conds.push(lte(inventoryMovements.txnDate, input.to));
  if (input.before) conds.push(lt(inventoryMovements.createdAt, input.before));
  const rows = await ctx.db
    .select({
      id: inventoryMovements.id,
      productId: inventoryMovements.productId,
      productName: products.name,
      unit: products.unit,
      type: inventoryMovements.type,
      quantityMilli: inventoryMovements.quantityMilli,
      beforeMilli: inventoryMovements.beforeMilli,
      afterMilli: inventoryMovements.afterMilli,
      referenceType: inventoryMovements.referenceType,
      referenceId: inventoryMovements.referenceId,
      reason: inventoryMovements.reason,
      txnDate: inventoryMovements.txnDate,
      createdAt: inventoryMovements.createdAt,
      createdByName: users.name,
    })
    .from(inventoryMovements)
    .innerJoin(products, eq(products.id, inventoryMovements.productId))
    .leftJoin(users, eq(users.id, inventoryMovements.createdBy))
    .where(and(...conds))
    .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
    .limit(input.limit + 1)
    .offset(offset);
  const hasMore = rows.length > input.limit;
  return { items: rows.slice(0, input.limit), nextCursor: hasMore ? String(offset + input.limit) : null };
}
