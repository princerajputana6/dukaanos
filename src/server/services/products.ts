import { and, asc, desc, eq, gte, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { ref } from "@/server/db/sql";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { z } from "zod";
import { parseCsvObjects, toCsv } from "@/lib/csv";
import { todayIst, startOfMonth } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { parseRupees, paiseToRupeeString } from "@/lib/money";
import { formatQty, fromMilli, toMilli } from "@/lib/qty";
import { buildSearchText, escapeLike, normalizeText, phoneticKey, tokenize } from "@/lib/text";
import { samplesFor } from "@/server/db/sample-products";
import {
  businesses,
  businessSettings,
  inventoryMovements,
  productAliases,
  productCategories,
  products,
  productUnits,
  saleItems,
  sales,
  suppliers,
} from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import type { createProductSchema, listProductsSchema, updateProductSchema } from "@/schemas/products";
import { createProductSchema as createSchema } from "@/schemas/products";
import { requirePermission, type ServiceContext } from "./context";
import { auditStmt, checkIdempotency, commit, eventStmt, type Stmt } from "./engine";
import { movementStmts, refreshStockAlerts } from "./inventory";

type CreateInput = z.output<typeof createProductSchema>;
type UpdateInput = z.output<typeof updateProductSchema>;
type ListInput = z.output<typeof listProductsSchema>;

export type ProductRow = typeof products.$inferSelect;

function productSearchText(p: { name: string; brand?: string | null; sku?: string | null; barcode?: string | null }, aliases: string[], category?: string | null) {
  return buildSearchText(p.name, p.brand, p.sku, p.barcode, category, ...aliases);
}

function uniqueAliases(name: string, aliases: string[]): string[] {
  const seen = new Set([normalizeText(name)]);
  const out: string[] = [];
  for (const a of aliases) {
    const n = normalizeText(a);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(a.trim());
  }
  return out;
}

/** Resolves categoryId / categoryName into an id, creating the category if needed. */
async function resolveCategory(ctx: ServiceContext, categoryId?: string | null, categoryName?: string | null) {
  if (categoryId) {
    const c = await ctx.db
      .select()
      .from(productCategories)
      .where(and(eq(productCategories.id, categoryId), eq(productCategories.businessId, ctx.businessId)))
      .get();
    if (!c) throw new AppError("VALIDATION_ERROR", "Category not found.");
    return { id: c.id, name: c.name, stmt: null as Stmt | null };
  }
  if (categoryName) {
    const existing = await ctx.db
      .select()
      .from(productCategories)
      .where(and(eq(productCategories.businessId, ctx.businessId), sql`lower(${productCategories.name}) = lower(${categoryName})`))
      .get();
    if (existing) return { id: existing.id, name: existing.name, stmt: null };
    const id = newId(ctx.now);
    return {
      id,
      name: categoryName,
      stmt: ctx.db.insert(productCategories).values({ id, businessId: ctx.businessId, name: categoryName, createdAt: ctx.now }) as Stmt,
    };
  }
  return { id: null, name: null, stmt: null };
}

async function assertSupplier(ctx: ServiceContext, supplierId?: string | null) {
  if (!supplierId) return;
  const s = await ctx.db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.businessId, ctx.businessId)))
    .get();
  if (!s) throw new AppError("SUPPLIER_NOT_FOUND", "Supplier not found.");
}

async function assertUniqueCodes(ctx: ServiceContext, sku?: string | null, barcode?: string | null, exceptId?: string) {
  const conds: SQL[] = [];
  if (sku) conds.push(eq(products.sku, sku));
  if (barcode) conds.push(eq(products.barcode, barcode));
  if (!conds.length) return;
  const clash = await ctx.db
    .select({ id: products.id, name: products.name, sku: products.sku, barcode: products.barcode })
    .from(products)
    .where(and(eq(products.businessId, ctx.businessId), or(...conds)))
    .all();
  const other = clash.find((c) => c.id !== exceptId);
  if (other) {
    const field = sku && other.sku === sku ? "SKU" : "Barcode";
    throw new AppError("DUPLICATE", `${field} is already used by ${other.name}.`);
  }
}

