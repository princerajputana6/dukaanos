import { describe, expect, it } from "vitest";
import { call, createCustomer, createProduct, key, signupOwner, stockOf } from "./helpers";

describe("sales", () => {
  it("creates a sale: stock down, GST split, invoice numbering, payment, audit", async () => {
    const { cookie } = await signupOwner();
    const coke = await createProduct(cookie, { name: "Coke 500ml", sellingPricePaise: 4000, purchasePricePaise: 3300, gstRateBp: 1800, openingStockMilli: 34000 });
    const sprite = await createProduct(cookie, { name: "Sprite 250ml", sellingPricePaise: 2000, purchasePricePaise: 1650, gstRateBp: 1800, openingStockMilli: 20000 });
    const res = await call("POST", "/sales", {
      cookie,
      idempotencyKey: key(),
      body: { items: [{ productId: coke, quantityMilli: 20000 }, { productId: sprite, quantityMilli: 10000 }], payment: { method: "UPI" } },
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ invoiceNumber: "INV-0001", totalPaise: 100000, paidPaise: 100000, creditPaise: 0 });
    expect(await stockOf(cookie, coke)).toBe(14000);
    expect(await stockOf(cookie, sprite)).toBe(10000);

    const detail = await call("GET", `/sales/${res.body.data.id}`, { cookie });
    const sale = detail.body.data.sale;
    expect(sale.taxablePaise + sale.taxPaise).toBe(sale.totalPaise);
    expect(sale.cgstPaise + sale.sgstPaise).toBe(sale.taxPaise);
    expect(sale.costPaise).toBe(20 * 3300 + 10 * 1650);
    expect(detail.body.data.payments[0]).toMatchObject({ method: "UPI", amountPaise: 100000, direction: "IN" });

    const second = await call("POST", "/sales", { cookie, idempotencyKey: key(), body: { items: [{ productId: coke, quantityMilli: 1000 }], payment: { method: "CASH" } } });
    expect(second.body.data.invoiceNumber).toBe("INV-0002");

    const moves = await call("GET", `/inventory/movements?productId=${coke}`, { cookie });
    expect(moves.body.data.items[1]).toMatchObject({ type: "SALE", quantityMilli: -20000, beforeMilli: 34000, afterMilli: 14000, referenceType: "sale" });
    const audit = await call("GET", "/audit?entityType=sale", { cookie });
    expect(audit.body.data.items.some((a: { summary: string }) => a.summary.includes("Coke 500ml ×20"))).toBe(true);
  });

  it("blocks overselling with a clear message", async () => {
    const { cookie } = await signupOwner();
    const p = await createProduct(cookie, { name: "Pepsi", openingStockMilli: 5000, unit: "bottle" });
    const res = await call("POST", "/sales", { cookie, body: { items: [{ productId: p, quantityMilli: 6000 }], payment: { method: "CASH" } } });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "INSUFFICIENT_STOCK", message: "Only 5 bottle of Pepsi available." });
    expect(await stockOf(cookie, p)).toBe(5000);
  });

  it("aggregates quantities of the same product across lines for the stock check", async () => {
    const { cookie } = await signupOwner();
    const p = await createProduct(cookie, { openingStockMilli: 5000 });
    const res = await call("POST", "/sales", { cookie, body: { items: [{ productId: p, quantityMilli: 3000 }, { productId: p, quantityMilli: 3000 }], payment: { method: "CASH" } } });
    expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
  });

  it("credit sales require a customer and update the khata", async () => {
    const { cookie } = await signupOwner();
    const p = await createProduct(cookie, { sellingPricePaise: 5000 });
    const noCustomer = await call("POST", "/sales", { cookie, body: { items: [{ productId: p, quantityMilli: 2000 }], payment: { method: "CREDIT" } } });
    expect(noCustomer.status).toBe(400);
    const ramesh = await createCustomer(cookie, "Ramesh");
    const partial = await call("POST", "/sales", {
      cookie,
      idempotencyKey: key(),
      body: { items: [{ productId: p, quantityMilli: 3000 }], customerId: ramesh, payment: { method: "CASH", paidPaise: 5000 } },
    });
    expect(partial.body.data).toMatchObject({ totalPaise: 15000, paidPaise: 5000, creditPaise: 10000 });
    const cust = await call("GET", `/customers/${ramesh}`, { cookie });
    expect(cust.body.data.customer.balancePaise).toBe(10000);
    expect(cust.body.data.ledger[0]).toMatchObject({ type: "SALE_CREDIT", amountPaise: 10000, balanceAfterPaise: 10000 });
  });

  it("is idempotent: replays return the same sale, reused keys with different bodies are rejected", async () => {
    const { cookie } = await signupOwner();
    const p = await createProduct(cookie, { openingStockMilli: 10000 });
    const k = key();
    const body = { items: [{ productId: p, quantityMilli: 1000 }], payment: { method: "CASH" } };
    const a = await call("POST", "/sales", { cookie, idempotencyKey: k, body });
    const b = await call("POST", "/sales", { cookie, idempotencyKey: k, body });
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(await stockOf(cookie, p)).toBe(9000);
    const list = await call("GET", "/sales", { cookie });
    expect(list.body.data.items).toHaveLength(1);
    const c = await call("POST", "/sales", { cookie, idempotencyKey: k, body: { ...body, items: [{ productId: p, quantityMilli: 2000 }] } });
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("undo reverses a sale without deleting it and cannot be applied twice", async () => {
    const { cookie } = await signupOwner();
    const p = await createProduct(cookie, { openingStockMilli: 10000, sellingPricePaise: 1000 });
    const cust = await createCustomer(cookie, "Suresh");
    const sale = await call("POST", "/sales", { cookie, idempotencyKey: key(), body: { items: [{ productId: p, quantityMilli: 4000 }], customerId: cust, payment: { method: "CREDIT" } } });
    const id = sale.body.data.id;
    const rev = await call("POST", `/sales/${id}/reverse`, { cookie, body: { reason: "Wrong entry" } });
    expect(rev.status).toBe(200);
    expect(await stockOf(cookie, p)).toBe(10000);
    const c = await call("GET", `/customers/${cust}`, { cookie });
    expect(c.body.data.customer.balancePaise).toBe(0);
    const detail = await call("GET", `/sales/${id}`, { cookie });
    expect(detail.body.data.sale.status).toBe("REVERSED");
    expect(detail.body.data.sale.reversalReason).toBe("Wrong entry");
    const again = await call("POST", `/sales/${id}/reverse`, { cookie, body: {} });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_REVERSED");
    const dash = await call("GET", "/reports/dashboard", { cookie });
    expect(dash.body.data.today.salesPaise).toBe(0);
  });

  it("applies bill discounts and rejects payment above total", async () => {
    const { cookie } = await signupOwner();
    const p = await createProduct(cookie, { sellingPricePaise: 10000, gstRateBp: 0 });
    const res = await call("POST", "/sales", { cookie, idempotencyKey: key(), body: { items: [{ productId: p, quantityMilli: 2000 }], billDiscountPaise: 1500, payment: { method: "CASH" } } });
    expect(res.body.data.totalPaise).toBe(18500);
    const over = await call("POST", "/sales", { cookie, body: { items: [{ productId: p, quantityMilli: 1000 }], payment: { method: "CASH", paidPaise: 20000 } } });
    expect(over.body.error.code).toBe("INVALID_AMOUNT");
  });
});

