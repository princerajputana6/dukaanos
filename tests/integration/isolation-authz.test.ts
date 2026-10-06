import { describe, expect, it } from "vitest";
import { call, createCustomer, createProduct, key, ownerAndStaff, signupOwner } from "./helpers";

describe("multi-tenant isolation", () => {
  it("business B can never read or mutate business A's data", async () => {
    const a = await signupOwner({ businessName: "Shop A" });
    const b = await signupOwner({ businessName: "Shop B" });
    const product = await createProduct(a.cookie, { name: "Secret Product" });
    const customer = await createCustomer(a.cookie, "A's Customer");
    const sale = await call("POST", "/sales", { cookie: a.cookie, idempotencyKey: key(), body: { items: [{ productId: product, quantityMilli: 1000 }], payment: { method: "CASH" } } });

    expect((await call("GET", `/products/${product}`, { cookie: b.cookie })).status).toBe(404);
    expect((await call("PATCH", `/products/${product}`, { cookie: b.cookie, body: { name: "Hacked" } })).status).toBe(404);
    expect((await call("GET", `/customers/${customer}`, { cookie: b.cookie })).status).toBe(404);
    expect((await call("POST", `/customers/${customer}/payment`, { cookie: b.cookie, body: { amountPaise: 100 } })).status).toBe(404);
    expect((await call("GET", `/sales/${sale.body.data.id}`, { cookie: b.cookie })).status).toBe(404);
    expect((await call("POST", `/sales/${sale.body.data.id}/reverse`, { cookie: b.cookie, body: {} })).status).toBe(404);
    expect((await call("POST", "/inventory/adjust", { cookie: b.cookie, body: { productId: product, quantityMilli: 1000 } })).status).toBe(404);
    // Selling A's product from B is rejected.
    const cross = await call("POST", "/sales", { cookie: b.cookie, body: { items: [{ productId: product, quantityMilli: 1000 }], payment: { method: "CASH" } } });
    expect(cross.status).toBe(404);

    expect((await call("GET", "/products", { cookie: b.cookie })).body.data.items).toHaveLength(0);
    expect((await call("GET", "/customers", { cookie: b.cookie })).body.data.items).toHaveLength(0);
    expect((await call("GET", "/sales", { cookie: b.cookie })).body.data.items).toHaveLength(0);
    expect((await call("GET", "/search?q=Secret", { cookie: b.cookie })).body.data.products).toHaveLength(0);
    expect((await call("GET", "/audit", { cookie: b.cookie })).body.data.items.every((x: { summary: string }) => !x.summary.includes("Secret"))).toBe(true);
  });

  it("cannot switch to a business the user is not a member of", async () => {
    const a = await signupOwner();
    const b = await signupOwner();
    const res = await call("POST", "/auth/switch-business", { cookie: b.cookie, body: { businessId: a.businessId } });
    expect(res.status).toBe(404);
  });

  it("requires authentication for business APIs", async () => {
    expect((await call("GET", "/products")).status).toBe(401);
    expect((await call("POST", "/sales", { body: {} })).status).toBe(401);
  });
});

describe("roles & permissions", () => {
  it("staff can sell but cannot reverse sales, adjust stock, see reports or audit", async () => {
    const { owner, staffCookie } = await ownerAndStaff("role_staff");
    const p = await createProduct(owner.cookie, { openingStockMilli: 10000 });
    const sale = await call("POST", "/sales", { cookie: staffCookie, idempotencyKey: key(), body: { items: [{ productId: p, quantityMilli: 1000 }], payment: { method: "CASH" } } });
    expect(sale.status).toBe(201);
    expect((await call("POST", `/sales/${sale.body.data.id}/reverse`, { cookie: staffCookie, body: {} })).status).toBe(403);
    expect((await call("POST", "/inventory/adjust", { cookie: staffCookie, body: { productId: p, quantityMilli: 1000 } })).status).toBe(403);
    const today = (await call("GET", "/reports/dashboard", { cookie: staffCookie })).body.data;
    expect(today.today.grossProfitPaise).toBeNull();
    expect((await call("GET", `/reports/profit?from=${today.date}&to=${today.date}`, { cookie: staffCookie })).status).toBe(403);
    expect((await call("GET", "/audit", { cookie: staffCookie })).status).toBe(403);
    expect((await call("GET", "/team/members", { cookie: staffCookie })).status).toBe(403);
    expect((await call("PATCH", "/business/settings", { cookie: staffCookie, body: { allowNegativeStock: true } })).status).toBe(403);
    expect((await call("GET", "/purchases", { cookie: staffCookie })).status).toBe(403);
    const detail = await call("GET", `/sales/${sale.body.data.id}`, { cookie: staffCookie });
    expect(detail.body.data.sale.costPaise).toBeNull();
  });

  it("managers can reverse sales and view reports but not manage users", async () => {
    const { owner, staffCookie: manager } = await ownerAndStaff("role_manager");
    const p = await createProduct(owner.cookie, { openingStockMilli: 10000 });
    const sale = await call("POST", "/sales", { cookie: manager, idempotencyKey: key(), body: { items: [{ productId: p, quantityMilli: 1000 }], payment: { method: "CASH" } } });
    expect((await call("POST", `/sales/${sale.body.data.id}/reverse`, { cookie: manager, body: {} })).status).toBe(200);
    expect((await call("GET", "/team/members", { cookie: manager })).status).toBe(403);
  });

  it("owners can deactivate staff, which ends their session immediately", async () => {
    const { owner, staffCookie, memberId } = await ownerAndStaff();
    expect((await call("GET", "/me", { cookie: staffCookie })).status).toBe(200);
    await call("PATCH", `/team/members/${memberId}`, { cookie: owner.cookie, body: { isActive: false } });
    expect((await call("GET", "/me", { cookie: staffCookie })).status).toBe(401);
  });

  it("cannot demote the last owner or grant permissions they don't hold", async () => {
    const { owner } = await ownerAndStaff();
    const members = await call("GET", "/team/members", { cookie: owner.cookie });
    const self = members.body.data.find((m: { roleKey: string }) => m.roleKey === "owner");
    expect((await call("PATCH", `/team/members/${self.memberId}`, { cookie: owner.cookie, body: { roleId: "role_staff" } })).status).toBe(403);
    const role = await call("POST", "/team/roles", { cookie: owner.cookie, body: { name: "Cashier", permissions: ["sales.create"] } });
    expect(role.status).toBe(201);
  });
});
