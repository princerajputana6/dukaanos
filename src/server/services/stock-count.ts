/**
 * Physical stock counts and branch-to-branch transfers. Both reuse the inventory movement
 * ledger, so every stock change still goes through an auditable before/after movement row.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { todayIst } from "@/lib/dates";
import { newId } from "@/lib/ids";
import { normalizeText } from "@/lib/text";
import type { stockCountSchema, transferStockSchema } from "@/schemas/inventory";
import { businesses, products, stockCountLines, stockCounts, users } from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { requirePermission, type ServiceContext } from "./context";
import { auditStmt, checkIdempotency, commit, eventStmt, type Stmt } from "./engine";
import { assertStockAvailable, movementStmts, refreshStockAlerts } from "./inventory";

type CountInput = z.output<typeof stockCountSchema>;

export interface StockCountResult {
  countId: string;
  linesCount: number;
  diffCount: number;
  netDeltaMilli: number;
  lines: { productId: string; productName: string; unit: string; expectedMilli: number; countedMilli: number; diffMilli: number }[];
}

/** Applies a physical count: sets each listed product's stock to the counted value, atomically. */
export async function createStockCount(ctx: ServiceContext, input: CountInput, idempotencyKey?: string | null): Promise<StockCountResult> {
  requirePermission(ctx, "inventory.adjust");
  const idem = await checkIdempotency<StockCountResult>(ctx, idempotencyKey, { op: "stockCount", input });
  if ("replay" in idem) return idem.replay;

  const counted = new Map(input.lines.map((l) => [l.productId, l.countedMilli])); // last wins on duplicates
  const ids = [...counted.keys()];
  const rows = await ctx.db.select().from(products).where(and(eq(products.businessId, ctx.businessId), inArray(products.id, ids)));
  if (rows.length !== ids.length) throw new AppError("PRODUCT_NOT_FOUND", "Some products in the count were not found.");

  const countId = newId(ctx.now);
  const date = todayIst(ctx.now);
  const lines = rows.map((p) => {
    const c = counted.get(p.id)!;
    return { product: p, expected: p.currentStockMilli, counted: c, diff: c - p.currentStockMilli };
  });
  const changed = lines.filter((l) => l.diff !== 0);
  const net = changed.reduce((a, l) => a + l.diff, 0);

  const result: StockCountResult = {
    countId,
    linesCount: lines.length,
    diffCount: changed.length,
    netDeltaMilli: net,
    lines: lines.map((l) => ({ productId: l.product.id, productName: l.product.name, unit: l.product.unit, expectedMilli: l.expected, countedMilli: l.counted, diffMilli: l.diff })),
  };

  const stmts: Stmt[] = [
    ctx.db.insert(stockCounts).values({ id: countId, businessId: ctx.businessId, status: "COMPLETED", note: input.note ?? null, linesCount: lines.length, diffCount: changed.length, netDeltaMilli: net, createdBy: ctx.userId, createdAt: ctx.now }),
    ...lines.map((l) => ctx.db.insert(stockCountLines).values({ id: newId(ctx.now), stockCountId: countId, businessId: ctx.businessId, productId: l.product.id, expectedMilli: l.expected, countedMilli: l.counted, diffMilli: l.diff, createdAt: ctx.now })),
    ...changed.flatMap((l) => movementStmts(ctx, { productId: l.product.id, deltaMilli: l.diff, type: "COUNT", referenceType: "stock_count", referenceId: countId, reason: "Physical count", txnDate: date })),
    auditStmt(ctx, {
      action: "STOCK_COUNTED",
      entityType: "stock_count",
      entityId: countId,
      summary: `Stock count: ${lines.length} item${lines.length === 1 ? "" : "s"}, ${changed.length} changed${input.note ? ` (${input.note})` : ""}`,
      before: null,
      after: { linesCount: lines.length, diffCount: changed.length, netDeltaMilli: net },
    }),
    eventStmt(ctx, "stock_counted", { linesCount: lines.length, diffCount: changed.length }),
  ];
  const out = await commit(ctx, stmts, result, idem.ticket);
  await refreshStockAlerts(ctx, changed.map((l) => l.product.id));
  return out;
}

export async function listStockCounts(ctx: ServiceContext, limit = 30) {
  return ctx.db
    .select({ id: stockCounts.id, note: stockCounts.note, linesCount: stockCounts.linesCount, diffCount: stockCounts.diffCount, netDeltaMilli: stockCounts.netDeltaMilli, createdAt: stockCounts.createdAt, by: users.name })
    .from(stockCounts)
    .leftJoin(users, eq(users.id, stockCounts.createdBy))
    .where(eq(stockCounts.businessId, ctx.businessId))
    .orderBy(desc(stockCounts.createdAt))
    .limit(Math.min(100, limit));
}

export async function getStockCount(ctx: ServiceContext, id: string) {
  const count = await ctx.db.select().from(stockCounts).where(and(eq(stockCounts.id, id), eq(stockCounts.businessId, ctx.businessId))).get();
  if (!count) throw notFound("Stock count");
  const lines = await ctx.db
    .select({ productId: stockCountLines.productId, productName: products.name, unit: products.unit, expectedMilli: stockCountLines.expectedMilli, countedMilli: stockCountLines.countedMilli, diffMilli: stockCountLines.diffMilli })
    .from(stockCountLines)
    .leftJoin(products, eq(products.id, stockCountLines.productId))
    .where(eq(stockCountLines.stockCountId, id));
  return { count, lines };
}

