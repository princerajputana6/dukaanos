import { describe, expect, it } from "vitest";
import { call, createProduct, key, signupOwner } from "./helpers";

describe("POS cash shifts (cashbook)", () => {
  it("opens a shift, tracks cash in/out, and closes with expected vs counted", async () => {
    const { cookie } = await signupOwner();
    const coke = await createProduct(cookie, { name: "Coke 500ml", sellingPricePaise: 4000, purchasePricePaise: 3300, openingStockMilli: 50000 });

    // No shift yet.
    expect((await call("GET", "/shifts/current", { cookie })).body.data).toBeNull();

    const open = await call("POST", "/shifts/open", { cookie, body: { openingCashPaise: 100000 } }); // ₹1,000 float
    expect(open.status).toBe(201);
    expect(open.body.data).toMatchObject({ status: "OPEN", openingCashPaise: 100000, expectedCashPaise: 100000 });

    // Can't open a second shift.
    const dup = await call("POST", "/shifts/open", { cookie, body: { openingCashPaise: 0 } });
    expect(dup.status).toBe(409);

    // A cash sale (₹80) and a cash expense (₹200) during the shift.
    await call("POST", "/sales", { cookie, idempotencyKey: key(), body: { items: [{ productId: coke, quantityMilli: 2000 }], payment: { method: "CASH" } } });
    await call("POST", "/expenses", { cookie, idempotencyKey: key(), body: { amountPaise: 20000, categoryName: "Transport", paymentMethod: "CASH" } });

    const cur = await call("GET", "/shifts/current", { cookie });
    expect(cur.body.data.cashSalesPaise).toBe(8000);
    expect(cur.body.data.cashExpensePaise).toBe(20000);
    // expected = 100000 float + 8000 sale - 20000 expense = 88000
    expect(cur.body.data.expectedCashPaise).toBe(88000);

    // Counting exactly right closes cleanly.
    const close = await call("POST", "/shifts/close", { cookie, body: { countedCashPaise: 88000 } });
    expect(close.status).toBe(200);
    expect(close.body.data).toMatchObject({ status: "CLOSED", expectedCashPaise: 88000, countedCashPaise: 88000, differencePaise: 0 });

    // Shift is gone from "current"; present in history.
    expect((await call("GET", "/shifts/current", { cookie })).body.data).toBeNull();
    const list = await call("GET", "/shifts", { cookie });
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].differencePaise).toBe(0);
  });

  it("requires a note when cash is short beyond the threshold", async () => {
    const { cookie } = await signupOwner();
    await call("POST", "/shifts/open", { cookie, body: { openingCashPaise: 100000 } });
    // Count ₹500 short (> ₹100 threshold) with no note → rejected.
    const bad = await call("POST", "/shifts/close", { cookie, body: { countedCashPaise: 50000 } });
    expect(bad.status).toBe(400);
    // With a note it closes and records the mismatch.
    const ok = await call("POST", "/shifts/close", { cookie, body: { countedCashPaise: 50000, note: "Gave change from float" } });
    expect(ok.status).toBe(200);
    expect(ok.body.data.differencePaise).toBe(-50000);
  });

  it("closing with no open shift is rejected", async () => {
    const { cookie } = await signupOwner();
    const r = await call("POST", "/shifts/close", { cookie, body: { countedCashPaise: 0 } });
    expect(r.status).toBe(409);
  });
});
