import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { call, createProduct, key, signupOwner, stockOf } from "./helpers";

describe("products", () => {
  it("creates a product with opening stock, aliases, pack units and an audit entry", async () => {
    const { cookie } = await signupOwner();
    const id = await createProduct(cookie, { name: "Coke 500ml", aliases: ["Coke", "कोक"], units: [{ name: "crate", factorMilli: 24000 }], openingStockMilli: 34000, categoryName: "Cold Drinks" });
    const detail = await call("GET", `/products/${id}`, { cookie });
    expect(detail.body.data.product.currentStockMilli).toBe(34000);
    expect(detail.body.data.aliases.map((a: { alias: string }) => a.alias)).toEqual(["Coke", "कोक"]);
    expect(detail.body.data.units[0]).toMatchObject({ name: "crate", factorMilli: 24000 });
    expect(detail.body.data.category.name).toBe("Cold Drinks");
    expect(detail.body.data.movements[0]).toMatchObject({ type: "OPENING", quantityMilli: 34000, beforeMilli: 0, afterMilli: 34000 });

    const audit = await call("GET", `/audit?entityType=product&entityId=${id}`, { cookie });
    expect(audit.body.data.items[0].action).toBe("PRODUCT_CREATED");
  });

  it("finds products by alias, Devanagari and Hinglish spelling", async () => {
    const { cookie } = await signupOwner();
    await createProduct(cookie, { name: "Coca Cola 500ml", aliases: ["Coke"] });
    await createProduct(cookie, { name: "Amul Milk 500ml", aliases: ["doodh"] });
    for (const q of ["coke", "कोक", "COCA", "dudh"]) {
      const res = await call("GET", `/products?q=${encodeURIComponent(q)}`, { cookie });
      expect(res.body.data.items.length, q).toBeGreaterThan(0);
    }
  });

  it("rejects duplicate SKUs and selling price above MRP", async () => {
    const { cookie } = await signupOwner();
    await createProduct(cookie, { name: "A", sku: "SKU-1" });
    const dup = await call("POST", "/products", { cookie, body: { name: "B", sku: "SKU-1", sellingPricePaise: 100 } });
    expect(dup.status).toBe(409);
    const mrp = await call("POST", "/products", { cookie, body: { name: "C", sellingPricePaise: 5000, mrpPaise: 4000 } });
    expect(mrp.status).toBe(400);
  });

  it("archives and restores products", async () => {
    const { cookie } = await signupOwner();
    const id = await createProduct(cookie);
    await call("PATCH", `/products/${id}`, { cookie, body: { isActive: false } });
    expect((await call("GET", "/products", { cookie })).body.data.items).toHaveLength(0);
    expect((await call("GET", "/products?status=archived", { cookie })).body.data.items).toHaveLength(1);
  });

  it("imports products from CSV with per-row validation", async () => {
    const { cookie } = await signupOwner();
    const csv = [
      "name,category,unit,purchase_price,selling_price,mrp,gst_rate,opening_stock,aliases",
      "Tata Salt 1kg,Grocery,pack,22,28,28,0,40,namak|नमक",
      "Bad Row,Grocery,pack,10,abc,,0,1,",
      "Maggi 70g,Noodles,packet,12,14,14,18,100,",
    ].join("\n");
    const dry = await call("POST", "/products/import", { cookie, body: { csv, dryRun: true } });
    expect(dry.body.data).toMatchObject({ created: 2, dryRun: true });
    expect(dry.body.data.errors[0]).toMatchObject({ row: 3 });
    const real = await call("POST", "/products/import", { cookie, body: { csv } });
    expect(real.body.data.created).toBe(2);
    const list = await call("GET", "/products?q=namak", { cookie });
    expect(list.body.data.items[0].name).toBe("Tata Salt 1kg");
    expect(list.body.data.items[0].currentStockMilli).toBe(40000);
    const again = await call("POST", "/products/import", { cookie, body: { csv } });
    expect(again.body.data.skipped).toBe(2);
  });

  it("adds sample products for the business type", async () => {
    const { cookie } = await signupOwner();
    const res = await call("POST", "/products/samples", { cookie });
    expect(res.body.data.created).toBe(10);
    const again = await call("POST", "/products/samples", { cookie });
    expect(again.body.data.created).toBe(0);
  });
});