/** Builds (but does not commit) all statements that create one product. */
async function planCreate(ctx: ServiceContext, input: CreateInput, defaults: { lowStockMilli: number }) {
  const cat = await resolveCategory(ctx, input.categoryId, input.categoryName);
  const id = newId(ctx.now);
  const aliases = uniqueAliases(input.name, input.aliases);
  const threshold = input.lowStockThresholdMilli ?? (input.trackStock ? defaults.lowStockMilli : 0);
  const stmts: Stmt[] = [];
  if (cat.stmt) stmts.push(cat.stmt);
  stmts.push(
    ctx.db.insert(products).values({
      id,
      businessId: ctx.businessId,
      name: input.name,
      sku: input.sku ?? null,
      barcode: input.barcode ?? null,
      categoryId: cat.id,
      brand: input.brand ?? null,
      unit: input.unit,
      purchasePricePaise: input.purchasePricePaise,
      avgCostPaise: input.purchasePricePaise,
      sellingPricePaise: input.sellingPricePaise,
      mrpPaise: input.mrpPaise ?? null,
      gstRateBp: input.gstRateBp,
      hsnCode: input.hsnCode ?? null,
      openingStockMilli: input.trackStock ? input.openingStockMilli : 0,
      currentStockMilli: 0,
      lowStockThresholdMilli: threshold,
      trackStock: input.trackStock,
      supplierId: input.supplierId ?? null,
      searchText: productSearchText(input, aliases, cat.name),
      createdBy: ctx.userId,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    }),
  );
  for (const alias of aliases) {
    stmts.push(ctx.db.insert(productAliases).values({ id: newId(ctx.now), businessId: ctx.businessId, productId: id, alias, aliasNorm: normalizeText(alias), createdAt: ctx.now }));
  }
  for (const u of input.units) {
    stmts.push(ctx.db.insert(productUnits).values({ id: newId(ctx.now), businessId: ctx.businessId, productId: id, name: u.name, factorMilli: u.factorMilli, createdAt: ctx.now }));
  }
  if (input.trackStock && input.openingStockMilli > 0) {
    stmts.push(
      ...movementStmts(ctx, {
        productId: id,
        deltaMilli: input.openingStockMilli,
        type: "OPENING",
        referenceType: "product",
        referenceId: id,
        reason: "Opening stock",
        txnDate: todayIst(ctx.now),
      }),
    );
  }
  stmts.push(
    auditStmt(ctx, {
      action: "PRODUCT_CREATED",
      entityType: "product",
      entityId: id,
      summary: `Added ${input.name}${input.trackStock && input.openingStockMilli ? ` with ${formatQty(input.openingStockMilli)} ${input.unit}` : ""}`,
      after: { ...input, aliases },
    }),
  );
  return { id, stmts };
}

async function lowStockDefault(ctx: ServiceContext) {
  const s = await ctx.db.select({ v: businessSettings.defaultLowStockMilli }).from(businessSettings).where(eq(businessSettings.businessId, ctx.businessId)).get();
  return s?.v ?? 5000;
}

export async function createProduct(ctx: ServiceContext, input: CreateInput, idempotencyKey?: string | null) {
  requirePermission(ctx, "inventory.create");
  const idem = await checkIdempotency<{ id: string }>(ctx, idempotencyKey, { op: "createProduct", input });
  if ("replay" in idem) return idem.replay;
  await assertUniqueCodes(ctx, input.sku, input.barcode);
  await assertSupplier(ctx, input.supplierId);
  const plan = await planCreate(ctx, input, { lowStockMilli: await lowStockDefault(ctx) });
  const out = await commit(ctx, [...plan.stmts, eventStmt(ctx, "product_created")], { id: plan.id }, idem.ticket);
  await refreshStockAlerts(ctx, [plan.id]);
  return out;
}

