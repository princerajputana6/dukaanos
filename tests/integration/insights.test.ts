import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { call, createProduct, key, signupOwner } from "./helpers";

const ids = (body: { data: { id: string }[] }) => body.data.map((i) => i.id);

describe("business insights (grounded, rule-based)", () => {
  it("flags a below-cost product that is selling, and a best-seller that is out of stock", async () => {
    const { cookie } = await signupOwner();
    const loss = await createProduct(cookie, { name: "Loss Leader", sellingPricePaise: 1000, purchasePricePaise: 1500, openingStockMilli: 20000 });
    const star = await createProduct(cookie, { name: "Star Product", sellingPricePaise: 4000, purchasePricePaise: 3000, openingStockMilli: 10000 });

    await call("POST", "/sales", { cookie, idempotencyKey: key(), body: { items: [{ productId: loss, quantityMilli: 2000 }], payment: { method: "CASH" } } });
    await call("POST", "/sales", { cookie, idempotencyKey: key(), body: { items: [{ productId: star, quantityMilli: 4000 }], payment: { method: "CASH" } } });
    // Sell the rest of the star product so it's out of stock.
    await call("POST", "/sales", { cookie, idempotencyKey: key(), body: { items: [{ productId: star, quantityMilli: 6000 }], payment: { method: "CASH" } } });

    const r = await call("GET", "/reports/insights", { cookie });
    expect(r.status).toBe(200);
    const cardIds = ids(r.body);
    expect(cardIds).toContain(`margin:${loss}`);
    expect(cardIds).toContain(`oos:${star}`);

    // The out-of-stock card is an alert and carries its evidence.
    const oos = r.body.data.find((i: { id: string }) => i.id === `oos:${star}`);
    expect(oos).toMatchObject({ severity: "alert", kind: "out_of_stock_seller" });
    expect(oos.evidence).toMatch(/sold/i);
  });

  it("surfaces overdue receivables older than 30 days", async () => {
    const { cookie, businessId } = await signupOwner();
    const cust = await call("POST", "/customers", { cookie, body: { name: "Slow Payer" } });
    const custId = cust.body.data.id;
    // Give them udhaar, then backdate their last activity beyond 30 days.
    await call("POST", `/customers/${custId}/credit`, { cookie, idempotencyKey: key(), body: { amountPaise: 50000, note: "old udhaar" } });
    await env.DB.prepare("UPDATE customers SET last_txn_at = ? WHERE id = ? AND business_id = ?").bind(Date.now() - 45 * 86_400_000, custId, businessId).run();

    const r = await call("GET", "/reports/insights", { cookie });
    const overdue = r.body.data.find((i: { id: string }) => i.id === "overdue_receivables");
    expect(overdue).toBeTruthy();
    expect(overdue.evidence).toMatch(/30 days/);
  });

  it("is a healthy, empty board for a shop with no issues, and is gated to reports.view", async () => {
    const { cookie, userId, businessId } = await signupOwner();
    const healthy = await createProduct(cookie, { name: "Healthy", sellingPricePaise: 4000, purchasePricePaise: 3000, openingStockMilli: 50000 });
    await call("POST", "/sales", { cookie, idempotencyKey: key(), body: { items: [{ productId: healthy, quantityMilli: 2000 }], payment: { method: "CASH" } } }); // moving, not dead
    const clean = await call("GET", "/reports/insights", { cookie });
    expect(clean.body.data).toHaveLength(0);

    // Staff (no reports.view) can't see insights.
    await env.DB.prepare("UPDATE business_members SET role_id = 'role_staff' WHERE business_id = ? AND user_id = ?").bind(businessId, userId).run();
    const denied = await call("GET", "/reports/insights", { cookie });
    expect(denied.status).toBe(403);
  });
});