describe("purchases", () => {
  it("adds stock, updates weighted average cost and the supplier ledger", async () => {
    const { cookie } = await signupOwner();
    const p = await createProduct(cookie, { name: "Coke 500ml", purchasePricePaise: 3000, openingStockMilli: 10000, gstRateBp: 0 });
    const sup = await call("POST", "/suppliers", { cookie, body: { name: "ABC Distributors" } });
    const supplierId = sup.body.data.id;
    const res = await call("POST", "/purchases", {
      cookie,
      idempotencyKey: key(),
      body: { supplierId, items: [{ productId: p, quantityMilli: 10000, unitCostPaise: 3600 }], payment: { status: "PARTIAL", method: "CASH", paidPaise: 16000 } },
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ purchaseNumber: "PUR-0001", totalPaise: 36000, paidPaise: 16000, creditPaise: 20000 });
    const detail = await call("GET", `/products/${p}`, { cookie });
    expect(detail.body.data.product.currentStockMilli).toBe(20000);
    expect(detail.body.data.product.avgCostPaise).toBe(3300); // (10×30 + 10×36) / 20
    expect(detail.body.data.product.purchasePricePaise).toBe(3600);
    const s = await call("GET", `/suppliers/${supplierId}`, { cookie });
    expect(s.body.data.supplier.balancePaise).toBe(20000);

    const pay = await call("POST", `/suppliers/${supplierId}/payment`, { cookie, idempotencyKey: key(), body: { amountPaise: 20000, method: "UPI" } });
    expect(pay.body.data.balanceAfterPaise).toBe(0);

    const rev = await call("POST", `/purchases/${res.body.data.id}/reverse`, { cookie, body: { reason: "Returned" } });
    expect(rev.status).toBe(200);
    expect(await stockOf(cookie, p)).toBe(10000);
    const s2 = await call("GET", `/suppliers/${supplierId}`, { cookie });
    expect(s2.body.data.supplier.balancePaise).toBe(-20000); // we paid for goods we returned: supplier owes us
  });

  it("requires a supplier for unpaid purchases", async () => {
    const { cookie } = await signupOwner();
    const p = await createProduct(cookie);
    const res = await call("POST", "/purchases", { cookie, body: { items: [{ productId: p, quantityMilli: 1000, unitCostPaise: 100 }], payment: { status: "UNPAID" } } });
    expect(res.status).toBe(400);
  });
});

