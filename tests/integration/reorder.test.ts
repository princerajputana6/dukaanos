import { describe, expect, it } from "vitest";
import { call, createProduct, key, signupOwner } from "./helpers";

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** Sell `units` of a product on a given past date (same stock engine as the POS). */
async function sellOn(cookie: string, productId: string, qtyMilli: number, date: string) {
  const r = await call("POST", "/sales", { cookie, idempotencyKey: key(), body: { items: [{ productId, quantityMilli: qtyMilli }], payment: { method: "CASH" }, txnDate: date } });
  if (r.status !== 201) throw new Error(`sell failed: ${JSON.stringify(r.body)}`);
}

describe("reorder suggestions", () => {
  it("suggests a quantity from demand, subtracting stock already on the way", async () => {
    const { cookie, businessId } = await signupOwner();
    const coke = await createProduct(cookie, { name: "Coke 500ml", sellingPricePaise: 4000, purchasePricePaise: 3000, openingStockMilli: 200000 });

    // Sell 60 units on each of three distinct recent days → avg demand 6 units/day over 30 days.
    await sellOn(cookie, coke, 60000, isoDaysAgo(0));
    await sellOn(cookie, coke, 60000, isoDaysAgo(1));
    await sellOn(cookie, coke, 60000, isoDaysAgo(2));
    // Stock now 200 − 180 = 20 units.

    const r = await call("GET", "/inventory/reorder", { cookie });
    expect(r.status).toBe(200);
    expect(r.body.data.meta).toMatchObject({ windowDays: 30, leadTimeDays: 3, safetyDays: 4 });
    const s = r.body.data.items.find((x: { productId: string }) => x.productId === coke);
    expect(s).toBeTruthy();
    expect(s.method).toBe("demand");
    expect(s.avgDailyMilli).toBe(6000); // 180000 / 30
    expect(s.suggestedMilli).toBe(22000); // target 7d*6 = 42 − 20 available
    expect(s.currentStockMilli).toBe(20000);

    // An approved PO for 50 units on the way should remove the need.
    const sup = await call("POST", "/suppliers", { cookie, body: { name: "ABC" } });
    const po = await call("POST", "/purchase-orders", { cookie, body: { supplierId: sup.body.data.id, lines: [{ productId: coke, orderedMilli: 50000, unitCostPaise: 3000 }] } });
    await call("POST", `/purchase-orders/${po.body.data.id}/submit`, { cookie });
    await call("POST", `/purchase-orders/${po.body.data.id}/approve`, { cookie });

    const r2 = await call("GET", "/inventory/reorder", { cookie });
    const s2 = r2.body.data.items.find((x: { productId: string }) => x.productId === coke);
    // available now 20 + 50 = 70 > 42 target → no longer suggested.
    expect(s2).toBeFalsy();
    void businessId;
  });

  it("falls back to the alert level (and says so) when there is too little sales history", async () => {
    const { cookie } = await signupOwner();
    const salt = await createProduct(cookie, { name: "Tata Salt 1kg", sellingPricePaise: 2800, purchasePricePaise: 2200, openingStockMilli: 3000, lowStockThresholdMilli: 10000 });
    // Stock 3 ≤ threshold 10, no sales → threshold-based suggestion.
    const r = await call("GET", "/inventory/reorder", { cookie });
    const s = r.body.data.items.find((x: { productId: string }) => x.productId === salt);
    expect(s).toBeTruthy();
    expect(s.method).toBe("threshold");
    expect(s.avgDailyMilli).toBe(0);
    expect(s.suggestedMilli).toBe(17000); // 2*threshold(20) − available(3) = 17
  });

  it("does not suggest anything for a well-stocked shop with no demand", async () => {
    const { cookie } = await signupOwner();
    await createProduct(cookie, { name: "Parle-G", sellingPricePaise: 1000, purchasePricePaise: 700, openingStockMilli: 100000, lowStockThresholdMilli: 5000 });
    const r = await call("GET", "/inventory/reorder", { cookie });
    expect(r.body.data.items).toHaveLength(0);
  });
});
