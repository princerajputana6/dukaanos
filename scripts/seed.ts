/**
 * Seeds the LOCAL D1 database with the demo business "Sharma General Store" and ~30 days of
 * realistic activity. Uses the real transaction services (not raw SQL), so stock, ledgers,
 * payments and audit logs are all consistent.
 *
 *   pnpm db:migrate:local && pnpm db:seed:local
 *
 * Demo logins (local only):
 *   Super admin  99999 00000 / admin12345  (→ /admin)
 *   Owner        98765 43210 / dukaan123
 *   Staff        98765 00001 / staff1234
 */
import { getPlatformProxy } from "wrangler";
import { addDays, istDayStartMs, todayIst } from "../src/lib/dates";
import { getDb } from "../src/server/db/client";
import { businesses, licenses, tenants, users } from "../src/server/db/schema";
import { newId } from "../src/lib/ids";
import { hashPassword } from "../src/server/auth/password";
import { createShop, saveAgency, updateLicense, updateTenant, type AdminContext } from "../src/server/services/admin";
import { eq } from "drizzle-orm";
import { createLogger } from "../src/server/lib/logger";
import { signup } from "../src/server/services/auth";
import { loadMembership } from "../src/server/auth/session";
import type { ServiceContext } from "../src/server/services/context";
import { addSampleProducts, listProducts } from "../src/server/services/products";
import { createCustomer, recordCustomerCredit, recordCustomerPayment } from "../src/server/services/customers";
import { createSupplier, recordSupplierPayment } from "../src/server/services/suppliers";
import { createSale } from "../src/server/services/sales";
import { createPurchase } from "../src/server/services/purchases";
import { createExpense, listExpenseCategories } from "../src/server/services/expenses";
import { updateBusinessProfile, updateGstSettings, updateOnboarding } from "../src/server/services/business";
import { addMember } from "../src/server/services/members";
import { runDailyJobs } from "../src/server/services/notifications";
import type { Permission } from "../src/lib/domain";

const OWNER_MOBILE = "9876543210";
const SUPER_ADMIN_MOBILE = "9999900000";

