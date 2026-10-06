/**
 * Report engine. Everything is aggregated from transaction tables at query time —
 * no duplicated running totals. Money in paise, quantities in milli-units.
 */
import { and, asc, desc, eq, gt, gte, lte, sql } from "drizzle-orm";
import { toCsv } from "@/lib/csv";
import { addDays, eachDay, startOfMonth, startOfWeek, todayIst, type IsoDate } from "@/lib/dates";
import { formatMoney, paiseToRupeeString } from "@/lib/money";
import { fromMilli } from "@/lib/qty";
import {
  customers,
  expenseCategories,
  expenses,
  payments,
  productCategories,
  products,
  purchaseItems,
  purchases,
  saleItems,
  sales,
  suppliers,
} from "@/server/db/schema";
import { requirePermission, type ServiceContext } from "./context";
import { lowStockProducts } from "./inventory";

export interface Range {
  from: IsoDate;
  to: IsoDate;
}

const completedSalesIn = (ctx: ServiceContext, r: Range) =>
  and(eq(sales.businessId, ctx.businessId), eq(sales.status, "COMPLETED"), gte(sales.txnDate, r.from), lte(sales.txnDate, r.to));

export async function salesTotals(ctx: ServiceContext, r: Range) {
  const row = await ctx.db
    .select({
      orders: sql<number>`count(*)`,
      totalPaise: sql<number>`coalesce(sum(${sales.totalPaise}), 0)`,
      taxablePaise: sql<number>`coalesce(sum(${sales.taxablePaise}), 0)`,
      taxPaise: sql<number>`coalesce(sum(${sales.taxPaise}), 0)`,
      discountPaise: sql<number>`coalesce(sum(${sales.discountPaise}), 0)`,
      costPaise: sql<number>`coalesce(sum(${sales.costPaise}), 0)`,
      creditPaise: sql<number>`coalesce(sum(${sales.creditPaise}), 0)`,
    })
    .from(sales)
    .where(completedSalesIn(ctx, r))
    .get();
  const n = (v: unknown) => Number(v ?? 0);
  const taxable = n(row?.taxablePaise);
  const cost = n(row?.costPaise);
  return {
    orders: n(row?.orders),
    totalPaise: n(row?.totalPaise),
    taxablePaise: taxable,
    taxPaise: n(row?.taxPaise),
    discountPaise: n(row?.discountPaise),
    costPaise: cost,
    creditPaise: n(row?.creditPaise),
    grossProfitPaise: taxable - cost,
  };
}

export async function expenseTotal(ctx: ServiceContext, r: Range) {
  const row = await ctx.db
    .select({ total: sql<number>`coalesce(sum(${expenses.amountPaise}), 0)` })
    .from(expenses)
    .where(and(eq(expenses.businessId, ctx.businessId), eq(expenses.status, "COMPLETED"), gte(expenses.txnDate, r.from), lte(expenses.txnDate, r.to)))
    .get();
  return Number(row?.total ?? 0);
}

/** Daily series filled with zeros for days without sales. */
export async function salesByDay(ctx: ServiceContext, r: Range) {
  const rows = await ctx.db
    .select({
      date: sales.txnDate,
      orders: sql<number>`count(*)`,
      totalPaise: sql<number>`sum(${sales.totalPaise})`,
      profitPaise: sql<number>`sum(${sales.taxablePaise} - ${sales.costPaise})`,
    })
    .from(sales)
    .where(completedSalesIn(ctx, r))
    .groupBy(sales.txnDate);
  const by = new Map(rows.map((x) => [x.date, x]));
  return eachDay(r.from, r.to).map((date) => ({
    date,
    orders: Number(by.get(date)?.orders ?? 0),
    totalPaise: Number(by.get(date)?.totalPaise ?? 0),
    profitPaise: Number(by.get(date)?.profitPaise ?? 0),
  }));
}

