/**
 * Business insights (Release C): rule- and statistics-based cards grounded in real data. Every
 * card is a *measured* observation with its evidence — nothing is invented. Read-only: insights
 * never change stock, prices, credit or orders; the UI only links to where the user can act.
 */
import { and, desc, eq, gt, gte, isNotNull, lt, sql } from "drizzle-orm";
import { addDays, todayIst } from "@/lib/dates";
import { customers, posShifts, products, purchaseItems, reversals, saleItems, sales } from "@/server/db/schema";
import type { ServiceContext } from "./context";

export interface Insight {
  id: string;
  kind: string;
  severity: "alert" | "warning" | "info";
  title: string;
  detail: string;
  evidence: string;
  href: string | null;
  actionLabel: string | null;
}

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

export async function businessInsights(ctx: ServiceContext): Promise<Insight[]> {
  const today = todayIst(ctx.now);
  const d30 = addDays(today, -29);
  const ms7 = ctx.now - 7 * 86_400_000;
  const out: Insight[] = [];

  // 30-day units sold per product (one scan, reused below).
  const soldRows = await ctx.db
    .select({ productId: saleItems.productId, qty: sql<number>`sum(${saleItems.quantityMilli})` })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .where(and(eq(saleItems.businessId, ctx.businessId), eq(sales.status, "COMPLETED"), gte(sales.txnDate, d30)))
    .groupBy(saleItems.productId);
  const sold = new Map(soldRows.map((r) => [r.productId, Number(r.qty)]));

  const prods = await ctx.db
    .select({ id: products.id, name: products.name, unit: products.unit, sell: products.sellingPricePaise, cost: products.purchasePricePaise, stock: products.currentStockMilli, track: products.trackStock })
    .from(products)
    .where(and(eq(products.businessId, ctx.businessId), eq(products.isActive, true)))
    .limit(5000);

  // 1. Selling at or below cost, and actually selling → losing money or mispriced.
  const loss = prods.filter((p) => (sold.get(p.id) ?? 0) > 0 && p.sell <= p.cost).sort((a, b) => (sold.get(b.id) ?? 0) - (sold.get(a.id) ?? 0)).slice(0, 5);
  for (const p of loss) {
    out.push({
      id: `margin:${p.id}`,
      kind: "negative_margin",
      severity: "warning",
      title: `${p.name} is priced at or below cost`,
      detail: "You may be losing money on every sale. Review the selling price or the recorded cost.",
      evidence: `Selling ${rupees(p.sell)} vs cost ${rupees(p.cost)} · ${Math.round((sold.get(p.id) ?? 0) / 1000)} ${p.unit} sold in 30 days`,
      href: `/inventory/${p.id}`,
      actionLabel: "Review product",
    });
  }

  // 2. Best-sellers now out of stock → lost sales.
  const oos = prods.filter((p) => p.track && p.stock <= 0 && (sold.get(p.id) ?? 0) > 0).sort((a, b) => (sold.get(b.id) ?? 0) - (sold.get(a.id) ?? 0)).slice(0, 5);
  for (const p of oos) {
    out.push({
      id: `oos:${p.id}`,
      kind: "out_of_stock_seller",
      severity: "alert",
      title: `${p.name} is out of stock`,
      detail: "A product that sells well is unavailable — you're likely losing sales until it's restocked.",
      evidence: `${Math.round((sold.get(p.id) ?? 0) / 1000)} ${p.unit} sold in the last 30 days · now 0 in stock`,
      href: `/inventory?tab=reorder`,
      actionLabel: "Reorder",
    });
  }

  // 3. Slow/dead stock: on hand but nothing sold in 30 days, meaningful value tied up.
  const dead = prods.filter((p) => p.track && p.stock > 0 && (sold.get(p.id) ?? 0) === 0).map((p) => ({ p, value: Math.round((p.cost * p.stock) / 1000) })).filter((x) => x.value >= 50_000);
  const deadValue = dead.reduce((a, x) => a + x.value, 0);
  if (dead.length >= 1) {
    out.push({
      id: "dead_stock",
      kind: "dead_stock",
      severity: "info",
      title: `${dead.length} product${dead.length === 1 ? "" : "s"} not selling`,
      detail: "Stock that hasn't moved in 30 days ties up cash. Consider a discount, a bundle, or stopping reorders.",
      evidence: `${rupees(deadValue)} of stock with no sales in 30 days`,
      href: `/inventory?stock=in`,
      actionLabel: "View inventory",
    });
  }

  // 4. Heavy discounts in the last 7 days (bill discount ≥ 15% of subtotal).
  const disc = await ctx.db
    .select({ n: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${sales.discountPaise}), 0)` })
    .from(sales)
    .where(and(eq(sales.businessId, ctx.businessId), eq(sales.status, "COMPLETED"), gte(sales.createdAt, ms7), gt(sales.subtotalPaise, 0), gte(sql`${sales.discountPaise} * 100`, sql`${sales.subtotalPaise} * 15`)))
    .get();
  if (Number(disc?.n ?? 0) >= 3) {
    out.push({
      id: "large_discounts",
      kind: "large_discounts",
      severity: "warning",
      title: `${Number(disc!.n)} heavily discounted bills this week`,
      detail: "Several bills had a 15%+ discount. Check whether discounts are intended and authorised.",
      evidence: `${rupees(Number(disc!.total))} given as discounts on ${Number(disc!.n)} bills in 7 days`,
      href: `/sales`,
      actionLabel: "View sales",
    });
  }

  // 5. Return/reversal spike in the last 7 days.
  const rev = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(reversals)
    .where(and(eq(reversals.businessId, ctx.businessId), eq(reversals.entityType, "sale"), gte(reversals.createdAt, ms7)))
    .get();
  if (Number(rev?.n ?? 0) >= 3) {
    out.push({
      id: "return_spike",
      kind: "return_spike",
      severity: "warning",
      title: `${Number(rev!.n)} sales reversed this week`,
      detail: "A higher-than-usual number of bills were undone. Check for billing mistakes or disputes.",
      evidence: `${Number(rev!.n)} sale reversals in the last 7 days`,
      href: `/audit`,
      actionLabel: "View audit log",
    });
  }

  // 6. Cash mismatches at shift close in the last 7 days.
  const mism = await ctx.db
    .select({ n: sql<number>`count(*)`, total: sql<number>`coalesce(sum(abs(${posShifts.differencePaise})), 0)` })
    .from(posShifts)
    .where(and(eq(posShifts.businessId, ctx.businessId), eq(posShifts.status, "CLOSED"), gte(posShifts.closedAt, ms7), isNotNull(posShifts.differencePaise), gte(sql`abs(${posShifts.differencePaise})`, 10_000)))
    .get();
  if (Number(mism?.n ?? 0) >= 1) {
    out.push({
      id: "cash_mismatch",
      kind: "cash_mismatch",
      severity: "warning",
      title: `Cash didn't match on ${Number(mism!.n)} shift${Number(mism!.n) === 1 ? "" : "s"}`,
      detail: "The counted cash differed from expected at close. Review the shifts and the notes recorded.",
      evidence: `${rupees(Number(mism!.total))} total difference across ${Number(mism!.n)} shift(s) in 7 days`,
      href: `/cashbook`,
      actionLabel: "Open cashbook",
    });
  }

  // 7. Ageing receivables: balance owed, no activity in 30+ days.
  const overdue = await ctx.db
    .select({ n: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${customers.balancePaise}), 0)` })
    .from(customers)
    .where(and(eq(customers.businessId, ctx.businessId), eq(customers.isActive, true), gt(customers.balancePaise, 0), lt(customers.lastTxnAt, ctx.now - 30 * 86_400_000)))
    .get();
  if (Number(overdue?.n ?? 0) >= 1) {
    out.push({
      id: "overdue_receivables",
      kind: "overdue_receivables",
      severity: "warning",
      title: `${rupees(Number(overdue!.total))} overdue from ${Number(overdue!.n)} customer${Number(overdue!.n) === 1 ? "" : "s"}`,
      detail: "These customers owe money and haven't transacted in over a month. A reminder may help you collect.",
      evidence: `${Number(overdue!.n)} customers with udhaar older than 30 days`,
      href: `/customers?filter=due`,
      actionLabel: "View khata",
    });
  }

  // 8. Supplier price jump: a product's latest purchase cost rose ≥15% vs the one before.
  const prodName = new Map(prods.map((p) => [p.id, p.name]));
  const piRows = await ctx.db
    .select({ productId: purchaseItems.productId, cost: purchaseItems.unitCostPaise, createdAt: purchaseItems.createdAt })
    .from(purchaseItems)
    .where(and(eq(purchaseItems.businessId, ctx.businessId), gte(purchaseItems.createdAt, ctx.now - 120 * 86_400_000)))
    .orderBy(purchaseItems.productId, desc(purchaseItems.createdAt))
    .limit(4000);
  const lastTwo = new Map<string, number[]>();
  for (const r of piRows) {
    const arr = lastTwo.get(r.productId) ?? [];
    if (arr.length < 2) arr.push(r.cost);
    lastTwo.set(r.productId, arr);
  }
  const jumps = [...lastTwo.entries()]
    .filter(([, c]) => c.length === 2 && c[1]! > 0 && c[0]! >= c[1]! * 1.15)
    .map(([id, c]) => ({ id, latest: c[0]!, prev: c[1]!, pct: Math.round(((c[0]! - c[1]!) / c[1]!) * 100) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5);
  for (const j of jumps) {
    out.push({
      id: `price_jump:${j.id}`,
      kind: "supplier_price_jump",
      severity: "info",
      title: `${prodName.get(j.id) ?? "A product"} costs ${j.pct}% more`,
      detail: "Your latest purchase cost rose sharply. Check if your selling price still leaves the margin you want.",
      evidence: `Purchase cost ${rupees(j.prev)} → ${rupees(j.latest)} (+${j.pct}%)`,
      href: `/inventory/${j.id}`,
      actionLabel: "Review pricing",
    });
  }

  // 9. Inactive regulars: customers who bought 3+ times but haven't returned in 30+ days.
  const freq = await ctx.db
    .select({ customerId: sales.customerId, n: sql<number>`count(*)` })
    .from(sales)
    .where(and(eq(sales.businessId, ctx.businessId), eq(sales.status, "COMPLETED"), isNotNull(sales.customerId)))
    .groupBy(sales.customerId);
  const regulars = new Set(freq.filter((f) => Number(f.n) >= 3 && f.customerId).map((f) => f.customerId!));
  if (regulars.size > 0) {
    const inactive = await ctx.db
      .select({ id: customers.id, name: customers.name, lastTxnAt: customers.lastTxnAt })
      .from(customers)
      .where(and(eq(customers.businessId, ctx.businessId), eq(customers.isActive, true), isNotNull(customers.lastTxnAt), lt(customers.lastTxnAt, ctx.now - 30 * 86_400_000)))
      .limit(500);
    const lapsed = inactive.filter((c) => regulars.has(c.id));
    if (lapsed.length > 0) {
      out.push({
        id: "inactive_regulars",
        kind: "inactive_regulars",
        severity: "info",
        title: `${lapsed.length} regular customer${lapsed.length === 1 ? "" : "s"} haven't returned`,
        detail: "Customers who used to buy often have gone quiet. A friendly WhatsApp or a small offer may bring them back.",
        evidence: `${lapsed.length} customers with 3+ past visits, silent for 30+ days`,
        href: `/customers`,
        actionLabel: "View customers",
      });
    }
  }

  const rank = { alert: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