describe("customer khata", () => {
  it("records udhaar, payments, adjustments and reversals with running balances", async () => {
    const { cookie } = await signupOwner();
    const id = await createCustomer(cookie, "Ramesh", { phone: "9811112222", openingBalancePaise: 20000 });
    await call("POST", `/customers/${id}/credit`, { cookie, idempotencyKey: key(), body: { amountPaise: 85000, note: "Monthly ration" } });
    const pay = await call("POST", `/customers/${id}/payment`, { cookie, idempotencyKey: key(), body: { amountPaise: 50000, method: "CASH" } });
    expect(pay.body.data.balanceAfterPaise).toBe(55000);
    const detail = await call("GET", `/customers/${id}`, { cookie });
    expect(detail.body.data.customer.balancePaise).toBe(55000);
    expect(detail.body.data.ledger.map((l: { type: string; balanceAfterPaise: number }) => [l.type, l.balanceAfterPaise])).toEqual([
      ["PAYMENT", 55000],
      ["CREDIT", 105000],
      ["ADJUSTMENT", 20000],
    ]);
    const paymentEntry = detail.body.data.ledger[0].id;
    const rev = await call("POST", `/customers/${id}/entries/${paymentEntry}/reverse`, { cookie, body: { reason: "Cheque bounced" } });
    expect(rev.body.data.balanceAfterPaise).toBe(105000);
    const twice = await call("POST", `/customers/${id}/entries/${paymentEntry}/reverse`, { cookie, body: {} });
    expect(twice.body.error.code).toBe("ALREADY_REVERSED");
    const list = await call("GET", "/customers?filter=outstanding", { cookie });
    expect(list.body.data.totals.outstandingPaise).toBe(105000);
    const archive = await call("PATCH", `/customers/${id}`, { cookie, body: { isActive: false } });
    expect(archive.status).toBe(409);
  });
});

describe("expenses & reports", () => {
  it("records expenses and computes profit from transactions", async () => {
    const { cookie } = await signupOwner();
    const p = await createProduct(cookie, { sellingPricePaise: 10000, purchasePricePaise: 6000, gstRateBp: 0, openingStockMilli: 10000 });
    await call("POST", "/sales", { cookie, idempotencyKey: key(), body: { items: [{ productId: p, quantityMilli: 5000 }], payment: { method: "CASH" } } });
    const cats = await call("GET", "/expenses/categories", { cookie });
    const rent = cats.body.data.find((c: { name: string }) => c.name === "Rent");
    const exp = await call("POST", "/expenses", { cookie, idempotencyKey: key(), body: { amountPaise: 5000, categoryId: rent.id, notes: "Shop rent share" } });
    expect(exp.status).toBe(201);
    const dash = await call("GET", "/reports/dashboard", { cookie });
    expect(dash.body.data.today).toMatchObject({ salesPaise: 50000, orders: 1, grossProfitPaise: 20000, expensesPaise: 5000, netProfitPaise: 15000 });
    const today = dash.body.data.date;
    const profit = await call("GET", `/reports/profit?from=${today}&to=${today}`, { cookie });
    expect(profit.body.data).toMatchObject({ revenuePaise: 50000, costOfGoodsPaise: 30000, grossProfitPaise: 20000, expensesPaise: 5000, netProfitPaise: 15000 });
    const csv = await getText(cookie, `/reports/export/profit?from=${today}&to=${today}`);
    expect(csv).toContain("200.00");
    const rev = await call("POST", `/expenses/${exp.body.data.id}/reverse`, { cookie, body: {} });
    expect(rev.status).toBe(200);
    const dash2 = await call("GET", "/reports/dashboard", { cookie });
    expect(dash2.body.data.today.expensesPaise).toBe(0);
  });

  it("produces a GST summary of output and input tax", async () => {
    const { cookie } = await signupOwner();
    const p = await createProduct(cookie, { sellingPricePaise: 11800, gstRateBp: 1800, openingStockMilli: 10000 });
    await call("POST", "/sales", { cookie, idempotencyKey: key(), body: { items: [{ productId: p, quantityMilli: 1000 }], payment: { method: "CASH" } } });
    await call("POST", "/purchases", { cookie, idempotencyKey: key(), body: { items: [{ productId: p, quantityMilli: 1000, unitCostPaise: 5000 }], payment: { status: "PAID" } } });
    const dash = await call("GET", "/reports/dashboard", { cookie });
    const d = dash.body.data.date;
    const gst = await call("GET", `/reports/gst?from=${d}&to=${d}`, { cookie });
    expect(gst.body.data.outputTaxPaise).toBe(1800);
    expect(gst.body.data.inputTaxPaise).toBe(900);
    expect(gst.body.data.netPayablePaise).toBe(900);
  });
});

async function getText(cookie: string, path: string) {
  const { env } = await import("cloudflare:workers");
  const { getApp } = await import("@/server/api/app");
  const res = await getApp().fetch(new Request(`http://localhost/api${path}`, { headers: { cookie } }), env);
  return res.text();
}