async function main() {
  const proxy = await getPlatformProxy<Env>({ configPath: "wrangler.jsonc" });
  const env = proxy.env;
  const db = getDb(env.DB);
  const logger = createLogger({ script: "seed" });
  const quiet = createLogger({ script: "seed" });
  quiet.info = () => undefined;

  const existing = await db.select().from(users).where(eq(users.mobile, OWNER_MOBILE)).get();
  if (existing) {
    console.log("Demo data already exists. Run `pnpm db:reset:local` to start fresh.");
    await proxy.dispose();
    return;
  }

  const today = todayIst();
  const start = addDays(today, -29);
  const startMs = istDayStartMs(start) + 7 * 3600_000;
  const { userId, businessId } = await signup(
    db,
    { name: "Prince Sharma", mobile: OWNER_MOBILE, email: "owner@sharmastore.example", password: "dukaan123", businessName: "Sharma General Store", businessType: "grocery", city: "Jaipur" },
    { ip: null, userAgent: "seed", requestId: "seed", now: startMs },
  );
  const m = (await loadMembership(db, userId, businessId))!;
  let clock = startMs;
  const ctx = (): ServiceContext => ({
    db,
    env,
    businessId,
    userId,
    userName: "Prince Sharma",
    roleKey: "owner",
    permissions: new Set(m.permissions as Permission[]),
    source: "WEB",
    requestId: "seed",
    ip: null,
    now: clock,
    logger: quiet,
  });

  await updateBusinessProfile(ctx(), { stateCode: "08", phone: OWNER_MOBILE, address: "Shop 12, Johari Bazaar, Jaipur" });
  await updateGstSettings(ctx(), { gstin: "08ABCDE1234F1Z5", legalName: "Sharma General Store", stateCode: "08", registrationStatus: "REGISTERED" });
  await addSampleProducts(ctx());
  await updateOnboarding(ctx(), { step: 5, complete: true });
  await addMember(ctx(), { name: "Raju", mobile: "9876500001", roleId: "role_staff", password: "staff1234" });

  const ramesh = await createCustomer(ctx(), { name: "Ramesh", phone: "9811000001", openingBalancePaise: 0 });
  const suresh = await createCustomer(ctx(), { name: "Suresh", phone: "9811000002", openingBalancePaise: 25000 });
  const amit = await createCustomer(ctx(), { name: "Amit", phone: "9811000003", openingBalancePaise: 0 });
  const abc = await createSupplier(ctx(), { name: "ABC Distributors", company: "ABC Beverages Pvt Ltd", phone: "9414000001", gstin: "08AABCA1234B1Z2", openingBalancePaise: 0 });
  const wholesale = await createSupplier(ctx(), { name: "Sharma Wholesale", phone: "9414000002", openingBalancePaise: 0 });

  const products = (await listProducts(ctx(), { stock: "all", status: "active", sort: "name", limit: 100 })).items;
  const cats = await listExpenseCategories(ctx());
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  const bev = products.filter((p) => ["Cold Drinks", "Beverages"].includes(p.categoryName ?? ""));
  const other = products.filter((p) => !bev.includes(p));

  // Deterministic pseudo-random numbers so every seed produces the same demo.
  let seed = 20260925;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;

  let sales = 0;
  for (let day = 0; day < 30; day++) {
    const date = addDays(start, day);
    const dayStart = istDayStartMs(date);
    // Weekly restock from suppliers.
    if (day % 7 === 0) {
      clock = dayStart + 8 * 3600_000;
      const live = (await listProducts(ctx(), { stock: "all", status: "active", sort: "name", limit: 100 })).items;
      const items = live
        .filter((p) => p.trackStock && p.currentStockMilli < p.lowStockThresholdMilli * 3)
        .map((p) => ({ productId: p.id, quantityMilli: 24000, unitCostPaise: p.purchasePricePaise, discountPaise: 0 }));
      if (items.length) {
        const bevItems = items.filter((i) => bev.some((b) => b.id === i.productId));
        const otherItems = items.filter((i) => !bev.some((b) => b.id === i.productId));
        if (bevItems.length) await createPurchase(ctx(), { supplierId: abc.id, billNumber: `ABC-${1000 + day}`, items: bevItems, billDiscountPaise: 0, pricesIncludeGst: false, payment: { status: day === 21 ? "UNPAID" : "PARTIAL", method: "UPI", paidPaise: day === 21 ? undefined : 50000 } });
        if (otherItems.length) await createPurchase(ctx(), { supplierId: wholesale.id, items: otherItems, billDiscountPaise: 0, pricesIncludeGst: false, payment: { status: "PAID", method: "CASH" } });
      }
    }
    // 6–14 bills a day between 9am and 9pm.
    const bills = 6 + Math.floor(rnd() * 9);
    for (let b = 0; b < bills; b++) {
      clock = dayStart + (9 + Math.floor((12 * b) / bills)) * 3600_000 + Math.floor(rnd() * 3000_000);
      const live = (await listProducts(ctx(), { stock: "all", status: "active", sort: "name", limit: 100 })).items;
      const lines = new Map<string, number>();
      const n = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const p = pick(rnd() < 0.55 ? bev : other);
        const lp = live.find((x) => x.id === p.id)!;
        const qty = (1 + Math.floor(rnd() * (p.name.includes("Coke") ? 6 : 3))) * 1000;
        if (lp.currentStockMilli - (lines.get(p.id) ?? 0) >= qty) lines.set(p.id, (lines.get(p.id) ?? 0) + qty);
      }
      if (!lines.size) continue;
      const credit = rnd() < 0.12;
      const customer = credit ? pick([ramesh, suresh, amit]) : rnd() < 0.2 ? pick([ramesh, suresh, amit]) : null;
      const method = credit ? "CREDIT" : pick(["CASH", "CASH", "UPI", "UPI", "UPI", "CARD"] as const);
      await createSale(ctx(), {
        items: [...lines].map(([productId, quantityMilli]) => ({ productId, quantityMilli, discountPaise: 0 })),
        customerId: customer?.id ?? null,
        billDiscountPaise: 0,
        payment: { method },
      });
      sales++;
    }
    clock = dayStart + 19 * 3600_000;
    if (day % 5 === 2) await recordCustomerPayment(ctx(), pick([ramesh, suresh, amit]).id, { amountPaise: 20000 + Math.floor(rnd() * 4) * 10000, method: pick(["CASH", "UPI"] as const) });
    if (day === 10) await recordCustomerCredit(ctx(), ramesh.id, { amountPaise: 85000, note: "Monthly ration" });
    if (day === 1) await createExpense(ctx(), { amountPaise: 1500000, categoryId: cat("Rent"), paymentMethod: "UPI", notes: "Shop rent" });
    if (day === 5) await createExpense(ctx(), { amountPaise: 240000, categoryId: cat("Electricity"), paymentMethod: "UPI", notes: "Bijli bill" });
    if (day === 28) await createExpense(ctx(), { amountPaise: 900000, categoryId: cat("Salary"), paymentMethod: "CASH", notes: "Raju salary" });
    if (day % 3 === 0) await createExpense(ctx(), { amountPaise: 5000 + Math.floor(rnd() * 10) * 1000, categoryId: cat("Transport"), paymentMethod: "CASH", notes: "Auto / delivery" });
    if (day === 14) await recordSupplierPayment(ctx(), abc.id, { amountPaise: 100000, method: "UPI" });
  }

  clock = Date.now();

  // ── Platform: super admin, an agency, Sharma's 2nd branch and a few other tenants ──
  const adminId = newId(clock);
  await db.insert(users).values({ id: adminId, name: "DukaanOS Admin", mobile: SUPER_ADMIN_MOBILE, email: "admin@dukaanos.example", passwordHash: await hashPassword("admin12345"), platformRole: "SUPER_ADMIN", createdAt: clock, updatedAt: clock });
  const actx: AdminContext = { db, env, actorUserId: adminId, actorName: "DukaanOS Admin", ip: null, requestId: "seed", now: clock, logger: quiet };
  const agency = await saveAgency(actx, { name: "Jaipur Retail Partners", contactName: "Neha Jain", phone: "9414000099", email: null, city: "Jaipur", status: "ACTIVE", notes: "Reseller for Rajasthan" });
  const sharmaTenant = (await db.select({ tenantId: businesses.tenantId }).from(businesses).where(eq(businesses.id, businessId)).get())!.tenantId!;
  await updateTenant(actx, sharmaTenant, { agencyId: agency.id });
  await updateLicense(actx, sharmaTenant, { plan: "PRO", validUntil: addDays(today, 300), note: "Annual Pro plan — paid via UPI" });
  await createShop(actx, {
    tenant: { mode: "existing", tenantId: sharmaTenant },
    shop: { name: "Sharma General Store — Malviya Nagar", type: "grocery", city: "Jaipur", stateCode: "08", branchCode: "MNR" },
    initialData: { sampleProducts: true, customers: [{ name: "Kavita", phone: "9811000010", openingBalancePaise: 12000 }], suppliers: [] },
  });
  const others = [
    { name: "Gupta Kirana", owner: "Ravi Gupta", mobile: "9876511111", type: "grocery", city: "Lucknow", state: "09", plan: "TRIAL", valid: addDays(today, 5), agencyId: agency.id },
    { name: "Verma Paan Bhandar", owner: "Sunil Verma", mobile: "9876522222", type: "paan", city: "Varanasi", state: "09", plan: "BASIC", valid: addDays(today, -3), agencyId: null },
    { name: "Mehta Stationers", owner: "Pooja Mehta", mobile: "9876533333", type: "stationery", city: "Ahmedabad", state: "24", plan: "BASIC", valid: addDays(today, 200), agencyId: null },
    { name: "Chai Point Cafe", owner: "Arjun Rao", mobile: "9876544444", type: "cafe", city: "Bengaluru", state: "29", plan: "TRIAL", valid: addDays(today, 21), agencyId: agency.id },
  ] as const;
  for (const o of others) {
    await createShop(actx, {
      tenant: { mode: "new", name: o.name, agencyId: o.agencyId, plan: o.plan, validUntil: o.valid > today ? o.valid : addDays(today, 30) },
      owner: { mode: "new", name: o.owner, mobile: o.mobile, email: null, password: "dukaan123" },
      shop: { name: o.name, type: o.type, city: o.city, stateCode: o.state },
      initialData: { sampleProducts: true, customers: [], suppliers: [] },
    });
    if (o.valid < today) {
      // Simulate a licence that ran out (the console shows it as Expired, the shop goes read-only).
      const t = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.name, o.name)).get();
      await db.update(licenses).set({ validUntil: o.valid }).where(eq(licenses.tenantId, t!.id));
    }
  }

  await runDailyJobs(db, env, clock, logger);
  const biz = await db.select().from(businesses).where(eq(businesses.id, businessId)).get();
  console.log(`\n✓ Seeded "${biz?.name}" (+ Malviya Nagar branch) with ${products.length} products, 3 customers, 2 suppliers and ${sales} sales over 30 days,`);
  console.log(`  plus ${others.length} more tenants and 1 agency.`);
  console.log(`  Super admin: ${SUPER_ADMIN_MOBILE} / admin12345  →  /admin`);
  console.log(`  Owner login: ${OWNER_MOBILE} / dukaan123   ·   Staff login: 9876500001 / staff1234   ·   Other owners: 98765 11111…44444 / dukaan123\n`);
  await proxy.dispose();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