export async function updateProduct(ctx: ServiceContext, id: string, input: UpdateInput) {
  requirePermission(ctx, "inventory.create");
  const before = await getProductRow(ctx, id);
  await assertUniqueCodes(ctx, input.sku, input.barcode, id);
  await assertSupplier(ctx, input.supplierId);
  const cat = input.categoryId !== undefined || input.categoryName ? await resolveCategory(ctx, input.categoryId, input.categoryName) : null;
  const next = { ...before, ...stripUndefined(input) };
  if (next.mrpPaise && next.sellingPricePaise > next.mrpPaise) throw new AppError("VALIDATION_ERROR", "Selling price cannot be more than MRP.");

  const currentAliases = await ctx.db.select().from(productAliases).where(and(eq(productAliases.productId, id), eq(productAliases.businessId, ctx.businessId)));
  const aliases = input.aliases ? uniqueAliases(next.name, input.aliases) : currentAliases.map((a) => a.alias);
  const categoryName = cat
    ? cat.name
    : before.categoryId
      ? ((await ctx.db.select({ name: productCategories.name }).from(productCategories).where(eq(productCategories.id, before.categoryId)).get())?.name ?? null)
      : null;

  const stmts: Stmt[] = [];
  if (cat?.stmt) stmts.push(cat.stmt);
  stmts.push(
    ctx.db
      .update(products)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.sku !== undefined && { sku: input.sku ?? null }),
        ...(input.barcode !== undefined && { barcode: input.barcode ?? null }),
        ...(cat && { categoryId: cat.id }),
        ...(input.brand !== undefined && { brand: input.brand ?? null }),
        ...(input.unit !== undefined && { unit: input.unit }),
        ...(input.purchasePricePaise !== undefined && { purchasePricePaise: input.purchasePricePaise }),
        ...(input.sellingPricePaise !== undefined && { sellingPricePaise: input.sellingPricePaise }),
        ...(input.mrpPaise !== undefined && { mrpPaise: input.mrpPaise ?? null }),
        ...(input.gstRateBp !== undefined && { gstRateBp: input.gstRateBp }),
        ...(input.hsnCode !== undefined && { hsnCode: input.hsnCode ?? null }),
        ...(input.lowStockThresholdMilli !== undefined && { lowStockThresholdMilli: input.lowStockThresholdMilli ?? 0 }),
        ...(input.trackStock !== undefined && { trackStock: input.trackStock }),
        ...(input.supplierId !== undefined && { supplierId: input.supplierId ?? null }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        searchText: productSearchText(next, aliases, categoryName),
        updatedAt: ctx.now,
      })
      .where(and(eq(products.id, id), eq(products.businessId, ctx.businessId))),
  );
  if (input.aliases) {
    stmts.push(ctx.db.delete(productAliases).where(and(eq(productAliases.productId, id), eq(productAliases.businessId, ctx.businessId))));
    for (const alias of aliases) {
      stmts.push(ctx.db.insert(productAliases).values({ id: newId(ctx.now), businessId: ctx.businessId, productId: id, alias, aliasNorm: normalizeText(alias), createdAt: ctx.now }));
    }
  }
  if (input.units) {
    stmts.push(ctx.db.delete(productUnits).where(and(eq(productUnits.productId, id), eq(productUnits.businessId, ctx.businessId))));
    for (const u of input.units) {
      stmts.push(ctx.db.insert(productUnits).values({ id: newId(ctx.now), businessId: ctx.businessId, productId: id, name: u.name, factorMilli: u.factorMilli, createdAt: ctx.now }));
    }
  }
  const changed = Object.keys(stripUndefined(input));
  const action = input.isActive === false ? "PRODUCT_ARCHIVED" : input.isActive === true && !before.isActive ? "PRODUCT_RESTORED" : "PRODUCT_UPDATED";
  stmts.push(
    auditStmt(ctx, {
      action,
      entityType: "product",
      entityId: id,
      summary: `${action === "PRODUCT_ARCHIVED" ? "Archived" : action === "PRODUCT_RESTORED" ? "Restored" : "Updated"} ${next.name}`,
      before: Object.fromEntries(changed.map((k) => [k, (before as Record<string, unknown>)[k] ?? (k === "aliases" ? currentAliases.map((a) => a.alias) : null)])),
      after: stripUndefined(input),
    }),
  );
  await commit(ctx, stmts, null);
  if (input.lowStockThresholdMilli !== undefined || input.isActive !== undefined) await refreshStockAlerts(ctx, [id]);
  return { id };
}

function stripUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export async function getProductRow(ctx: ServiceContext, id: string): Promise<ProductRow> {
  const p = await ctx.db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.businessId, ctx.businessId)))
    .get();
  if (!p) throw new AppError("PRODUCT_NOT_FOUND", "Product not found.");
  return p;
}

const listColumns = {
  id: products.id,
  name: products.name,
  sku: products.sku,
  barcode: products.barcode,
  brand: products.brand,
  unit: products.unit,
  categoryId: products.categoryId,
  categoryName: productCategories.name,
  purchasePricePaise: products.purchasePricePaise,
  avgCostPaise: products.avgCostPaise,
  sellingPricePaise: products.sellingPricePaise,
  mrpPaise: products.mrpPaise,
  gstRateBp: products.gstRateBp,
  hsnCode: products.hsnCode,
  currentStockMilli: products.currentStockMilli,
  lowStockThresholdMilli: products.lowStockThresholdMilli,
  trackStock: products.trackStock,
  isActive: products.isActive,
  imageKey: products.imageKey,
  updatedAt: products.updatedAt,
};

