/**
 * Purchase orders: Draft → Submitted → Approved → Partially Received → Received | Cancelled.
 *
 * A PO only plans a purchase — no stock or payable changes until goods are received. Receiving
 * creates a linked purchase through `createPurchase` (which keeps all cost/tax/ledger logic in
 * one place and posts stock + payable atomically); the authoritative received quantity is the
 * sum of linked purchase items, so a retried receive never double-counts.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { todayIst } from "@/lib/dates";
import { newId } from "@/lib/ids";
import type { createPurchaseSchema } from "@/schemas/sales";
import type { createPurchaseOrderSchema, receivePurchaseOrderSchema } from "@/schemas/purchase-order";
import { products, purchaseItems, purchaseOrderLines, purchaseOrders, purchases, suppliers, users } from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { can, requirePermission, type ServiceContext } from "./context";
import { auditStmt, checkIdempotency, commit, eventStmt, reserveNumber, withNumberRetry, type Stmt } from "./engine";
import { createPurchase } from "./purchases";

type CreateInput = z.output<typeof createPurchaseOrderSchema>;
type ReceiveInput = z.output<typeof receivePurchaseOrderSchema>;

const CAN_APPROVE = "settings.manage" as const; // owners/admins approve; managers draft & submit

export async function createPurchaseOrder(ctx: ServiceContext, input: CreateInput) {
  requirePermission(ctx, "purchase.create");
  const supplier = await ctx.db.select().from(suppliers).where(and(eq(suppliers.id, input.supplierId), eq(suppliers.businessId, ctx.businessId))).get();
  if (!supplier) throw new AppError("SUPPLIER_NOT_FOUND", "Supplier not found.");
  const ids = [...new Set(input.lines.map((l) => l.productId))];
  const prods = await ctx.db.select().from(products).where(and(eq(products.businessId, ctx.businessId), inArray(products.id, ids)));
  const byId = new Map(prods.map((p) => [p.id, p]));
  for (const id of ids) if (!byId.has(id)) throw new AppError("PRODUCT_NOT_FOUND", "One of the products was not found.");

  return withNumberRetry(async () => {
    const { number, stmt: counterStmt } = await reserveNumber(ctx, "purchase_order", "PO");
    const poId = newId(ctx.now);
    const subtotal = input.lines.reduce((a, l) => a + Math.round((l.unitCostPaise * l.orderedMilli) / 1000), 0);
    const stmts: Stmt[] = [
      counterStmt,
      ctx.db.insert(purchaseOrders).values({
        id: poId,
        businessId: ctx.businessId,
        poNumber: number,
        supplierId: supplier.id,
        status: "DRAFT",
        note: input.note ?? null,
        expectedDate: input.expectedDate ?? null,
        subtotalPaise: subtotal,
        itemCount: input.lines.length,
        createdBy: ctx.userId,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      }),
      ...input.lines.map((l) => {
        const p = byId.get(l.productId)!;
        return ctx.db.insert(purchaseOrderLines).values({
          id: newId(ctx.now),
          purchaseOrderId: poId,
          businessId: ctx.businessId,
          productId: p.id,
          productName: p.name,
          unit: p.unit,
          orderedMilli: l.orderedMilli,
          receivedMilli: 0,
          unitCostPaise: l.unitCostPaise,
          gstRateBp: l.gstRateBp ?? p.gstRateBp,
          createdAt: ctx.now,
        });
      }),
      auditStmt(ctx, { action: "PO_CREATED", entityType: "purchase_order", entityId: poId, summary: `Created ${number} for ${supplier.name} (${input.lines.length} items)`, after: { supplierId: supplier.id, lines: input.lines.length } }),
      eventStmt(ctx, "po_created", { lines: input.lines.length }),
    ];
    await commit(ctx, stmts, null);
    return { id: poId, poNumber: number };
  });
}

/** Loads a PO with its lines and live received quantities (sum of linked purchases). */
export async function getPurchaseOrder(ctx: ServiceContext, id: string) {
  const po = await ctx.db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.poNumber,
      supplierId: purchaseOrders.supplierId,
      supplierName: suppliers.name,
      status: purchaseOrders.status,
      note: purchaseOrders.note,
      expectedDate: purchaseOrders.expectedDate,
      subtotalPaise: purchaseOrders.subtotalPaise,
      createdAt: purchaseOrders.createdAt,
      createdBy: users.name,
    })
    .from(purchaseOrders)
    .leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .leftJoin(users, eq(users.id, purchaseOrders.createdBy))
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.businessId, ctx.businessId)))
    .get();
  if (!po) throw notFound("Purchase order");
  const lines = await ctx.db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));
  return { po, lines };
}

