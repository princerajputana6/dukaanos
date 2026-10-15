import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { call, createProduct, key, signupOwner, stockOf } from "./helpers";

async function setup() {
  const owner = await signupOwner({ businessName: "Gupta Traders" });
  const sup = await call("POST", "/suppliers", { cookie: owner.cookie, body: { name: "ABC Distributors" } });
  const coke = await createProduct(owner.cookie, { name: "Coke 500ml", sellingPricePaise: 4000, purchasePricePaise: 3300, gstRateBp: 1800, openingStockMilli: 10000 });
  const chips = await createProduct(owner.cookie, { name: "Lays", sellingPricePaise: 2000, purchasePricePaise: 1500, gstRateBp: 1800, openingStockMilli: 5000 });
  return { ...owner, supplierId: sup.body.data.id as string, coke, chips };
}

describe("purchase orders (PO → approve → GRN)", () => {
  it("runs the full lifecycle; stock and payable change only on receipt", async () => {
    const { cookie, businessId, supplierId, coke, chips } = await setup();

    // Draft PO — no stock change.
    const po = await call("POST", "/purchase-orders", {
      cookie,
      body: { supplierId, note: "Weekly order", lines: [{ productId: coke, orderedMilli: 48000, unitCostPaise: 3300 }, { productId: chips, orderedMilli: 24000, unitCostPaise: 1500 }] },
    });
    expect(po.status).toBe(201);
    const id = po.body.data.id;
    expect(po.body.data.poNumber).toMatch(/^PO-\d{4}$/);
    expect(await stockOf(cookie, coke)).toBe(10000); // unchanged
    const payableBefore = await env.DB.prepare("SELECT balance_paise AS b FROM suppliers WHERE id = ?").bind(supplierId).first<{ b: number }>();
    expect(payableBefore?.b ?? 0).toBe(0);

    // Can't receive before approval.
    const early = await call("POST", `/purchase-orders/${id}/receive`, { cookie, idempotencyKey: key(), body: { lines: [{ productId: coke, receivedMilli: 48000 }] } });
    expect(early.status).toBe(409);

    await call("POST", `/purchase-orders/${id}/submit`, { cookie });
    const approve = await call("POST", `/purchase-orders/${id}/approve`, { cookie });
    expect(approve.body.data.status).toBe("APPROVED");

    // Partial receipt: 24 of 48 Coke, 0 Lays → PARTIALLY_RECEIVED.
    const r1 = await call("POST", `/purchase-orders/${id}/receive`, { cookie, idempotencyKey: key(), body: { billNumber: "BILL-1", lines: [{ productId: coke, receivedMilli: 24000 }, { productId: chips, receivedMilli: 0 }] } });
    expect(r1.status).toBe(201);
    expect(r1.body.data.status).toBe("PARTIALLY_RECEIVED");
    expect(await stockOf(cookie, coke)).toBe(34000); // 10 + 24

    // Supplier now has a payable (credit purchase).
    const payableAfter = await env.DB.prepare("SELECT balance_paise AS b FROM suppliers WHERE id = ?").bind(supplierId).first<{ b: number }>();
    expect(payableAfter!.b).toBeGreaterThan(0);

    // Can't receive more than remaining (24 left on Coke).
    const over = await call("POST", `/purchase-orders/${id}/receive`, { cookie, idempotencyKey: key(), body: { lines: [{ productId: coke, receivedMilli: 30000 }] } });
    expect(over.status).toBe(400);

    // Receive the rest → RECEIVED.
    const r2 = await call("POST", `/purchase-orders/${id}/receive`, { cookie, idempotencyKey: key(), body: { lines: [{ productId: coke, receivedMilli: 24000 }, { productId: chips, receivedMilli: 24000 }] } });
    expect(r2.body.data.status).toBe("RECEIVED");
    expect(await stockOf(cookie, coke)).toBe(58000); // 34 + 24
    expect(await stockOf(cookie, chips)).toBe(29000); // 5 + 24

    const detail = await call("GET", `/purchase-orders/${id}`, { cookie });
    expect(detail.body.data.po.status).toBe("RECEIVED");
    expect(detail.body.data.lines.find((l: { productName: string }) => l.productName === "Coke 500ml").receivedMilli).toBe(48000);

    // Two linked purchases exist for this PO.
    const linked = await env.DB.prepare("SELECT COUNT(*) AS n FROM purchases WHERE purchase_order_id = ? AND business_id = ?").bind(id, businessId).first<{ n: number }>();
    expect(linked!.n).toBe(2);
  });

  it("is idempotent: replaying a receive posts stock once", async () => {
    const { cookie, supplierId, coke } = await setup();
    const po = await call("POST", "/purchase-orders", { cookie, body: { supplierId, lines: [{ productId: coke, orderedMilli: 10000, unitCostPaise: 3300 }] } });
    const id = po.body.data.id;
    await call("POST", `/purchase-orders/${id}/submit`, { cookie });
    await call("POST", `/purchase-orders/${id}/approve`, { cookie });
    const idk = key();
    const body = { cookie, idempotencyKey: idk, body: { lines: [{ productId: coke, receivedMilli: 10000 }] } };
    const first = await call("POST", `/purchase-orders/${id}/receive`, body);
    const second = await call("POST", `/purchase-orders/${id}/receive`, body);
    expect(first.body.data.purchaseId).toBe(second.body.data.purchaseId);
    expect(await stockOf(cookie, coke)).toBe(20000); // 10 opening + 10 received, once
  });

  it("only an owner/admin can approve; staff without the permission cannot", async () => {
    const { cookie, userId, supplierId, coke, businessId } = await setup();
    const po = await call("POST", "/purchase-orders", { cookie, body: { supplierId, lines: [{ productId: coke, orderedMilli: 10000, unitCostPaise: 3300 }] } });
    const id = po.body.data.id;
    await call("POST", `/purchase-orders/${id}/submit`, { cookie });
    // Demote the owner to the global staff role (no settings.manage) to prove approval is permission-gated.
    await env.DB.prepare("UPDATE business_members SET role_id = 'role_staff' WHERE business_id = ? AND user_id = ?").bind(businessId, userId).run();
    const denied = await call("POST", `/purchase-orders/${id}/approve`, { cookie });
    expect(denied.status).toBe(403);
  });
});