/** Token-wise search that matches normalised text OR phonetic keys (handles Hinglish / Devanagari). */
export function searchCondition(column: AnySQLiteColumn, q: string): SQL | undefined {
  const tokens = tokenize(q).slice(0, 6);
  if (!tokens.length) return undefined;
  return and(
    ...tokens.map((t) => {
      const conds = [like(column, `%${escapeLike(t)}%`)];
      const ph = /^\d/.test(t) ? null : phoneticKey(t);
      if (ph && ph.length >= 2) conds.push(like(column, `%${escapeLike(ph)}%`));
      return or(...conds)!;
    }),
  );
}

export async function listProducts(ctx: ServiceContext, input: ListInput) {
  const offset = Number(input.cursor ?? 0) || 0;
  const conds: SQL[] = [eq(products.businessId, ctx.businessId)];
  if (input.status === "active") conds.push(eq(products.isActive, true));
  if (input.status === "archived") conds.push(eq(products.isActive, false));
  if (input.categoryId) conds.push(eq(products.categoryId, input.categoryId));
  if (input.stock === "out") conds.push(sql`${products.trackStock} = 1 AND ${products.currentStockMilli} <= 0`);
  if (input.stock === "low") conds.push(sql`${products.trackStock} = 1 AND ${products.currentStockMilli} > 0 AND ${products.currentStockMilli} <= ${products.lowStockThresholdMilli}`);
  if (input.stock === "in") conds.push(sql`(${products.trackStock} = 0 OR ${products.currentStockMilli} > ${products.lowStockThresholdMilli})`);
  if (input.q) {
    const byCode = or(eq(products.barcode, input.q.trim()), eq(products.sku, input.q.trim()));
    const s = searchCondition(products.searchText, input.q);
    conds.push(s ? or(byCode, s)! : byCode!);
  }
  const order =
    input.sort === "stock"
      ? [asc(products.currentStockMilli), asc(products.name)]
      : input.sort === "recent"
        ? [desc(products.updatedAt)]
        : input.sort === "price"
          ? [desc(products.sellingPricePaise)]
          : [asc(sql`lower(${products.name})`)];
  const rows = await ctx.db
    .select(listColumns)
    .from(products)
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .where(and(...conds))
    .orderBy(...order)
    .limit(input.limit + 1)
    .offset(offset);
  const hasMore = rows.length > input.limit;
  const items = rows.slice(0, input.limit);
  // Attach pack units so the POS can sell "1 crate".
  const unitRows = items.length
    ? await ctx.db
        .select({ productId: productUnits.productId, name: productUnits.name, factorMilli: productUnits.factorMilli })
        .from(productUnits)
        .where(and(eq(productUnits.businessId, ctx.businessId), inArray(productUnits.productId, items.map((i) => i.id))))
    : [];
  const unitsBy = new Map<string, Array<{ name: string; factorMilli: number }>>();
  for (const u of unitRows) unitsBy.set(u.productId, [...(unitsBy.get(u.productId) ?? []), { name: u.name, factorMilli: u.factorMilli }]);
  return { items: items.map((i) => ({ ...i, units: unitsBy.get(i.id) ?? [] })), nextCursor: hasMore ? String(offset + input.limit) : null };
}

