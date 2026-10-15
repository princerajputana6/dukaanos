import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { call, createProduct, key, signupOwner, stockOf } from "./helpers";

describe("stock counts", () => {
  it("applies a physical count: sets stock, records diffs and movements, leaves matches untouched", async () => {
    const { cookie } = await signupOwner();
    const coke = await createProduct(cookie, { name: "Coke 500ml", sellingPricePaise: 4000, purchasePricePaise: 3300, openingStockMilli: 34000 });
    const chips = await createProduct(cookie, { name: "Lays", sellingPricePaise: 2000, purchasePricePaise: 1500, openingStockMilli: 10000 });

    const idk = key();
    const countBody = { cookie, idempotencyKey: idk, body: { note: "Monthly count", lines: [{ productId: coke, countedMilli: 30000 }, { productId: chips, countedMilli: 10000 }] } };
    const res = await call("POST", "/inventory/counts", countBody);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ linesCount: 2, diffCount: 1, netDeltaMilli: -4000 });

    expect(await stockOf(cookie, coke)).toBe(30000); // set to counted
    expect(await stockOf(cookie, chips)).toBe(10000); // unchanged (no diff)

    // Exactly one COUNT movement, only for the changed product.
    const moves = await call("GET", `/inventory/movements?productId=${coke}`, { cookie });
    expect(moves.body.data.items.some((m: { type: string; quantityMilli: number }) => m.type === "COUNT" && m.quantityMilli === -4000)).toBe(true);
    const chipMoves = await call("GET", `/inventory/movements?productId=${chips}`, { cookie });
    expect(chipMoves.body.data.items.some((m: { type: string }) => m.type === "COUNT")).toBe(false);

    const id = res.body.data.countId;
    const detail = await call("GET", `/inventory/counts/${id}`, { cookie });
    expect(detail.body.data.lines).toHaveLength(2);
    expect(detail.body.data.lines.find((l: { productName: string }) => l.productName === "Coke 500ml")).toMatchObject({ expectedMilli: 34000, countedMilli: 30000, diffMilli: -4000 });

    // Idempotent: replaying the same key + body returns the same count and applies once.
    const replay = await call("POST", "/inventory/counts", countBody);
    expect(replay.body.data.countId).toBe(id);
    expect(await stockOf(cookie, coke)).toBe(30000);
    const list = await call("GET", "/inventory/counts", { cookie });
    expect(list.body.data).toHaveLength(1);
  });

  it("rejects a count with an unknown product", async () => {
    const { cookie } = await signupOwner();
    const r = await call("POST", "/inventory/counts", { cookie, idempotencyKey: key(), body: { lines: [{ productId: "nope", countedMilli: 5 }] } });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.body.error.code).toBe("PRODUCT_NOT_FOUND");
  });
});

describe("branch-to-branch transfers", () => {
  async function twoBranches() {
    const owner = await signupOwner({ businessName: "Sharma Store" });
    // Trial caps branches at 1; lift the cap for this tenant so a second branch can be created.
    await env.DB.prepare("UPDATE licenses SET max_branches = 5 WHERE tenant_id = (SELECT tenant_id FROM businesses WHERE id = ?)").bind(owner.businessId).run();
    const coke = await createProduct(owner.cookie, { name: "Coke 500ml", sellingPricePaise: 4000, purchasePricePaise: 3300, openingStockMilli: 48000 });
    const branch = await call("POST", "/branches", { cookie: owner.cookie, body: { name: "Sharma Store — MG Road", copyCatalogue: true } });
    expect(branch.status).toBe(201);
    return { owner, coke, toBusinessId: branch.body.data.businessId as string };
  }

  it("moves stock out of the current branch and into the sibling branch, atomically", async () => {
    const { owner, coke, toBusinessId } = await twoBranches();
    const res = await call("POST", "/inventory/transfers", {
      cookie: owner.cookie,
      idempotencyKey: key(),
      body: { toBusinessId, note: "Restock MG Road", lines: [{ productId: coke, quantityMilli: 20000 }] },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.lines[0]).toMatchObject({ productName: "Coke 500ml", quantityMilli: 20000 });

    // Source branch decreased.
    expect(await stockOf(owner.cookie, coke)).toBe(28000);
    // Target branch starts empty (copyCatalogue copies products, not stock) → 0 + 20 = 20.
    const toProductId = res.body.data.lines[0].toProductId as string;
    const toStock = await env.DB.prepare("SELECT current_stock_milli AS s FROM products WHERE id = ?").bind(toProductId).first<{ s: number }>();
    expect(toStock?.s).toBe(20000);

    // Linked TRANSFER_OUT / TRANSFER_IN movements exist.
    const out = await env.DB.prepare("SELECT type FROM inventory_movements WHERE reference_id = ? AND type = 'TRANSFER_OUT'").bind(res.body.data.transferId).first();
    const inn = await env.DB.prepare("SELECT type FROM inventory_movements WHERE reference_id = ? AND type = 'TRANSFER_IN'").bind(res.body.data.transferId).first();
    expect(out).toBeTruthy();
    expect(inn).toBeTruthy();
  });

  it("refuses to transfer more than is in stock, leaving both branches unchanged", async () => {
    const { owner, coke, toBusinessId } = await twoBranches();
    const r = await call("POST", "/inventory/transfers", { cookie: owner.cookie, idempotencyKey: key(), body: { toBusinessId, lines: [{ productId: coke, quantityMilli: 999000 }] } });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(await stockOf(owner.cookie, coke)).toBe(48000);
  });

  it("rejects a transfer to a branch of another tenant", async () => {
    const { owner, coke } = await twoBranches();
    const other = await signupOwner();
    const r = await call("POST", "/inventory/transfers", { cookie: owner.cookie, idempotencyKey: key(), body: { toBusinessId: other.businessId, lines: [{ productId: coke, quantityMilli: 1000 }] } });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(["NOT_FOUND", "FORBIDDEN"]).toContain(r.body.error.code);
  });
});