describe("inventory", () => {
  it("records adjustments, damage and physical counts with before/after quantities", async () => {
    const { cookie } = await signupOwner();
    const id = await createProduct(cookie, { openingStockMilli: 20000 });
    const add = await call("POST", "/inventory/adjust", { cookie, idempotencyKey: key(), body: { productId: id, quantityMilli: 5000, reason: "Found in godown" } });
    expect(add.status).toBe(201);
    expect(add.body.data).toMatchObject({ beforeMilli: 20000, afterMilli: 25000 });
    await call("POST", "/inventory/adjust", { cookie, idempotencyKey: key(), body: { productId: id, type: "DAMAGE", quantityMilli: 2000, reason: "Broken" } });
    expect(await stockOf(cookie, id)).toBe(23000);
    await call("POST", "/inventory/adjust", { cookie, idempotencyKey: key(), body: { productId: id, mode: "set", quantityMilli: 21000, reason: "Stock count" } });
    expect(await stockOf(cookie, id)).toBe(21000);
    const moves = await call("GET", `/inventory/movements?productId=${id}`, { cookie });
    expect(moves.body.data.items.map((m: { type: string }) => m.type)).toEqual(["ADJUSTMENT", "DAMAGE", "ADJUSTMENT", "OPENING"]);
    for (const m of moves.body.data.items) expect(m.afterMilli - m.beforeMilli).toBe(m.quantityMilli);
  });

  it("never lets stock go negative (service check and DB trigger)", async () => {
    const { cookie, businessId } = await signupOwner();
    const id = await createProduct(cookie, { openingStockMilli: 3000 });
    const res = await call("POST", "/inventory/adjust", { cookie, body: { productId: id, type: "DAMAGE", quantityMilli: 5000 } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
    // Even a direct write is blocked by the trigger.
    await expect(env.DB.prepare("UPDATE products SET current_stock_milli = -1000 WHERE id = ? AND business_id = ?").bind(id, businessId).run()).rejects.toThrow(/INSUFFICIENT_STOCK/);
  });

  it("raises a low-stock alert and notification when crossing the threshold", async () => {
    const { cookie } = await signupOwner();
    const id = await createProduct(cookie, { name: "Bread", openingStockMilli: 12000, lowStockThresholdMilli: 5000 });
    await call("POST", "/inventory/adjust", { cookie, idempotencyKey: key(), body: { productId: id, type: "DAMAGE", quantityMilli: 8000 } });
    const summary = await call("GET", "/inventory", { cookie });
    expect(summary.body.data.lowStock).toBe(1);
    const low = await call("GET", "/inventory/low-stock", { cookie });
    expect(low.body.data[0]).toMatchObject({ id, currentStockMilli: 4000 });
    expect(low.body.data[0].suggestedReorderMilli).toBeGreaterThanOrEqual(6000);
    const notes = await call("GET", "/notifications", { cookie });
    expect(notes.body.data.items.some((n: { type: string; title: string }) => n.type === "LOW_STOCK" && n.title.includes("Bread"))).toBe(true);
  });

  it("does not track stock for services", async () => {
    const { cookie } = await signupOwner();
    const id = await createProduct(cookie, { name: "Haircut", trackStock: false, openingStockMilli: 0 });
    const sale = await call("POST", "/sales", { cookie, idempotencyKey: key(), body: { items: [{ productId: id, quantityMilli: 1000 }], payment: { method: "CASH" } } });
    expect(sale.status).toBe(201);
    expect(await stockOf(cookie, id)).toBe(0);
  });
});