export async function getProductDetail(ctx: ServiceContext, id: string) {
  const p = await getProductRow(ctx, id);
  const today = todayIst(ctx.now);
  const monthStart = startOfMonth(today);
  const [aliases, units, category, supplier, stats, recentSales, movements] = await Promise.all([
    ctx.db.select({ id: productAliases.id, alias: productAliases.alias }).from(productAliases).where(and(eq(productAliases.productId, id), eq(productAliases.businessId, ctx.businessId))),
    ctx.db.select({ id: productUnits.id, name: productUnits.name, factorMilli: productUnits.factorMilli }).from(productUnits).where(and(eq(productUnits.productId, id), eq(productUnits.businessId, ctx.businessId))),
    p.categoryId ? ctx.db.select().from(productCategories).where(eq(productCategories.id, p.categoryId)).get() : Promise.resolve(undefined),
    p.supplierId ? ctx.db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(and(eq(suppliers.id, p.supplierId), eq(suppliers.businessId, ctx.businessId))).get() : Promise.resolve(undefined),
    ctx.db
      .select({
        todayQty: sql<number>`coalesce(sum(case when ${sales.txnDate} = ${today} then ${saleItems.quantityMilli} else 0 end), 0)`,
        todayRevenue: sql<number>`coalesce(sum(case when ${sales.txnDate} = ${today} then ${saleItems.totalPaise} else 0 end), 0)`,
        monthQty: sql<number>`coalesce(sum(${saleItems.quantityMilli}), 0)`,
        monthRevenue: sql<number>`coalesce(sum(${saleItems.totalPaise}), 0)`,
        monthProfit: sql<number>`coalesce(sum(${saleItems.taxablePaise} - ${saleItems.costPaise}), 0)`,
      })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .where(and(eq(saleItems.businessId, ctx.businessId), eq(saleItems.productId, id), eq(sales.status, "COMPLETED"), gte(sales.txnDate, monthStart)))
      .get(),
    ctx.db
      .select({
        saleId: sales.id,
        invoiceNumber: sales.invoiceNumber,
        txnDate: sales.txnDate,
        createdAt: sales.createdAt,
        quantityMilli: saleItems.quantityMilli,
        totalPaise: saleItems.totalPaise,
        status: sales.status,
      })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .where(and(eq(saleItems.businessId, ctx.businessId), eq(saleItems.productId, id)))
      .orderBy(desc(sales.createdAt))
      .limit(10),
    ctx.db
      .select()
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.businessId, ctx.businessId), eq(inventoryMovements.productId, id)))
      .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
      .limit(20),
  ]);
  const margin = p.sellingPricePaise - (p.avgCostPaise || p.purchasePricePaise);
  return {
    product: p,
    aliases,
    units,
    category: category ? { id: category.id, name: category.name } : null,
    supplier: supplier ?? null,
    stats: {
      salesTodayMilli: Number(stats?.todayQty ?? 0),
      revenueTodayPaise: Number(stats?.todayRevenue ?? 0),
      salesMonthMilli: Number(stats?.monthQty ?? 0),
      revenueMonthPaise: Number(stats?.monthRevenue ?? 0),
      profitMonthPaise: Number(stats?.monthProfit ?? 0),
      unitMarginPaise: margin,
    },
    recentSales,
    movements,
  };
}

export async function listCategories(ctx: ServiceContext) {
  return ctx.db
    .select({ id: productCategories.id, name: productCategories.name, productCount: sql<number>`(select count(*) from products p where p.category_id = ${ref(productCategories.id)} and p.is_active = 1)` })
    .from(productCategories)
    .where(eq(productCategories.businessId, ctx.businessId))
    .orderBy(asc(productCategories.name));
}

export async function createCategory(ctx: ServiceContext, name: string) {
  requirePermission(ctx, "inventory.create");
  const cat = await resolveCategory(ctx, null, name);
  if (cat.stmt) {
    await commit(ctx, [cat.stmt, auditStmt(ctx, { action: "CATEGORY_CREATED", entityType: "product_category", entityId: cat.id, summary: `Added category ${name}` })], null);
  }
  return { id: cat.id!, name: cat.name! };
}

// ─── CSV import / export ─────────────────────────────────────────────────────

export const PRODUCT_CSV_HEADER = [
  "name",
  "sku",
  "barcode",
  "category",
  "brand",
  "unit",
  "purchase_price",
  "selling_price",
  "mrp",
  "gst_rate",
  "hsn_code",
  "opening_stock",
  "low_stock_threshold",
  "aliases",
];

export interface ImportReport {
  created: number;
  skipped: number;
  errors: Array<{ row: number; name: string; message: string }>;
  dryRun: boolean;
}

