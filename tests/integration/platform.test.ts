import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { call, createProduct, key, nextMobile, signupOwner } from "./helpers";

async function superAdmin() {
  const a = await signupOwner({ businessName: "Platform HQ" });
  await env.DB.prepare("UPDATE users SET platform_role = 'SUPER_ADMIN' WHERE id = ?").bind(a.userId).run();
  return a;
}

const newShopBody = (overrides: Record<string, unknown> = {}) => ({
  tenant: { mode: "new", name: "Gupta Traders", plan: "PRO" },
  owner: { mode: "new", name: "Ravi Gupta", mobile: nextMobile(), password: "owner-pass-1" },
  shop: { name: "Gupta Kirana — Main", type: "grocery", city: "Lucknow", stateCode: "09" },
  initialData: {
    sampleProducts: true,
    productsCsv: "name,selling_price,purchase_price,gst_rate,opening_stock\nTata Salt 1kg,28,22,0,40\nBroken Row,abc,,0,1",
    customers: [{ name: "Ramesh", phone: "9811000009", openingBalancePaise: 50000 }],
    suppliers: [{ name: "ABC Distributors" }],
  },
  ...overrides,
});

describe("super admin console", () => {
  it("is closed to shop owners and anonymous users", async () => {
    const owner = await signupOwner();
    expect((await call("GET", "/admin/overview", { cookie: owner.cookie })).status).toBe(403);
    expect((await call("GET", "/admin/overview")).status).toBe(401);
    expect((await call("POST", "/admin/shops", { cookie: owner.cookie, body: newShopBody() })).status).toBe(403);
  });

  it("self-signup creates a tenant with a 30-day trial licence", async () => {
    const owner = await signupOwner();
    const me = await call("GET", "/me", { cookie: owner.cookie });
    expect(me.body.data.membership.access).toMatchObject({ licenseStatus: "TRIAL", writable: true, plan: "TRIAL" });
    const branches = await call("GET", "/branches", { cookie: owner.cookie });
    expect(branches.body.data.license).toMatchObject({ plan: "TRIAL", maxBranches: 1 });
    expect(branches.body.data.branches).toHaveLength(1);
  });

  it("creates a shop with owner, licence and initial data; the owner can log in and sell", async () => {
    const admin = await superAdmin();
    const body = newShopBody();
    const res = await call("POST", "/admin/shops", { cookie: admin.cookie, body });
    expect(res.status).toBe(201);
    expect(res.body.data.seeded).toMatchObject({ products: 11, productErrors: 1, customers: 1, suppliers: 1 });

    const login = await call("POST", "/auth/login", { body: { identifier: body.owner.mobile, password: "owner-pass-1" } });
    expect(login.status).toBe(200);
    const me = await call("GET", "/me", { cookie: login.cookie });
    expect(me.body.data.business).toMatchObject({ name: "Gupta Kirana — Main" });
    expect(me.body.data.business.onboardedAt).not.toBeNull();
    expect(me.body.data.membership.access).toMatchObject({ plan: "PRO", licenseStatus: "ACTIVE" });

    const salt = await call("GET", "/products?q=salt", { cookie: login.cookie });
    expect(salt.body.data.items[0]).toMatchObject({ name: "Tata Salt 1kg", currentStockMilli: 40000 });
    const sale = await call("POST", "/sales", { cookie: login.cookie, idempotencyKey: key(), body: { items: [{ productId: salt.body.data.items[0].id, quantityMilli: 2000 }], payment: { method: "CASH" } } });
    expect(sale.status).toBe(201);
    const ramesh = await call("GET", "/customers?q=Ramesh", { cookie: login.cookie });
    expect(ramesh.body.data.items[0].balancePaise).toBe(50000);

    const audit = await call("GET", "/audit?source=IMPORT", { cookie: login.cookie });
    expect(audit.body.data.items.length).toBeGreaterThan(0);
  });

  it("reports platform counts and lists tenants, shops and users", async () => {
    const admin = await superAdmin();
    await call("POST", "/admin/shops", { cookie: admin.cookie, body: newShopBody() });
    const o = await call("GET", "/admin/overview", { cookie: admin.cookie });
    expect(o.body.data.counts.tenants).toBeGreaterThanOrEqual(2);
    expect(o.body.data.counts.shops).toBeGreaterThanOrEqual(2);
    expect(o.body.data.licenses.byStatus.TRIAL).toBeGreaterThanOrEqual(1);
    const tenants = await call("GET", "/admin/tenants?q=Gupta", { cookie: admin.cookie });
    expect(tenants.body.data.items[0]).toMatchObject({ name: "Gupta Traders", plan: "PRO", branches: 1, ownerName: "Ravi Gupta" });
    const shops = await call("GET", "/admin/shops?q=Gupta", { cookie: admin.cookie });
    expect(shops.body.data.items[0].products).toBe(11);
    const usersRes = await call("GET", "/admin/users?q=Ravi", { cookie: admin.cookie });
    expect(usersRes.body.data.items[0].ownedTenants).toBe(1);
  });

  it("adds branches to an existing tenant up to the licence limit, each with its own stock", async () => {
    const admin = await superAdmin();
    const created = await call("POST", "/admin/shops", { cookie: admin.cookie, body: newShopBody({ tenant: { mode: "new", name: "Two Branch Co", plan: "BASIC" } }) });
    const { tenantId, shopId } = created.body.data;
    const second = { tenant: { mode: "existing", tenantId }, shop: { name: "Branch 2", type: "grocery" }, initialData: { sampleProducts: false, copyCatalogueFromShopId: shopId } };
    const blocked = await call("POST", "/admin/shops", { cookie: admin.cookie, body: second });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("LIMIT_REACHED");

    await call("PATCH", `/admin/tenants/${tenantId}/license`, { cookie: admin.cookie, body: { maxBranches: 3, note: "Upgraded for 2nd shop" } });
    const ok = await call("POST", "/admin/shops", { cookie: admin.cookie, body: second });
    expect(ok.status).toBe(201);
    expect(ok.body.data.seeded.products).toBe(11);
    const detail = await call("GET", `/admin/tenants/${tenantId}`, { cookie: admin.cookie });
    expect(detail.body.data.shops).toHaveLength(2);
    expect(detail.body.data.usage.branches).toBe(2);
    const branchShop = detail.body.data.shops.find((s: { id: string }) => s.id === ok.body.data.shopId);
    expect(branchShop.branchCode).toBe("BR-2");
    expect(detail.body.data.licenseEvents[0].action).toBe("LICENSE_UPDATED");
  });

  it("an expired or suspended licence makes shops read-only (reads and exports still work)", async () => {
    const admin = await superAdmin();
    const owner = await signupOwner();
    const p = await createProduct(owner.cookie, { openingStockMilli: 10000 });
    const tenantId = (await env.DB.prepare("SELECT tenant_id FROM businesses WHERE id = ?").bind(owner.businessId).first<{ tenant_id: string }>())!.tenant_id;

    await call("PATCH", `/admin/tenants/${tenantId}/license`, { cookie: admin.cookie, body: { status: "SUSPENDED", note: "Unpaid" } });
    const blocked = await call("POST", "/sales", { cookie: owner.cookie, idempotencyKey: key(), body: { items: [{ productId: p, quantityMilli: 1000 }], payment: { method: "CASH" } } });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("LICENSE_INACTIVE");
    expect((await call("GET", "/products", { cookie: owner.cookie })).status).toBe(200);
    expect((await call("GET", "/me", { cookie: owner.cookie })).body.data.membership.access).toMatchObject({ writable: false, licenseStatus: "SUSPENDED" });

    // Expired by date.
    await env.DB.prepare("UPDATE licenses SET status = 'ACTIVE', valid_until = '2020-01-01' WHERE tenant_id = ?").bind(tenantId).run();
    const expired = await call("POST", "/customers", { cookie: owner.cookie, body: { name: "X" } });
    expect(expired.body.error.code).toBe("LICENSE_INACTIVE");

    const renewed = await call("PATCH", `/admin/tenants/${tenantId}/license`, { cookie: admin.cookie, body: { plan: "BASIC", validUntil: "2099-12-31" } });
    expect(renewed.status).toBe(200);
    const sale = await call("POST", "/sales", { cookie: owner.cookie, idempotencyKey: key(), body: { items: [{ productId: p, quantityMilli: 1000 }], payment: { method: "CASH" } } });
    expect(sale.status).toBe(201);
  });

  it("refuses to activate a licence whose end date has passed", async () => {
    const admin = await superAdmin();
    const owner = await signupOwner();
    const tenantId = (await env.DB.prepare("SELECT tenant_id FROM businesses WHERE id = ?").bind(owner.businessId).first<{ tenant_id: string }>())!.tenant_id;
    const r = await call("PATCH", `/admin/tenants/${tenantId}/license`, { cookie: admin.cookie, body: { status: "ACTIVE", validUntil: "2020-01-01" } });
    expect(r.status).toBe(400);
  });

  it("suspending one shop blocks writes there only", async () => {
    const admin = await superAdmin();
    const owner = await signupOwner();
    await call("PATCH", `/admin/shops/${owner.businessId}`, { cookie: admin.cookie, body: { status: "SUSPENDED" } });
    const r = await call("POST", "/customers", { cookie: owner.cookie, body: { name: "Y" } });
    expect(r.body.error.code).toBe("LICENSE_INACTIVE");
    const shopAudit = await env.DB.prepare("SELECT summary, source FROM audit_logs WHERE business_id = ? AND action = 'SHOP_SUSPENDED'").bind(owner.businessId).first<{ summary: string; source: string }>();
    expect(shopAudit).toMatchObject({ source: "SYSTEM" });
  });

  it("owners add branches themselves within their plan, copying the catalogue without stock", async () => {
    const admin = await superAdmin();
    const owner = await signupOwner();
    await call("POST", "/products/samples", { cookie: owner.cookie });
    const limited = await call("POST", "/branches", { cookie: owner.cookie, body: { name: "Second Shop" } });
    expect(limited.body.error.code).toBe("LIMIT_REACHED");
    const tenantId = (await env.DB.prepare("SELECT tenant_id FROM businesses WHERE id = ?").bind(owner.businessId).first<{ tenant_id: string }>())!.tenant_id;
    await call("PATCH", `/admin/tenants/${tenantId}/license`, { cookie: admin.cookie, body: { plan: "PRO" } });
    const r = await call("POST", "/branches", { cookie: owner.cookie, body: { name: "Second Shop", copyCatalogue: true } });
    expect(r.status).toBe(201);
    expect(r.body.data.copiedProducts).toBe(10);
    await call("POST", "/auth/switch-business", { cookie: owner.cookie, body: { businessId: r.body.data.businessId } });
    const prods = await call("GET", "/products?limit=100", { cookie: owner.cookie });
    expect(prods.body.data.items).toHaveLength(10);
    expect(prods.body.data.items.every((x: { currentStockMilli: number }) => x.currentStockMilli === 0)).toBe(true);
  });

  it("enforces the licence user limit across branches", async () => {
    const owner = await signupOwner(); // TRIAL: 3 users
    for (let i = 0; i < 2; i++) {
      const r = await call("POST", "/team/members", { cookie: owner.cookie, body: { name: `Staff ${i}`, mobile: nextMobile(), roleId: "role_staff", password: "staff-pass-1" } });
      expect(r.status).toBe(201);
    }
    const r = await call("POST", "/team/members", { cookie: owner.cookie, body: { name: "One too many", mobile: nextMobile(), roleId: "role_staff", password: "staff-pass-1" } });
    expect(r.body.error.code).toBe("LIMIT_REACHED");
  });

  it("manages agencies and users, and records every admin action", async () => {
    const admin = await superAdmin();
    const ag = await call("POST", "/admin/agencies", { cookie: admin.cookie, body: { name: "Jaipur Retail Partners", city: "Jaipur" } });
    expect(ag.status).toBe(201);
    const shop = await call("POST", "/admin/shops", { cookie: admin.cookie, body: newShopBody({ tenant: { mode: "new", name: "Agency Shop", agencyId: ag.body.data.id } }) });
    const list = await call("GET", "/admin/agencies", { cookie: admin.cookie });
    expect(list.body.data.find((a: { id: string }) => a.id === ag.body.data.id)).toMatchObject({ tenants: 1, shops: 1, activeLicenses: 1 });

    const ownerId = shop.body.data.ownerUserId;
    await call("PATCH", `/admin/users/${ownerId}`, { cookie: admin.cookie, body: { isActive: false } });
    const ownerMobile = (await env.DB.prepare("SELECT mobile FROM users WHERE id = ?").bind(ownerId).first<{ mobile: string }>())!.mobile;
    const denied = await call("POST", "/auth/login", { body: { identifier: ownerMobile, password: "owner-pass-1" } });
    expect(denied.body.error.code).toBe("ACCOUNT_DISABLED");
    expect((await call("PATCH", `/admin/users/${admin.userId}`, { cookie: admin.cookie, body: { isActive: false } })).status).toBe(403);

    const audit = await call("GET", "/admin/audit", { cookie: admin.cookie });
    const actions = audit.body.data.items.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["AGENCY_CREATED", "SHOP_CREATED", "USER_UPDATED"]));
  });
});