export async function listPurchaseOrders(ctx: ServiceContext, status?: string) {
  const conds = [eq(purchaseOrders.businessId, ctx.businessId)];
  if (status) conds.push(eq(purchaseOrders.status, status));
  return ctx.db
    .select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber, supplierName: suppliers.name, status: purchaseOrders.status, itemCount: purchaseOrders.itemCount, subtotalPaise: purchaseOrders.subtotalPaise, createdAt: purchaseOrders.createdAt })
    .from(purchaseOrders)
    .leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(...conds))
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(50);
}

async function loadPO(ctx: ServiceContext, id: string) {
  const po = await ctx.db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.businessId, ctx.businessId))).get();
  if (!po) throw notFound("Purchase order");
  return po;
}

async function setStatus(ctx: ServiceContext, id: string, from: string[], to: string, action: string, extra: Record<string, unknown> = {}) {
  const po = await loadPO(ctx, id);
  if (!from.includes(po.status)) throw new AppError("INVALID_STATE", `This purchase order is ${po.status.toLowerCase()} and can't be ${to.toLowerCase().replace("_", " ")}.`);
  await commit(ctx, [
    ctx.db.update(purchaseOrders).set({ status: to, updatedAt: ctx.now, ...extra }).where(eq(purchaseOrders.id, id)),
    auditStmt(ctx, { action, entityType: "purchase_order", entityId: id, summary: `${po.poNumber}: ${po.status} → ${to}`, before: { status: po.status }, after: { status: to } }),
  ], null);
  return { id, status: to };
}

export const submitPurchaseOrder = (ctx: ServiceContext, id: string) => setStatus(ctx, id, ["DRAFT"], "SUBMITTED", "PO_SUBMITTED");
export const cancelPurchaseOrder = (ctx: ServiceContext, id: string) => setStatus(ctx, id, ["DRAFT", "SUBMITTED", "APPROVED"], "CANCELLED", "PO_CANCELLED");

export async function approvePurchaseOrder(ctx: ServiceContext, id: string) {
  if (!can(ctx, CAN_APPROVE)) throw new AppError("FORBIDDEN", "Only an owner or admin can approve purchase orders.");
  return setStatus(ctx, id, ["SUBMITTED"], "APPROVED", "PO_APPROVED", { approvedBy: ctx.userId });
}

export interface ReceiveResult {
  purchaseId: string;
  purchaseNumber: string;
  status: string;
  receivedLines: number;
}