/** Imports products from CSV. Every row is validated; invalid rows are reported, never guessed. */
export async function importProductsCsv(ctx: ServiceContext, csv: string, dryRun: boolean): Promise<ImportReport> {
  requirePermission(ctx, "inventory.create");
  const rows = parseCsvObjects(csv);
  if (rows.length === 0) throw new AppError("VALIDATION_ERROR", "The file has no product rows. Keep the header row and add one product per line.");
  if (rows.length > 500) throw new AppError("VALIDATION_ERROR", "Please import at most 500 products per file.");

  const existing = await ctx.db.select({ name: products.name, sku: products.sku, barcode: products.barcode }).from(products).where(eq(products.businessId, ctx.businessId));
  const names = new Set(existing.map((e) => normalizeText(e.name)));
  const skus = new Set(existing.map((e) => e.sku).filter(Boolean));
  const barcodes = new Set(existing.map((e) => e.barcode).filter(Boolean));
  const defaults = { lowStockMilli: await lowStockDefault(ctx) };
  const report: ImportReport = { created: 0, skipped: 0, errors: [], dryRun };
  const valid: CreateInput[] = [];

  rows.forEach((r, i) => {
    const rowNo = i + 2;
    const name = r.name ?? r.product ?? r.product_name ?? "";
    const fail = (message: string) => report.errors.push({ row: rowNo, name, message });
    const money = (v: string | undefined, label: string, required = false) => {
      if (!v) return required ? (fail(`${label} is required`), undefined) : null;
      const p = parseRupees(v);
      if (p === null) return fail(`${label} "${v}" is not a valid amount`), undefined;
      return p;
    };
    const selling = money(r.selling_price ?? r.price, "Selling price", true);
    const purchase = money(r.purchase_price ?? r.cost, "Purchase price");
    const mrp = money(r.mrp, "MRP");
    const gstRaw = (r.gst_rate ?? r.gst ?? "0").replace("%", "");
    const gst = Number(gstRaw);
    const opening = toMilli(r.opening_stock || r.stock || "0");
    const threshold = r.low_stock_threshold ? toMilli(r.low_stock_threshold) : null;
    if (!name) return void fail("Name is required");
    if (selling === undefined || purchase === undefined || mrp === undefined) return;
    if (!Number.isFinite(gst) || gst < 0 || gst > 40) return void fail(`GST rate "${gstRaw}" is not valid`);
    if (opening === null || opening < 0) return void fail(`Opening stock "${r.opening_stock}" is not valid`);
    if (r.low_stock_threshold && threshold === null) return void fail(`Low stock threshold "${r.low_stock_threshold}" is not valid`);
    if (names.has(normalizeText(name))) {
      report.skipped++;
      return;
    }
    if (r.sku && skus.has(r.sku)) return void fail(`SKU ${r.sku} already exists`);
    if (r.barcode && barcodes.has(r.barcode)) return void fail(`Barcode ${r.barcode} already exists`);
    const parsed = createSchema.safeParse({
      name,
      sku: r.sku || null,
      barcode: r.barcode || null,
      categoryName: r.category || null,
      brand: r.brand || null,
      unit: r.unit || "pcs",
      purchasePricePaise: purchase ?? 0,
      sellingPricePaise: selling,
      mrpPaise: mrp,
      gstRateBp: Math.round(gst * 100),
      hsnCode: r.hsn_code || r.hsn || null,
      openingStockMilli: opening,
      lowStockThresholdMilli: threshold,
      aliases: (r.aliases ?? "").split(/[|;]/).map((a) => a.trim()).filter(Boolean),
    });
    if (!parsed.success) return void fail(parsed.error.issues[0]?.message ?? "Invalid row");
    names.add(normalizeText(name));
    if (r.sku) skus.add(r.sku);
    if (r.barcode) barcodes.add(r.barcode);
    valid.push(parsed.data);
  });

  if (dryRun) {
    report.created = valid.length;
    return report;
  }
  const importCtx: ServiceContext = { ...ctx, source: "IMPORT" };
  // Resolve every distinct category once (creating missing ones), then plan products by id.
  const catIds = await ensureCategories(importCtx, valid.map((v) => v.categoryName).filter((c): c is string => !!c));
  // Commit in chunks so one bad chunk doesn't lose the rest.
  for (let i = 0; i < valid.length; i += 20) {
    const chunk = valid.slice(i, i + 20);
    const stmts: Stmt[] = [];
    const ids: string[] = [];
    for (const input of chunk) {
      const categoryId = input.categoryName ? (catIds.get(input.categoryName.toLowerCase()) ?? null) : null;
      const plan = await planCreate(importCtx, { ...input, categoryId, categoryName: null }, defaults);
      stmts.push(...plan.stmts);
      ids.push(plan.id);
    }
    try {
      await commit(importCtx, stmts, null);
      report.created += chunk.length;
      await refreshStockAlerts(importCtx, ids);
    } catch (err) {
      chunk.forEach((c) => report.errors.push({ row: 0, name: c.name, message: err instanceof AppError ? err.message : "Could not save this row" }));
    }
  }
  await commit(ctx, [auditStmt(importCtx, { action: "PRODUCTS_IMPORTED", entityType: "product", entityId: null, summary: `Imported ${report.created} products from CSV`, after: { created: report.created, skipped: report.skipped, errors: report.errors.length } })], null);
  return report;
}