// ─── Branch-to-branch transfer ───────────────────────────────────────────────

type TransferInput = z.output<typeof transferStockSchema>;

export interface TransferResult {
  transferId: string;
  toBusinessId: string;
  toBranchName: string;
  lines: { productId: string; productName: string; unit: string; quantityMilli: number; toProductId: string }[];
}

/**
 * Moves stock from the current branch to a sibling branch (same tenant) the user belongs to.
 * Writes TRANSFER_OUT in the source and TRANSFER_IN in the target in one atomic batch. Products
 * are matched by normalised name; unmatched products are reported, never invented.
 */
export async function transferStock(ctx: ServiceContext, input: TransferInput, idempotencyKey?: string | null): Promise<TransferResult> {
  requirePermission(ctx, "inventory.adjust");
  if (input.toBusinessId === ctx.businessId) throw new AppError("VALIDATION_ERROR", "Choose a different branch to transfer to.");
  const idem = await checkIdempotency<TransferResult>(ctx, idempotencyKey, { op: "transferStock", input });
  if ("replay" in idem) return idem.replay;

  // Target must be a sibling branch (same tenant), active, and one the user is a member of.
  const here = await ctx.db.select({ tenantId: businesses.tenantId }).from(businesses).where(eq(businesses.id, ctx.businessId)).get();
  const target = await ctx.db
    .select({ id: businesses.id, name: businesses.name, tenantId: businesses.tenantId, status: businesses.status })
    .from(businesses)
    .where(eq(businesses.id, input.toBusinessId))
    .get();
  if (!target || !here?.tenantId || target.tenantId !== here.tenantId || target.status === "ARCHIVED") throw notFound("Branch");
  const member = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(sql`business_members`)
    .where(sql`business_id = ${target.id} AND user_id = ${ctx.userId} AND is_active = 1`)
    .get();
  if (!Number(member?.n ?? 0)) throw new AppError("FORBIDDEN", "You don't have access to that branch.");

  const qtyById = new Map(input.lines.map((l) => [l.productId, l.quantityMilli])); // last wins
  const ids = [...qtyById.keys()];
  const src = await ctx.db.select().from(products).where(and(eq(products.businessId, ctx.businessId), inArray(products.id, ids)));
  if (src.length !== ids.length) throw new AppError("PRODUCT_NOT_FOUND", "Some products were not found in this branch.");

  // Match each source product to one in the target branch by normalised name.
  const targetProducts = await ctx.db.select({ id: products.id, name: products.name }).from(products).where(and(eq(products.businessId, target.id), eq(products.isActive, true)));
  const targetByName = new Map(targetProducts.map((p) => [normalizeText(p.name), p.id]));

  const settings = await ctx.db.query.businessSettings.findFirst({ where: (s, { eq: e }) => e(s.businessId, ctx.businessId) });
  const transferId = newId(ctx.now);
  const date = todayIst(ctx.now);
  const targetCtx: ServiceContext = { ...ctx, businessId: target.id };
  const stmts: Stmt[] = [];
  const unmatched: string[] = [];
  const resultLines: TransferResult["lines"] = [];

  for (const p of src) {
    const qty = qtyById.get(p.id)!;
    const toId = targetByName.get(normalizeText(p.name));
    if (!toId) {
      unmatched.push(p.name);
      continue;
    }
    assertStockAvailable(p, qty, settings?.allowNegativeStock ?? false);
    stmts.push(...movementStmts(ctx, { productId: p.id, deltaMilli: -qty, type: "TRANSFER_OUT", referenceType: "transfer", referenceId: transferId, reason: `To ${target.name}`, txnDate: date }));
    stmts.push(...movementStmts(targetCtx, { productId: toId, deltaMilli: qty, type: "TRANSFER_IN", referenceType: "transfer", referenceId: transferId, reason: `From ${ctx.userName}`, txnDate: date }));
    resultLines.push({ productId: p.id, productName: p.name, unit: p.unit, quantityMilli: qty, toProductId: toId });
  }
  if (unmatched.length) throw new AppError("PRODUCT_NOT_FOUND", `Not in ${target.name}: ${unmatched.join(", ")}. Add them there first (copy catalogue).`);

  const result: TransferResult = { transferId, toBusinessId: target.id, toBranchName: target.name, lines: resultLines };
  stmts.push(
    auditStmt(ctx, { action: "STOCK_TRANSFERRED", entityType: "transfer", entityId: transferId, summary: `Transferred ${resultLines.length} item${resultLines.length === 1 ? "" : "s"} to ${target.name}`, before: null, after: { toBusinessId: target.id, lines: resultLines.length } }),
    eventStmt(ctx, "stock_transferred", { toBusinessId: target.id, lines: resultLines.length }),
  );
  const out = await commit(ctx, stmts, result, idem.ticket);
  await refreshStockAlerts(ctx, src.map((p) => p.id));
  return out;
}