/** Receives goods against a PO: creates a linked credit purchase, updates received qty + status. */
export async function receivePurchaseOrder(ctx: ServiceContext, id: string, input: ReceiveInput, idempotencyKey?: string | null): Promise<ReceiveResult> {
  requirePermission(ctx, "purchase.create");
  const idem = await checkIdempotency<ReceiveResult>(ctx, idempotencyKey, { op: "receivePO", id, input });
  if ("replay" in idem) return idem.replay;
  const po = await loadPO(ctx, id);
  if (!["APPROVED", "PARTIALLY_RECEIVED"].includes(po.status)) throw new AppError("INVALID_STATE", "Only an approved purchase order can receive goods.");
  const lines = await ctx.db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));
  const lineByProduct = new Map(lines.map((l) => [l.productId, l]));

  // Already-received per product = sum of linked purchase items (authoritative, retry-safe).
  const received = await ctx.db
    .select({ productId: purchaseItems.productId, qty: sql<number>`coalesce(sum(${purchaseItems.quantityMilli}), 0)` })
    .from(purchaseItems)
    .innerJoin(purchases, eq(purchases.id, purchaseItems.purchaseId))
    .where(and(eq(purchases.businessId, ctx.businessId), eq(purchases.purchaseOrderId, id)))
    .groupBy(purchaseItems.productId);
  const receivedByProduct = new Map(received.map((r) => [r.productId, Number(r.qty)]));

  const toReceive = input.lines.filter((l) => l.receivedMilli > 0);
  if (toReceive.length === 0) throw new AppError("VALIDATION_ERROR", "Enter a quantity to receive.");
  for (const l of toReceive) {
    const pol = lineByProduct.get(l.productId);
    if (!pol) throw new AppError("VALIDATION_ERROR", "That product is not on this purchase order.");
    const remaining = pol.orderedMilli - (receivedByProduct.get(l.productId) ?? 0);
    if (l.receivedMilli > remaining) throw new AppError("VALIDATION_ERROR", `Can't receive more than the ${remaining <= 0 ? "zero" : "remaining"} quantity for ${pol.productName}.`);
  }

  // Post the receipt as a linked, unpaid (credit) purchase — keeps cost/tax/ledger in one place.
  const purchase = await createPurchase(
    ctx,
    {
      supplierId: po.supplierId,
      billNumber: input.billNumber ?? null,
      items: toReceive.map((l) => {
        const pol = lineByProduct.get(l.productId)!;
        return { productId: l.productId, quantityMilli: l.receivedMilli, unitCostPaise: pol.unitCostPaise, discountPaise: 0, gstRateBp: pol.gstRateBp };
      }),
      billDiscountPaise: 0,
      pricesIncludeGst: false,
      payment: { status: "UNPAID", method: "CASH" },
      txnDate: todayIst(ctx.now),
      notes: input.note ?? `Received against ${po.poNumber}`,
    } as z.output<typeof createPurchaseSchema>,
    idempotencyKey ? `${idempotencyKey}:g` : null,
  );

  // Link the purchase, update received snapshots + PO status in one commit.
  const newReceived = new Map(receivedByProduct);
  for (const l of toReceive) newReceived.set(l.productId, (newReceived.get(l.productId) ?? 0) + l.receivedMilli);
  const allReceived = lines.every((pol) => (newReceived.get(pol.productId) ?? 0) >= pol.orderedMilli);
  const status = allReceived ? "RECEIVED" : "PARTIALLY_RECEIVED";
  const result: ReceiveResult = { purchaseId: purchase.id, purchaseNumber: purchase.purchaseNumber, status, receivedLines: toReceive.length };
  const stmts: Stmt[] = [
    ctx.db.update(purchases).set({ purchaseOrderId: id }).where(and(eq(purchases.id, purchase.id), eq(purchases.businessId, ctx.businessId))),
    ...lines.map((pol) => ctx.db.update(purchaseOrderLines).set({ receivedMilli: newReceived.get(pol.productId) ?? 0 }).where(eq(purchaseOrderLines.id, pol.id))),
    ctx.db.update(purchaseOrders).set({ status, updatedAt: ctx.now }).where(eq(purchaseOrders.id, id)),
    auditStmt(ctx, { action: "PO_RECEIVED", entityType: "purchase_order", entityId: id, summary: `${po.poNumber}: received ${toReceive.length} line(s) → ${status}`, before: { status: po.status }, after: { status, purchaseId: purchase.id } }),
  ];
  await commit(ctx, stmts, result, idem.ticket);
  return result;
}