/** Returns lower(name) → id for the given category names, creating missing ones in one batch. */
async function ensureCategories(ctx: ServiceContext, names: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const stmts: Stmt[] = [];
  for (const name of new Set(names.map((n) => n.trim()).filter(Boolean))) {
    const key = name.toLowerCase();
    if (out.has(key)) continue;
    const cat = await resolveCategory(ctx, null, name);
    if (cat.stmt) stmts.push(cat.stmt);
    out.set(key, cat.id!);
  }
  if (stmts.length) await commit(ctx, stmts, null);
  return out;
}

export async function exportProductsCsv(ctx: ServiceContext): Promise<string> {
  const rows = await ctx.db
    .select({ ...listColumns })
    .from(products)
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .where(and(eq(products.businessId, ctx.businessId), eq(products.isActive, true)))
    .orderBy(asc(products.name));
  const aliasRows = await ctx.db.select({ productId: productAliases.productId, alias: productAliases.alias }).from(productAliases).where(eq(productAliases.businessId, ctx.businessId));
  const aliasBy = new Map<string, string[]>();
  for (const a of aliasRows) aliasBy.set(a.productId, [...(aliasBy.get(a.productId) ?? []), a.alias]);
  return toCsv(
    [...PRODUCT_CSV_HEADER.filter((h) => h !== "opening_stock"), "current_stock"],
    rows.map((r) => [
      r.name,
      r.sku,
      r.barcode,
      r.categoryName,
      r.brand,
      r.unit,
      paiseToRupeeString(r.purchasePricePaise),
      paiseToRupeeString(r.sellingPricePaise),
      r.mrpPaise == null ? "" : paiseToRupeeString(r.mrpPaise),
      r.gstRateBp / 100,
      r.hsnCode,
      fromMilli(r.lowStockThresholdMilli),
      (aliasBy.get(r.id) ?? []).join("|"),
      fromMilli(r.currentStockMilli),
    ]),
  );
}

/** Onboarding: adds a starter catalogue for the business type (skips names that exist). */
export async function addSampleProducts(ctx: ServiceContext) {
  requirePermission(ctx, "inventory.create");
  const biz = await ctx.db.select({ type: businesses.type }).from(businesses).where(eq(businesses.id, ctx.businessId)).get();
  if (!biz) throw notFound("Business");
  const existing = new Set((await ctx.db.select({ name: products.name }).from(products).where(eq(products.businessId, ctx.businessId))).map((p) => normalizeText(p.name)));
  const defaults = { lowStockMilli: await lowStockDefault(ctx) };
  const samples = samplesFor(biz.type).filter((s) => !existing.has(normalizeText(s.name)));
  const catIds = await ensureCategories(ctx, samples.map((s) => s.category));
  const stmts: Stmt[] = [];
  const ids: string[] = [];
  for (const s of samples) {
    const plan = await planCreate(
      ctx,
      createSchema.parse({ ...s, categoryId: catIds.get(s.category.toLowerCase()) ?? null, trackStock: s.trackStock ?? true, units: s.units ?? [] }),
      defaults,
    );
    stmts.push(...plan.stmts);
    ids.push(plan.id);
  }
  if (stmts.length) await commit(ctx, stmts, null);
  await refreshStockAlerts(ctx, ids);
  return { created: ids.length };
}

export async function setProductImage(ctx: ServiceContext, id: string, imageKey: string) {
  requirePermission(ctx, "inventory.create");
  const p = await getProductRow(ctx, id);
  await commit(
    ctx,
    [
      ctx.db.update(products).set({ imageKey, updatedAt: ctx.now }).where(and(eq(products.id, id), eq(products.businessId, ctx.businessId))),
      auditStmt(ctx, { action: "PRODUCT_IMAGE_UPDATED", entityType: "product", entityId: id, summary: `Updated photo of ${p.name}`, before: { imageKey: p.imageKey }, after: { imageKey } }),
    ],
    null,
  );
}