export async function expensesByDay(ctx: ServiceContext, r: Range) {
  const rows = await ctx.db
    .select({ date: expenses.txnDate, totalPaise: sql<number>`sum(${expenses.amountPaise})` })
    .from(expenses)
    .where(and(eq(expenses.businessId, ctx.businessId), eq(expenses.status, "COMPLETED"), gte(expenses.txnDate, r.from), lte(expenses.txnDate, r.to)))
    .groupBy(expenses.txnDate);
  const by = new Map(rows.map((x) => [x.date, Number(x.totalPaise)]));
  return eachDay(r.from, r.to).map((date) => ({ date, totalPaise: by.get(date) ?? 0 }));
}

export async function topProducts(ctx: ServiceContext, r: Range, limit = 10) {
  const rows = await ctx.db
    .select({
      productId: saleItems.productId,
      name: saleItems.productName,
      unit: saleItems.unit,
      quantityMilli: sql<number>`sum(${saleItems.quantityMilli})`,
      revenuePaise: sql<number>`sum(${saleItems.totalPaise})`,
      profitPaise: sql<number>`sum(${saleItems.taxablePaise} - ${saleItems.costPaise})`,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .where(completedSalesIn(ctx, r))
    .groupBy(saleItems.productId)
    .orderBy(desc(sql`sum(${saleItems.totalPaise})`))
    .limit(limit);
  return rows.map((x) => ({ ...x, quantityMilli: Number(x.quantityMilli), revenuePaise: Number(x.revenuePaise), profitPaise: Number(x.profitPaise) }));
}

export async function salesByPaymentMethod(ctx: ServiceContext, r: Range) {
  const rows = await ctx.db
    .select({ method: payments.method, totalPaise: sql<number>`sum(${payments.amountPaise})` })
    .from(payments)
    .where(
      and(
        eq(payments.businessId, ctx.businessId),
        eq(payments.status, "COMPLETED"),
        eq(payments.direction, "IN"),
        gte(payments.txnDate, r.from),
        lte(payments.txnDate, r.to),
      ),
    )
    .groupBy(payments.method);
  const credit = (await salesTotals(ctx, r)).creditPaise;
  return [...rows.map((x) => ({ method: x.method, totalPaise: Number(x.totalPaise) })), ...(credit ? [{ method: "CREDIT", totalPaise: credit }] : [])];
}

export async function outstandingTotals(ctx: ServiceContext) {
  const [c, s] = await Promise.all([
    ctx.db
      .select({ total: sql<number>`coalesce(sum(case when ${customers.balancePaise} > 0 then ${customers.balancePaise} else 0 end), 0)`, count: sql<number>`sum(case when ${customers.balancePaise} > 0 then 1 else 0 end)` })
      .from(customers)
      .where(eq(customers.businessId, ctx.businessId))
      .get(),
    ctx.db
      .select({ total: sql<number>`coalesce(sum(case when ${suppliers.balancePaise} > 0 then ${suppliers.balancePaise} else 0 end), 0)` })
      .from(suppliers)
      .where(eq(suppliers.businessId, ctx.businessId))
      .get(),
  ]);
  return { receivablePaise: Number(c?.total ?? 0), customersWithDues: Number(c?.count ?? 0), payablePaise: Number(s?.total ?? 0) };
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export interface Insight {
  id: string;
  tone: "positive" | "negative" | "neutral" | "warning";
  text: string;
  link?: string;
}

export async function dashboard(ctx: ServiceContext) {
  const today = todayIst(ctx.now);
  const canMoney = ctx.permissions.has("reports.view");
  const trendRange = { from: addDays(today, -13), to: today };
  const [todayTotals, yesterdayTotals, outstanding, low, trend, top7, expenseTrend, todayTop] = await Promise.all([
    salesTotals(ctx, { from: today, to: today }),
    salesTotals(ctx, { from: addDays(today, -1), to: addDays(today, -1) }),
    outstandingTotals(ctx),
    lowStockProducts(ctx, 50),
    salesByDay(ctx, trendRange),
    topProducts(ctx, { from: addDays(today, -6), to: today }, 5),
    canMoney ? expensesByDay(ctx, { from: addDays(today, -29), to: today }) : Promise.resolve([]),
    topProducts(ctx, { from: today, to: today }, 1),
  ]);
  const todayExpenses = canMoney ? await expenseTotal(ctx, { from: today, to: today }) : 0;
  const insights = canMoney ? await buildInsights(ctx, { today, todayTotals, yesterdayTotals, outstanding, lowCount: low.length, todayTop: todayTop[0] }) : [];
  return {
    date: today,
    today: {
      salesPaise: todayTotals.totalPaise,
      orders: todayTotals.orders,
      grossProfitPaise: canMoney ? todayTotals.grossProfitPaise : null,
      expensesPaise: canMoney ? todayExpenses : null,
      netProfitPaise: canMoney ? todayTotals.grossProfitPaise - todayExpenses : null,
    },
    yesterday: { salesPaise: yesterdayTotals.totalPaise, orders: yesterdayTotals.orders },
    outstanding: canMoney || ctx.permissions.has("customer.ledger") ? outstanding : null,
    lowStock: { count: low.length, items: low.slice(0, 5) },
    salesTrend: trend,
    topProducts: top7,
    expenseTrend,
    insights,
  };
}

async function buildInsights(
  ctx: ServiceContext,
  d: {
    today: string;
    todayTotals: Awaited<ReturnType<typeof salesTotals>>;
    yesterdayTotals: Awaited<ReturnType<typeof salesTotals>>;
    outstanding: Awaited<ReturnType<typeof outstandingTotals>>;
    lowCount: number;
    todayTop?: { name: string; productId: string };
  },
): Promise<Insight[]> {
  const out: Insight[] = [];
  if (d.todayTop) out.push({ id: "top-today", tone: "positive", text: `Your highest-selling product today is ${d.todayTop.name}.`, link: `/products/${d.todayTop.productId}` });

  // Week-over-week change for the best seller of the last 7 days.
  const thisWeek = { from: addDays(d.today, -6), to: d.today };
  const lastWeek = { from: addDays(d.today, -13), to: addDays(d.today, -7) };
  const [top] = await topProducts(ctx, thisWeek, 1);
  if (top) {
    const prev = await ctx.db
      .select({ q: sql<number>`coalesce(sum(${saleItems.quantityMilli}), 0)` })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .where(and(completedSalesIn(ctx, lastWeek), eq(saleItems.productId, top.productId)))
      .get();
    const prevQty = Number(prev?.q ?? 0);
    if (prevQty > 0) {
      const pct = Math.round(((top.quantityMilli - prevQty) / prevQty) * 100);
      if (Math.abs(pct) >= 10) {
        out.push({ id: "wow", tone: pct > 0 ? "positive" : "negative", text: `${top.name} sales ${pct > 0 ? "increased" : "dropped"} ${Math.abs(pct)}% this week.`, link: `/products/${top.productId}` });
      }
    }
  }
  if (d.lowCount > 0) out.push({ id: "low", tone: "warning", text: `${d.lowCount} product${d.lowCount > 1 ? "s" : ""} ${d.lowCount > 1 ? "are" : "is"} running low.`, link: "/inventory?stock=low" });
  if (d.outstanding.receivablePaise > 0) {
    out.push({
      id: "outstanding",
      tone: "neutral",
      text: `${formatMoney(d.outstanding.receivablePaise, { compact: true })} is outstanding from ${d.outstanding.customersWithDues} customer${d.outstanding.customersWithDues === 1 ? "" : "s"}.`,
      link: "/customers?filter=outstanding",
    });
  }
  if (d.yesterdayTotals.totalPaise > 0 && d.todayTotals.totalPaise > d.yesterdayTotals.totalPaise) {
    out.push({ id: "beat-yesterday", tone: "positive", text: `Today's sales have already crossed yesterday's ${formatMoney(d.yesterdayTotals.totalPaise, { compact: true })}.` });
  }
  return out;
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export async function salesReport(ctx: ServiceContext, r: Range) {
  requirePermission(ctx, "reports.view");
  const [totals, series, byMethod, top] = await Promise.all([salesTotals(ctx, r), salesByDay(ctx, r), salesByPaymentMethod(ctx, r), topProducts(ctx, r, 10)]);
  return { range: r, totals, series, byMethod, topProducts: top };
}

export async function profitReport(ctx: ServiceContext, r: Range) {
  requirePermission(ctx, "reports.view");
  const [totals, exp, series, expSeries] = await Promise.all([salesTotals(ctx, r), expenseTotal(ctx, r), salesByDay(ctx, r), expensesByDay(ctx, r)]);
  const net = totals.grossProfitPaise - exp;
  const expBy = new Map(expSeries.map((e) => [e.date, e.totalPaise]));
  return {
    range: r,
    revenuePaise: totals.taxablePaise,
    costOfGoodsPaise: totals.costPaise,
    grossProfitPaise: totals.grossProfitPaise,
    expensesPaise: exp,
    netProfitPaise: net,
    grossMarginPct: totals.taxablePaise > 0 ? Math.round((totals.grossProfitPaise / totals.taxablePaise) * 1000) / 10 : 0,
    series: series.map((s) => ({ date: s.date, grossProfitPaise: s.profitPaise, expensesPaise: expBy.get(s.date) ?? 0, netProfitPaise: s.profitPaise - (expBy.get(s.date) ?? 0) })),
  };
}

export async function expensesReport(ctx: ServiceContext, r: Range) {
  requirePermission(ctx, "reports.view");
  const where = and(eq(expenses.businessId, ctx.businessId), eq(expenses.status, "COMPLETED"), gte(expenses.txnDate, r.from), lte(expenses.txnDate, r.to));
  const [byCategory, series] = await Promise.all([
    ctx.db
      .select({ category: expenseCategories.name, totalPaise: sql<number>`sum(${expenses.amountPaise})`, count: sql<number>`count(*)` })
      .from(expenses)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .where(where)
      .groupBy(expenseCategories.name)
      .orderBy(desc(sql`sum(${expenses.amountPaise})`)),
    expensesByDay(ctx, r),
  ]);
  const cats = byCategory.map((c) => ({ ...c, totalPaise: Number(c.totalPaise), count: Number(c.count) }));
  return { range: r, totalPaise: cats.reduce((a, c) => a + c.totalPaise, 0), byCategory: cats, series };
}

export async function inventoryValuation(ctx: ServiceContext) {
  requirePermission(ctx, "reports.view");
  const rows = await ctx.db
    .select({
      id: products.id,
      name: products.name,
      unit: products.unit,
      category: productCategories.name,
      stockMilli: products.currentStockMilli,
      avgCostPaise: products.avgCostPaise,
      sellingPricePaise: products.sellingPricePaise,
    })
    .from(products)
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .where(and(eq(products.businessId, ctx.businessId), eq(products.isActive, true), eq(products.trackStock, true)))
    .orderBy(asc(products.name));
  const items = rows.map((r) => {
    const qty = Math.max(0, r.stockMilli);
    return { ...r, costValuePaise: Math.round((qty * r.avgCostPaise) / 1000), retailValuePaise: Math.round((qty * r.sellingPricePaise) / 1000) };
  });
  return {
    items,
    totals: { costValuePaise: items.reduce((a, i) => a + i.costValuePaise, 0), retailValuePaise: items.reduce((a, i) => a + i.retailValuePaise, 0), products: items.length },
  };
}

export async function customerOutstanding(ctx: ServiceContext) {
  requirePermission(ctx, "reports.view");
  return ctx.db
    .select({ id: customers.id, name: customers.name, phone: customers.phone, balancePaise: customers.balancePaise, lastTxnAt: customers.lastTxnAt })
    .from(customers)
    .where(and(eq(customers.businessId, ctx.businessId), gt(customers.balancePaise, 0)))
    .orderBy(desc(customers.balancePaise));
}

export async function supplierOutstanding(ctx: ServiceContext) {
  requirePermission(ctx, "reports.view");
  return ctx.db
    .select({ id: suppliers.id, name: suppliers.name, phone: suppliers.phone, balancePaise: suppliers.balancePaise, lastTxnAt: suppliers.lastTxnAt })
    .from(suppliers)
    .where(and(eq(suppliers.businessId, ctx.businessId), gt(suppliers.balancePaise, 0)))
    .orderBy(desc(suppliers.balancePaise));
}

/** GST summary: output tax on sales vs input tax on purchases, by rate. Not a filing. */
export async function gstSummary(ctx: ServiceContext, r: Range) {
  requirePermission(ctx, "reports.view");
  const [out, inp] = await Promise.all([
    ctx.db
      .select({
        rateBp: saleItems.gstRateBp,
        taxablePaise: sql<number>`sum(${saleItems.taxablePaise})`,
        cgstPaise: sql<number>`sum(${saleItems.cgstPaise})`,
        sgstPaise: sql<number>`sum(${saleItems.sgstPaise})`,
        igstPaise: sql<number>`sum(${saleItems.igstPaise})`,
        taxPaise: sql<number>`sum(${saleItems.taxPaise})`,
      })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .where(completedSalesIn(ctx, r))
      .groupBy(saleItems.gstRateBp)
      .orderBy(asc(saleItems.gstRateBp)),
    ctx.db
      .select({
        rateBp: purchaseItems.gstRateBp,
        taxablePaise: sql<number>`sum(${purchaseItems.taxablePaise})`,
        cgstPaise: sql<number>`sum(${purchaseItems.cgstPaise})`,
        sgstPaise: sql<number>`sum(${purchaseItems.sgstPaise})`,
        igstPaise: sql<number>`sum(${purchaseItems.igstPaise})`,
        taxPaise: sql<number>`sum(${purchaseItems.taxPaise})`,
      })
      .from(purchaseItems)
      .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
      .where(and(eq(purchases.businessId, ctx.businessId), eq(purchases.status, "COMPLETED"), gte(purchases.txnDate, r.from), lte(purchases.txnDate, r.to)))
      .groupBy(purchaseItems.gstRateBp)
      .orderBy(asc(purchaseItems.gstRateBp)),
  ]);
  const norm = (rows: typeof out) => rows.map((x) => ({ rateBp: x.rateBp, taxablePaise: Number(x.taxablePaise), cgstPaise: Number(x.cgstPaise), sgstPaise: Number(x.sgstPaise), igstPaise: Number(x.igstPaise), taxPaise: Number(x.taxPaise) }));
  const output = norm(out);
  const input = norm(inp);
  const outTax = output.reduce((a, x) => a + x.taxPaise, 0);
  const inTax = input.reduce((a, x) => a + x.taxPaise, 0);
  return { range: r, output, input, outputTaxPaise: outTax, inputTaxPaise: inTax, netPayablePaise: outTax - inTax };
}

/** Named period helper for AI answers & report presets. */
export function periodRange(period: "today" | "yesterday" | "this_week" | "last_7_days" | "this_month" | "last_month" | "last_30_days", now: number): Range {
  const today = todayIst(now);
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "this_week":
      return { from: startOfWeek(today), to: today };
    case "last_7_days":
      return { from: addDays(today, -6), to: today };
    case "this_month":
      return { from: startOfMonth(today), to: today };
    case "last_month": {
      const end = addDays(startOfMonth(today), -1);
      return { from: startOfMonth(end), to: end };
    }
    case "last_30_days":
      return { from: addDays(today, -29), to: today };
  }
}

// ─── CSV exports ─────────────────────────────────────────────────────────────

export async function reportCsv(ctx: ServiceContext, kind: string, r: Range): Promise<{ filename: string; csv: string }> {
  const R = paiseToRupeeString;
  switch (kind) {
    case "sales": {
      const s = await salesReport(ctx, r);
      return { filename: `sales-${r.from}-${r.to}.csv`, csv: toCsv(["date", "orders", "sales", "gross_profit"], s.series.map((d) => [d.date, d.orders, R(d.totalPaise), R(d.profitPaise)])) };
    }
    case "profit": {
      const p = await profitReport(ctx, r);
      return { filename: `profit-${r.from}-${r.to}.csv`, csv: toCsv(["date", "gross_profit", "expenses", "net_profit"], p.series.map((d) => [d.date, R(d.grossProfitPaise), R(d.expensesPaise), R(d.netProfitPaise)])) };
    }
    case "expenses": {
      const e = await expensesReport(ctx, r);
      return { filename: `expenses-${r.from}-${r.to}.csv`, csv: toCsv(["category", "entries", "total"], e.byCategory.map((c) => [c.category, c.count, R(c.totalPaise)])) };
    }
    case "top-products": {
      const t = await topProducts(ctx, r, 100);
      requirePermission(ctx, "reports.view");
      return { filename: `top-products-${r.from}-${r.to}.csv`, csv: toCsv(["product", "quantity", "unit", "revenue", "profit"], t.map((x) => [x.name, fromMilli(x.quantityMilli), x.unit, R(x.revenuePaise), R(x.profitPaise)])) };
    }
    case "inventory": {
      const v = await inventoryValuation(ctx);
      return { filename: `inventory-valuation-${todayIst(ctx.now)}.csv`, csv: toCsv(["product", "category", "stock", "unit", "avg_cost", "cost_value", "retail_value"], v.items.map((i) => [i.name, i.category, fromMilli(i.stockMilli), i.unit, R(i.avgCostPaise), R(i.costValuePaise), R(i.retailValuePaise)])) };
    }
    case "low-stock": {
      requirePermission(ctx, "reports.view");
      const l = await lowStockProducts(ctx, 500);
      return { filename: `low-stock-${todayIst(ctx.now)}.csv`, csv: toCsv(["product", "stock", "threshold", "unit", "suggested_reorder"], l.map((i) => [i.name, fromMilli(i.currentStockMilli), fromMilli(i.lowStockThresholdMilli), i.unit, fromMilli(i.suggestedReorderMilli)])) };
    }
    case "customer-outstanding": {
      const c = await customerOutstanding(ctx);
      return { filename: `customer-outstanding-${todayIst(ctx.now)}.csv`, csv: toCsv(["customer", "phone", "outstanding"], c.map((x) => [x.name, x.phone, R(x.balancePaise)])) };
    }
    case "supplier-outstanding": {
      const s = await supplierOutstanding(ctx);
      return { filename: `supplier-outstanding-${todayIst(ctx.now)}.csv`, csv: toCsv(["supplier", "phone", "payable"], s.map((x) => [x.name, x.phone, R(x.balancePaise)])) };
    }
    case "gst": {
      const g = await gstSummary(ctx, r);
      const rows = [
        ...g.output.map((x) => ["output (sales)", x.rateBp / 100, R(x.taxablePaise), R(x.cgstPaise), R(x.sgstPaise), R(x.igstPaise), R(x.taxPaise)]),
        ...g.input.map((x) => ["input (purchases)", x.rateBp / 100, R(x.taxablePaise), R(x.cgstPaise), R(x.sgstPaise), R(x.igstPaise), R(x.taxPaise)]),
      ];
      return { filename: `gst-summary-${r.from}-${r.to}.csv`, csv: toCsv(["type", "gst_rate", "taxable", "cgst", "sgst", "igst", "total_tax"], rows) };
    }
    default:
      throw new Error(`Unknown report ${kind}`);
  }
}
