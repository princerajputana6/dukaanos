/**
 * Reorder suggestions (Release C). Grounded in real data and honest about its limits:
 *  - With enough sales history it uses average daily demand over a window to target a few days of
 *    cover (lead time + safety), subtracting stock already on the way from open purchase orders.
 *  - With too little history it falls back to the product's low-stock threshold and says so, rather
 *    than inventing a forecast.
 * It only ever *suggests*; placing an order is a separate, confirmed action (a PO draft).
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { addDays, todayIst } from "@/lib/dates";
import { products, productUnits, purchaseOrderLines, purchaseOrders, saleItems, sales, suppliers } from "@/server/db/schema";
import type { ServiceContext } from "./context";

const DEMAND_WINDOW_DAYS = 30;
const LEAD_TIME_DAYS = 3;
const SAFETY_DAYS = 4;
const TARGET_COVER_DAYS = LEAD_TIME_DAYS + SAFETY_DAYS;
/** Need at least this many days with a sale before trusting a demand average. */
const MIN_SALES_DAYS = 3;

export interface ReorderSuggestion {
  productId: string;
  name: string;
  unit: string;
  currentStockMilli: number;
  incomingMilli: number;
  avgDailyMilli: number;
  salesDays: number;
  method: "demand" | "threshold";
  daysOfCover: number | null;
  stockoutRisk: boolean;
  suggestedMilli: number;
  packMilli: number;
  supplierId: string | null;
  supplierName: string | null;
  purchasePricePaise: number;
}

function roundUpToPack(milli: number, packMilli: number): number {
  if (milli <= 0) return 0;
  const pack = packMilli > 0 ? packMilli : 1000;
  return Math.ceil(milli / pack) * pack;
}

export async function reorderSuggestions(ctx: ServiceContext): Promise<ReorderSuggestion[]> {
  const since = addDays(todayIst(ctx.now), -(DEMAND_WINDOW_DAYS - 1));
  const rows = await ctx.db
    .select({
      id: products.id,
      name: products.name,
      unit: products.unit,
      currentStockMilli: products.currentStockMilli,
      lowStockThresholdMilli: products.lowStockThresholdMilli,
      supplierId: products.supplierId,
      supplierName: suppliers.name,
      purchasePricePaise: products.purchasePricePaise,
    })
    .from(products)
    .leftJoin(suppliers, eq(suppliers.id, products.supplierId))
    .where(and(eq(products.businessId, ctx.businessId), eq(products.isActive, true), eq(products.trackStock, true)))
    .limit(5000);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  // Demand: total sold and number of distinct sale-days per product in the window.
  const demand = await ctx.db
    .select({ productId: saleItems.productId, qty: sql<number>`sum(${saleItems.quantityMilli})`, days: sql<number>`count(distinct ${sales.txnDate})` })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .where(and(eq(saleItems.businessId, ctx.businessId), eq(sales.status, "COMPLETED"), gte(sales.txnDate, since), inArray(saleItems.productId, ids)))
    .groupBy(saleItems.productId);
  const demandBy = new Map(demand.map((d) => [d.productId, { qty: Number(d.qty), days: Number(d.days) }]));

  // Incoming: still-to-receive quantity on open purchase orders.
  const incoming = await ctx.db
    .select({ productId: purchaseOrderLines.productId, qty: sql<number>`coalesce(sum(${purchaseOrderLines.orderedMilli} - ${purchaseOrderLines.receivedMilli}), 0)` })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId))
    .where(and(eq(purchaseOrderLines.businessId, ctx.businessId), inArray(purchaseOrders.status, ["APPROVED", "PARTIALLY_RECEIVED"]), inArray(purchaseOrderLines.productId, ids)))
    .groupBy(purchaseOrderLines.productId);
  const incomingBy = new Map(incoming.map((i) => [i.productId, Math.max(0, Number(i.qty))]));

  // Pack size: the largest configured purchase unit (e.g. a crate), else one base unit.
  const units = await ctx.db.select({ productId: productUnits.productId, factor: productUnits.factorMilli }).from(productUnits).where(eq(productUnits.businessId, ctx.businessId));
  const packBy = new Map<string, number>();
  for (const u of units) packBy.set(u.productId, Math.max(packBy.get(u.productId) ?? 0, u.factor));

  const out: ReorderSuggestion[] = [];
  for (const r of rows) {
    const d = demandBy.get(r.id);
    const incomingMilli = incomingBy.get(r.id) ?? 0;
    const packMilli = packBy.get(r.id) ?? 1000;
    const available = r.currentStockMilli + incomingMilli;
    const base = {
      productId: r.id,
      name: r.name,
      unit: r.unit,
      currentStockMilli: r.currentStockMilli,
      incomingMilli,
      packMilli,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      purchasePricePaise: r.purchasePricePaise,
    };

    if (d && d.days >= MIN_SALES_DAYS && d.qty > 0) {
      const avgDailyMilli = d.qty / DEMAND_WINDOW_DAYS;
      const daysOfCover = avgDailyMilli > 0 ? available / avgDailyMilli : null;
      const target = avgDailyMilli * TARGET_COVER_DAYS;
      const suggested = roundUpToPack(Math.max(0, target - available), packMilli);
      const stockoutRisk = daysOfCover != null && daysOfCover < LEAD_TIME_DAYS;
      if (suggested > 0 || stockoutRisk) {
        out.push({ ...base, avgDailyMilli: Math.round(avgDailyMilli), salesDays: d.days, method: "demand", daysOfCover: daysOfCover == null ? null : Math.round(daysOfCover * 10) / 10, stockoutRisk, suggestedMilli: suggested });
      }
    } else if (r.lowStockThresholdMilli > 0 && available <= r.lowStockThresholdMilli) {
      // Not enough history — honest threshold fallback.
      const suggested = roundUpToPack(Math.max(0, r.lowStockThresholdMilli * 2 - available), packMilli);
      if (suggested > 0) {
        out.push({ ...base, avgDailyMilli: 0, salesDays: d?.days ?? 0, method: "threshold", daysOfCover: null, stockoutRisk: r.currentStockMilli <= 0, suggestedMilli: suggested });
      }
    }
  }
  // Most urgent first: stockout risk, then least days of cover.
  return out.sort((a, b) => Number(b.stockoutRisk) - Number(a.stockoutRisk) || (a.daysOfCover ?? 1e9) - (b.daysOfCover ?? 1e9));
}

export type ReorderMeta = { windowDays: number; leadTimeDays: number; safetyDays: number };
export const REORDER_META: ReorderMeta = { windowDays: DEMAND_WINDOW_DAYS, leadTimeDays: LEAD_TIME_DAYS, safetyDays: SAFETY_DAYS };
