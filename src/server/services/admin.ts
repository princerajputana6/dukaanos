/**
 * Super admin (platform) services: every tenant, shop/branch, agency, owner and licence.
 * Every change is recorded in platform_audit_logs; changes inside a shop are also written to
 * that shop's own audit log (source SYSTEM) so the owner can see what Suvakta staff did.
 */
import { and, desc, eq, gte, inArray, like, ne, or, sql, type SQL } from "drizzle-orm";
import { ref } from "@/server/db/sql";
import type { z } from "zod";
import { addDays, todayIst } from "@/lib/dates";
import { effectiveLicenseStatus, LICENSE_PLANS, ROLE_PERMISSIONS, type LicensePlan, type LicenseStatus, type Permission } from "@/lib/domain";
import { newId } from "@/lib/ids";
import { escapeLike } from "@/lib/text";
import { hashPassword } from "@/server/auth/password";
import { deleteUserSessions } from "@/server/auth/session";
import type { Db } from "@/server/db/client";
import {
  agencies,
  auditLogs,
  businesses,
  businessMembers,
  gstSettings,
  licenseEvents,
  licenses,
  platformAuditLogs,
  quoteRequests,
  roles,
  sales,
  tenants,
  users,
} from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import type { Logger } from "@/server/lib/logger";
import type {
  adminListSchema,
  adminUserUpdateSchema,
  agencySchema,
  createShopSchema,
  updateLicenseSchema,
  updateShopSchema,
  updateTenantSchema,
} from "@/schemas/platform";
import { newBusinessStmts } from "./auth";
import { branchCount, copyCatalogue, tenantUserCount } from "./branches";
import type { ServiceContext } from "./context";
import { createCustomer } from "./customers";
import type { Stmt } from "./engine";
import { addSampleProducts, importProductsCsv } from "./products";
import { createSupplier } from "./suppliers";
import { newTenantStmts } from "./tenancy";

export interface AdminContext {
  db: Db;
  env: Env;
  actorUserId: string;
  actorName: string;
  ip: string | null;
  requestId: string;
  now: number;
  logger: Logger;
}

type ListInput = z.output<typeof adminListSchema>;

function audit(ctx: AdminContext, action: string, targetType: string, targetId: string | null, summary: string, data?: unknown): Stmt {
  return ctx.db.insert(platformAuditLogs).values({ id: newId(ctx.now), actorUserId: ctx.actorUserId, action, targetType, targetId, summary: summary.slice(0, 500), data: data ?? null, ip: ctx.ip, createdAt: ctx.now });
}

/** Mirror an admin action into the shop's own audit log so owners can see it. */
function shopAudit(ctx: AdminContext, businessId: string, action: string, summary: string, after?: unknown): Stmt {
  return ctx.db.insert(auditLogs).values({
    id: newId(ctx.now),
    businessId,
    userId: ctx.actorUserId,
    action,
    entityType: "business",
    entityId: businessId,
    summary: `${summary} (by Suvakta support)`,
    afterData: after ?? null,
    source: "SYSTEM",
    requestId: ctx.requestId,
    ip: ctx.ip,
    createdAt: ctx.now,
  });
}

async function run(ctx: AdminContext, stmts: Stmt[]) {
  if (stmts.length) await ctx.db.batch(stmts as [Stmt, ...Stmt[]]);
}

const page = (cursor?: string) => Number(cursor ?? 0) || 0;
const like_ = (q: string) => `%${escapeLike(q)}%`;

// ─── Overview ────────────────────────────────────────────────────────────────

export async function overview(ctx: AdminContext) {
  const today = todayIst(ctx.now);
  const in7 = addDays(today, 7);
  const since30 = addDays(today, -29);
  const since30Ms = ctx.now - 30 * 86_400_000;
  const [ag, tn, shops, usersN, lic, signups, gmv, activeShops, newLeads] = await Promise.all([
    ctx.db.select({ n: sql<number>`count(*)` }).from(agencies).get(),
    ctx.db.select({ total: sql<number>`count(*)`, suspended: sql<number>`sum(case when ${tenants.status} = 'SUSPENDED' then 1 else 0 end)` }).from(tenants).get(),
    ctx.db
      .select({
        total: sql<number>`sum(case when ${businesses.status} <> 'ARCHIVED' then 1 else 0 end)`,
        suspended: sql<number>`sum(case when ${businesses.status} = 'SUSPENDED' then 1 else 0 end)`,
        branches: sql<number>`sum(case when ${businesses.status} <> 'ARCHIVED' and coalesce(${businesses.branchCode}, 'MAIN') <> 'MAIN' then 1 else 0 end)`,
      })
      .from(businesses)
      .get(),
    ctx.db.select({ total: sql<number>`count(*)`, owners: sql<number>`(select count(distinct owner_user_id) from tenants)`, admins: sql<number>`sum(case when ${users.platformRole} = 'SUPER_ADMIN' then 1 else 0 end)` }).from(users).get(),
    ctx.db.select({ plan: licenses.plan, status: licenses.status, validUntil: licenses.validUntil }).from(licenses),
    ctx.db
      .select({ date: sql<string>`date(${tenants.createdAt} / 1000 + 19800, 'unixepoch')`, n: sql<number>`count(*)` })
      .from(tenants)
      .where(gte(tenants.createdAt, since30Ms))
      .groupBy(sql`1`),
    ctx.db
      .select({
        today: sql<number>`coalesce(sum(case when ${sales.txnDate} = ${today} then ${sales.totalPaise} else 0 end), 0)`,
        last30: sql<number>`coalesce(sum(${sales.totalPaise}), 0)`,
        bills30: sql<number>`count(*)`,
      })
      .from(sales)
      .where(and(eq(sales.status, "COMPLETED"), gte(sales.txnDate, since30)))
      .get(),
    ctx.db.select({ n: sql<number>`count(distinct ${sales.businessId})` }).from(sales).where(gte(sales.txnDate, addDays(today, -6))).get(),
    ctx.db.select({ n: sql<number>`count(*)` }).from(quoteRequests).where(eq(quoteRequests.status, "NEW")).get(),
  ]);
  const byStatus: Record<LicenseStatus, number> = { TRIAL: 0, ACTIVE: 0, SUSPENDED: 0, EXPIRED: 0, CANCELLED: 0 };
  const byPlan: Record<string, number> = {};
  let expiringSoon = 0;
  for (const l of lic) {
    const s = effectiveLicenseStatus(l, today);
    byStatus[s]++;
    byPlan[l.plan] = (byPlan[l.plan] ?? 0) + 1;
    if ((s === "ACTIVE" || s === "TRIAL") && l.validUntil && l.validUntil <= in7) expiringSoon++;
  }
  const signupBy = new Map(signups.map((s) => [s.date, Number(s.n)]));
  const series = Array.from({ length: 30 }, (_, i) => {
    const date = addDays(since30, i);
    return { date, value: signupBy.get(date) ?? 0 };
  });
  const n = (v: unknown) => Number(v ?? 0);
  return {
    counts: {
      agencies: n(ag?.n),
      tenants: n(tn?.total),
      suspendedTenants: n(tn?.suspended),
      shops: n(shops?.total),
      branches: n(shops?.branches),
      suspendedShops: n(shops?.suspended),
      users: n(usersN?.total),
      owners: n(usersN?.owners),
      superAdmins: n(usersN?.admins),
      activeShops7d: n(activeShops?.n),
      newLeads: n(newLeads?.n),
    },
    licenses: { byStatus, byPlan, expiringSoon },
    gmv: { todayPaise: n(gmv?.today), last30Paise: n(gmv?.last30), bills30: n(gmv?.bills30) },
    signups: series,
  };
}

// ─── Tenants & licences ─────────────────────────────────────────────────────

export async function listTenants(ctx: AdminContext, input: ListInput) {
  const today = todayIst(ctx.now);
  const conds: SQL[] = [];
  if (input.q) conds.push(or(like(tenants.name, like_(input.q)), like(users.name, like_(input.q)), like(users.mobile, like_(input.q)))!);
  if (input.agencyId) conds.push(eq(tenants.agencyId, input.agencyId));
  if (input.status === "SUSPENDED") conds.push(eq(tenants.status, "SUSPENDED"));
  if (input.status === "EXPIRED") conds.push(sql`(${licenses.status} = 'EXPIRED' or (${licenses.status} in ('ACTIVE','TRIAL') and ${licenses.validUntil} < ${today}))`);
  if (input.status === "TRIAL") conds.push(sql`${licenses.status} = 'TRIAL' and (${licenses.validUntil} is null or ${licenses.validUntil} >= ${today})`);
  if (input.status === "EXPIRING") conds.push(sql`${licenses.status} in ('ACTIVE','TRIAL') and ${licenses.validUntil} between ${today} and ${addDays(today, 7)}`);
  const offset = page(input.cursor);
  const rows = await ctx.db
    .select({
      id: tenants.id,
      name: tenants.name,
      status: tenants.status,
      createdAt: tenants.createdAt,
      ownerId: users.id,
      ownerName: users.name,
      ownerMobile: users.mobile,
      agencyId: agencies.id,
      agencyName: agencies.name,
      plan: licenses.plan,
      licenseStatus: licenses.status,
      validUntil: licenses.validUntil,
      maxBranches: licenses.maxBranches,
      maxUsers: licenses.maxUsers,
      branches: sql<number>`(select count(*) from businesses b where b.tenant_id = ${ref(tenants.id)} and b.status <> 'ARCHIVED')`,
      lastSaleAt: sql<number | null>`(select max(s.created_at) from sales s join businesses b on b.id = s.business_id where b.tenant_id = ${ref(tenants.id)})`,
    })
    .from(tenants)
    .innerJoin(users, eq(users.id, tenants.ownerUserId))
    .leftJoin(agencies, eq(agencies.id, tenants.agencyId))
    .leftJoin(licenses, eq(licenses.tenantId, tenants.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(tenants.createdAt))
    .limit(input.limit + 1)
    .offset(offset);
  return {
    items: rows.slice(0, input.limit).map((r) => ({
      ...r,
      branches: Number(r.branches),
      effectiveLicenseStatus: r.licenseStatus ? effectiveLicenseStatus({ status: r.licenseStatus, validUntil: r.validUntil }, today) : null,
    })),
    nextCursor: rows.length > input.limit ? String(offset + input.limit) : null,
  };
}

export async function getTenant(ctx: AdminContext, tenantId: string) {
  const today = todayIst(ctx.now);
  const t = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
  if (!t) throw notFound("Tenant");
  const since30 = addDays(today, -29);
  const [owner, agency, license, events, shops] = await Promise.all([
    ctx.db.select({ id: users.id, name: users.name, mobile: users.mobile, email: users.email, lastLoginAt: users.lastLoginAt, isActive: users.isActive }).from(users).where(eq(users.id, t.ownerUserId)).get(),
    t.agencyId ? ctx.db.select().from(agencies).where(eq(agencies.id, t.agencyId)).get() : Promise.resolve(undefined),
    ctx.db.select().from(licenses).where(eq(licenses.tenantId, tenantId)).get(),
    ctx.db
      .select({ id: licenseEvents.id, action: licenseEvents.action, beforeData: licenseEvents.beforeData, afterData: licenseEvents.afterData, note: licenseEvents.note, createdAt: licenseEvents.createdAt, actorName: users.name })
      .from(licenseEvents)
      .leftJoin(users, eq(users.id, licenseEvents.actorUserId))
      .where(eq(licenseEvents.tenantId, tenantId))
      .orderBy(desc(licenseEvents.createdAt))
      .limit(30),
    shopRows(ctx, [eq(businesses.tenantId, tenantId)], since30, 100),
  ]);
  const members = await ctx.db
    .select({ userId: users.id, name: users.name, mobile: users.mobile, isActive: businessMembers.isActive, roleName: roles.name, shopId: businesses.id, shopName: businesses.name, lastLoginAt: users.lastLoginAt })
    .from(businessMembers)
    .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
    .innerJoin(users, eq(users.id, businessMembers.userId))
    .innerJoin(roles, eq(roles.id, businessMembers.roleId))
    .where(eq(businesses.tenantId, tenantId))
    .orderBy(users.name);
  return {
    tenant: t,
    owner: owner ?? null,
    agency: agency ?? null,
    license: license ? { ...license, effectiveStatus: effectiveLicenseStatus(license, today) } : null,
    usage: { branches: shops.filter((s) => s.status !== "ARCHIVED").length, users: await tenantUserCount(ctx.db, tenantId) },
    licenseEvents: events,
    shops,
    members,
  };
}

export async function updateTenant(ctx: AdminContext, tenantId: string, input: z.output<typeof updateTenantSchema>) {
  const t = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
  if (!t) throw notFound("Tenant");
  if (input.agencyId) {
    const a = await ctx.db.select({ id: agencies.id }).from(agencies).where(eq(agencies.id, input.agencyId)).get();
    if (!a) throw new AppError("VALIDATION_ERROR", "Agency not found.");
  }
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const stmts: Stmt[] = [ctx.db.update(tenants).set({ ...patch, updatedAt: ctx.now }).where(eq(tenants.id, tenantId))];
  const action = input.status === "SUSPENDED" ? "TENANT_SUSPENDED" : input.status === "ACTIVE" && t.status !== "ACTIVE" ? "TENANT_REACTIVATED" : "TENANT_UPDATED";
  stmts.push(audit(ctx, action, "tenant", tenantId, `${action.replace("TENANT_", "").toLowerCase().replace("_", " ")}: ${t.name}`, { before: pickKeys(t, Object.keys(patch)), after: patch }));
  if (input.status && input.status !== t.status) {
    const shopIds = (await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.tenantId, tenantId))).map((b) => b.id);
    for (const id of shopIds) stmts.push(shopAudit(ctx, id, action, input.status === "SUSPENDED" ? "Account suspended" : "Account reactivated"));
  }
  await run(ctx, stmts);
  return { id: tenantId };
}

export async function updateLicense(ctx: AdminContext, tenantId: string, input: z.output<typeof updateLicenseSchema>) {
  const t = await ctx.db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
  if (!t) throw notFound("Tenant");
  const before = await ctx.db.select().from(licenses).where(eq(licenses.tenantId, tenantId)).get();
  const patch: Partial<typeof licenses.$inferInsert> = {};
  if (input.plan && input.plan !== before?.plan) {
    // Changing plan applies that plan's limits unless limits are given explicitly.
    patch.plan = input.plan;
    patch.maxBranches = LICENSE_PLANS[input.plan].maxBranches;
    patch.maxUsers = LICENSE_PLANS[input.plan].maxUsers;
    if (input.plan !== "TRIAL" && before?.status === "TRIAL" && !input.status) patch.status = "ACTIVE";
  }
  if (input.status) patch.status = input.status;
  if (input.maxBranches !== undefined) patch.maxBranches = input.maxBranches;
  if (input.maxUsers !== undefined) patch.maxUsers = input.maxUsers;
  if (input.validUntil !== undefined) patch.validUntil = input.validUntil;
  if (input.note !== undefined) patch.note = input.note;
  // Re-activating an expired licence without a new date would immediately expire again.
  const today = todayIst(ctx.now);
  const nextValid = patch.validUntil !== undefined ? patch.validUntil : before?.validUntil;
  const nextStatus = patch.status ?? before?.status;
  if ((nextStatus === "ACTIVE" || nextStatus === "TRIAL") && nextValid && nextValid < today) {
    throw new AppError("VALIDATION_ERROR", "Set a 'valid until' date in the future to activate this licence.");
  }
  const stmts: Stmt[] = [];
  if (before) {
    stmts.push(ctx.db.update(licenses).set({ ...patch, updatedBy: ctx.actorUserId, updatedAt: ctx.now }).where(eq(licenses.tenantId, tenantId)));
  } else {
    const plan = (patch.plan ?? "BASIC") as LicensePlan;
    stmts.push(
      ctx.db.insert(licenses).values({
        id: newId(ctx.now),
        tenantId,
        plan,
        status: patch.status ?? "ACTIVE",
        maxBranches: patch.maxBranches ?? LICENSE_PLANS[plan].maxBranches,
        maxUsers: patch.maxUsers ?? LICENSE_PLANS[plan].maxUsers,
        validUntil: patch.validUntil ?? null,
        note: patch.note ?? null,
        updatedBy: ctx.actorUserId,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      }),
    );
  }
  const beforeView = before ? pickKeys(before, ["plan", "status", "maxBranches", "maxUsers", "validUntil"]) : null;
  stmts.push(
    ctx.db.insert(licenseEvents).values({ id: newId(ctx.now), tenantId, action: "LICENSE_UPDATED", beforeData: beforeView, afterData: patch, note: input.note ?? null, actorUserId: ctx.actorUserId, createdAt: ctx.now }),
    audit(ctx, "LICENSE_UPDATED", "tenant", tenantId, `Licence updated for ${t.name}: ${describePatch(patch)}`, { before: beforeView, after: patch }),
  );
  await run(ctx, stmts);
  return { tenantId };
}

function describePatch(p: Record<string, unknown>): string {
  return Object.entries(p)
    .filter(([k]) => k !== "note")
    .map(([k, v]) => `${k}=${v ?? "none"}`)
    .join(", ") || "note";
}

// ─── Shops / branches ───────────────────────────────────────────────────────

async function shopRows(ctx: AdminContext, conds: SQL[], since30: string, limit: number, offset = 0) {
  const rows = await ctx.db
    .select({
      id: businesses.id,
      name: businesses.name,
      branchCode: businesses.branchCode,
      type: businesses.type,
      city: businesses.city,
      status: businesses.status,
      onboardedAt: businesses.onboardedAt,
      createdAt: businesses.createdAt,
      tenantId: businesses.tenantId,
      tenantName: tenants.name,
      products: sql<number>`(select count(*) from products p where p.business_id = ${ref(businesses.id)} and p.is_active = 1)`,
      members: sql<number>`(select count(*) from business_members m where m.business_id = ${ref(businesses.id)} and m.is_active = 1)`,
      sales30Paise: sql<number>`(select coalesce(sum(s.total_paise), 0) from sales s where s.business_id = ${ref(businesses.id)} and s.status = 'COMPLETED' and s.txn_date >= ${since30})`,
      lastSaleAt: sql<number | null>`(select max(s.created_at) from sales s where s.business_id = ${ref(businesses.id)})`,
    })
    .from(businesses)
    .leftJoin(tenants, eq(tenants.id, businesses.tenantId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(businesses.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({ ...r, products: Number(r.products), members: Number(r.members), sales30Paise: Number(r.sales30Paise) }));
}

export async function listShops(ctx: AdminContext, input: ListInput) {
  const conds: SQL[] = [];
  if (input.q) conds.push(or(like(businesses.name, like_(input.q)), like(businesses.city, like_(input.q)), like(tenants.name, like_(input.q)))!);
  if (input.status) conds.push(eq(businesses.status, input.status));
  else conds.push(ne(businesses.status, "ARCHIVED"));
  if (input.tenantId) conds.push(eq(businesses.tenantId, input.tenantId));
  if (input.agencyId) conds.push(eq(tenants.agencyId, input.agencyId));
  const offset = page(input.cursor);
  const rows = await shopRows(ctx, conds, addDays(todayIst(ctx.now), -29), input.limit + 1, offset);
  return { items: rows.slice(0, input.limit), nextCursor: rows.length > input.limit ? String(offset + input.limit) : null };
}

export async function updateShop(ctx: AdminContext, shopId: string, input: z.output<typeof updateShopSchema>) {
  const b = await ctx.db.select().from(businesses).where(eq(businesses.id, shopId)).get();
  if (!b) throw notFound("Shop");
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const action = input.status === "SUSPENDED" ? "SHOP_SUSPENDED" : input.status === "ARCHIVED" ? "SHOP_ARCHIVED" : input.status === "ACTIVE" && b.status !== "ACTIVE" ? "SHOP_REACTIVATED" : "SHOP_UPDATED";
  await run(ctx, [
    ctx.db.update(businesses).set({ ...patch, updatedAt: ctx.now }).where(eq(businesses.id, shopId)),
    audit(ctx, action, "shop", shopId, `${action.replace("SHOP_", "").toLowerCase()}: ${b.name}`, { before: pickKeys(b, Object.keys(patch)), after: patch }),
    shopAudit(ctx, shopId, action, action === "SHOP_SUSPENDED" ? "Shop suspended" : action === "SHOP_REACTIVATED" ? "Shop reactivated" : "Shop details updated", patch),
  ]);
  return { id: shopId };
}

type CreateShopInput = z.output<typeof createShopSchema>;

export interface CreateShopResult {
  tenantId: string;
  shopId: string;
  ownerUserId: string;
  ownerCreated: boolean;
  seeded: { products: number; productErrors: number; customers: number; suppliers: number };
}

/**
 * Creates a shop for a new or existing tenant, with its owner, and loads initial data
 * (sample catalogue, CSV products with opening stock, opening customers & suppliers).
 * The shop is marked onboarded so the owner lands straight on the dashboard.
 */
export async function createShop(ctx: AdminContext, input: CreateShopInput): Promise<CreateShopResult> {
  const now = ctx.now;
  let tenantId: string;
  let ownerUserId: string;
  let ownerCreated = false;
  const stmts: Stmt[] = [];

  if (input.tenant.mode === "existing") {
    const t = await ctx.db.select().from(tenants).where(eq(tenants.id, input.tenant.tenantId)).get();
    if (!t) throw notFound("Tenant");
    const lic = await ctx.db.select().from(licenses).where(eq(licenses.tenantId, t.id)).get();
    const used = await branchCount(ctx.db, t.id);
    if (lic && used >= lic.maxBranches) {
      throw new AppError("LIMIT_REACHED", `${t.name}'s licence allows ${lic.maxBranches} shop${lic.maxBranches === 1 ? "" : "s"}. Raise the branch limit on the licence first.`);
    }
    tenantId = t.id;
    ownerUserId = t.ownerUserId;
  } else {
    const owner = input.owner!;
    const existing = await ctx.db.select().from(users).where(eq(users.mobile, owner.mobile)).get();
    if (owner.mode === "existing") {
      if (!existing) throw new AppError("VALIDATION_ERROR", `No user with mobile ${owner.mobile}.`);
      ownerUserId = existing.id;
    } else {
      if (existing) throw new AppError("MOBILE_TAKEN", `+91 ${owner.mobile} already has an account (${existing.name}). Choose "existing owner".`);
      if (owner.email) {
        const e = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, owner.email)).get();
        if (e) throw new AppError("EMAIL_TAKEN", "That email is already used by another account.");
      }
      ownerUserId = newId(now);
      ownerCreated = true;
      stmts.push(ctx.db.insert(users).values({ id: ownerUserId, name: owner.name, mobile: owner.mobile, email: owner.email ?? null, passwordHash: await hashPassword(owner.password), createdAt: now, updatedAt: now }));
    }
    if (input.tenant.agencyId) {
      const a = await ctx.db.select({ id: agencies.id }).from(agencies).where(eq(agencies.id, input.tenant.agencyId)).get();
      if (!a) throw new AppError("VALIDATION_ERROR", "Agency not found.");
    }
    tenantId = newId(now);
    stmts.push(
      ...newTenantStmts(ctx.db, {
        tenantId,
        name: input.tenant.name,
        ownerUserId,
        agencyId: input.tenant.agencyId ?? null,
        plan: input.tenant.plan,
        validUntil: input.tenant.validUntil === undefined ? undefined : input.tenant.validUntil,
        maxBranches: input.tenant.maxBranches,
        maxUsers: input.tenant.maxUsers,
        note: "Created from super admin",
        actorUserId: ctx.actorUserId,
        now,
      }),
    );
  }

  const shopId = newId(now);
  const used = input.tenant.mode === "existing" ? await branchCount(ctx.db, tenantId) : 0;
  const branchCode = input.shop.branchCode ?? (used === 0 ? "MAIN" : `BR-${used + 1}`);
  stmts.push(
    ...newBusinessStmts(ctx.db, {
      businessId: shopId,
      userId: ownerUserId,
      tenantId,
      branchCode,
      name: input.shop.name,
      type: input.shop.type,
      city: input.shop.city ?? null,
      stateCode: input.shop.stateCode ?? null,
      onboarded: true,
      now,
    }),
  );
  if (input.shop.address) stmts.push(ctx.db.update(businesses).set({ address: input.shop.address }).where(eq(businesses.id, shopId)));
  if (input.shop.gstin) {
    stmts.push(ctx.db.update(gstSettings).set({ gstin: input.shop.gstin, stateCode: input.shop.gstin.slice(0, 2), registrationStatus: "REGISTERED", legalName: input.tenant.mode === "new" ? input.tenant.name : null, updatedAt: now }).where(eq(gstSettings.businessId, shopId)));
  }
  stmts.push(
    audit(ctx, "SHOP_CREATED", "shop", shopId, `Created shop ${input.shop.name} (${branchCode})${input.tenant.mode === "new" ? ` for new account ${input.tenant.name}` : ""}`, { tenantId, shop: input.shop }),
    shopAudit(ctx, shopId, "BUSINESS_CREATED", `Shop ${input.shop.name} created`),
  );
  try {
    await run(ctx, stmts);
  } catch (err) {
    if (String(err).includes("UNIQUE")) throw new AppError("DUPLICATE", "That mobile number or email is already registered.");
    throw err;
  }

  // Initial data is loaded as the owner, through the normal services (validation, stock
  // movements, audit). Source IMPORT marks it as initial data in the shop's audit log.
  const owner = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ownerUserId)).get();
  const sctx: ServiceContext = {
    db: ctx.db,
    env: ctx.env,
    businessId: shopId,
    userId: ownerUserId,
    userName: owner?.name ?? "Owner",
    roleKey: "owner",
    permissions: new Set<Permission>(ROLE_PERMISSIONS.owner),
    source: "IMPORT",
    requestId: ctx.requestId,
    ip: ctx.ip,
    now,
    logger: ctx.logger,
    writable: true,
  };
  const seeded = { products: 0, productErrors: 0, customers: 0, suppliers: 0 };
  const data = input.initialData;
  if (data.copyCatalogueFromShopId) {
    const src = await ctx.db.select({ tenantId: businesses.tenantId }).from(businesses).where(eq(businesses.id, data.copyCatalogueFromShopId)).get();
    if (src?.tenantId !== tenantId) throw new AppError("VALIDATION_ERROR", "You can only copy products from a shop of the same account.");
    seeded.products += await copyCatalogue(sctx, data.copyCatalogueFromShopId, shopId);
  }
  if (data.sampleProducts) seeded.products += (await addSampleProducts(sctx)).created;
  if (data.productsCsv?.trim()) {
    const r = await importProductsCsv(sctx, data.productsCsv, false);
    seeded.products += r.created;
    seeded.productErrors = r.errors.length;
  }
  for (const c of data.customers) {
    await createCustomer(sctx, { name: c.name, phone: c.phone ?? null, openingBalancePaise: c.openingBalancePaise });
    seeded.customers++;
  }
  for (const s of data.suppliers) {
    await createSupplier(sctx, { name: s.name, phone: s.phone ?? null, openingBalancePaise: s.openingBalancePaise });
    seeded.suppliers++;
  }
  return { tenantId, shopId, ownerUserId, ownerCreated, seeded };
}

// ─── Agencies ────────────────────────────────────────────────────────────────

export async function listAgencies(ctx: AdminContext) {
  const today = todayIst(ctx.now);
  return ctx.db
    .select({
      id: agencies.id,
      name: agencies.name,
      contactName: agencies.contactName,
      phone: agencies.phone,
      email: agencies.email,
      city: agencies.city,
      status: agencies.status,
      notes: agencies.notes,
      createdAt: agencies.createdAt,
      tenants: sql<number>`(select count(*) from tenants t where t.agency_id = ${ref(agencies.id)})`,
      shops: sql<number>`(select count(*) from businesses b join tenants t on t.id = b.tenant_id where t.agency_id = ${ref(agencies.id)} and b.status <> 'ARCHIVED')`,
      activeLicenses: sql<number>`(select count(*) from licenses l join tenants t on t.id = l.tenant_id where t.agency_id = ${ref(agencies.id)} and l.status in ('ACTIVE','TRIAL') and (l.valid_until is null or l.valid_until >= ${today}))`,
    })
    .from(agencies)
    .orderBy(agencies.name);
}

export async function saveAgency(ctx: AdminContext, input: z.output<typeof agencySchema>, id?: string) {
  if (id) {
    const a = await ctx.db.select().from(agencies).where(eq(agencies.id, id)).get();
    if (!a) throw notFound("Agency");
    await run(ctx, [
      ctx.db.update(agencies).set({ ...input, updatedAt: ctx.now }).where(eq(agencies.id, id)),
      audit(ctx, "AGENCY_UPDATED", "agency", id, `Updated agency ${input.name}`, { before: a, after: input }),
    ]);
    return { id };
  }
  const newIdV = newId(ctx.now);
  await run(ctx, [
    ctx.db.insert(agencies).values({ id: newIdV, ...input, createdAt: ctx.now, updatedAt: ctx.now }),
    audit(ctx, "AGENCY_CREATED", "agency", newIdV, `Created agency ${input.name}`, input),
  ]);
  return { id: newIdV };
}

// ─── Users / owners ──────────────────────────────────────────────────────────

export async function listUsers(ctx: AdminContext, input: ListInput) {
  const conds: SQL[] = [];
  if (input.q) conds.push(or(like(users.name, like_(input.q)), like(users.mobile, like_(input.q)), like(users.email, like_(input.q)))!);
  if (input.status === "SUPER_ADMIN") conds.push(eq(users.platformRole, "SUPER_ADMIN"));
  if (input.status === "OWNER") conds.push(sql`exists (select 1 from tenants t where t.owner_user_id = ${ref(users.id)})`);
  if (input.status === "DISABLED") conds.push(eq(users.isActive, false));
  const offset = page(input.cursor);
  const rows = await ctx.db
    .select({
      id: users.id,
      name: users.name,
      mobile: users.mobile,
      email: users.email,
      isActive: users.isActive,
      platformRole: users.platformRole,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      shops: sql<number>`(select count(*) from business_members m where m.user_id = ${ref(users.id)} and m.is_active = 1)`,
      ownedTenants: sql<number>`(select count(*) from tenants t where t.owner_user_id = ${ref(users.id)})`,
    })
    .from(users)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(input.limit + 1)
    .offset(offset);
  return {
    items: rows.slice(0, input.limit).map((r) => ({ ...r, shops: Number(r.shops), ownedTenants: Number(r.ownedTenants) })),
    nextCursor: rows.length > input.limit ? String(offset + input.limit) : null,
  };
}

export async function getUserMemberships(ctx: AdminContext, userId: string) {
  return ctx.db
    .select({ shopId: businesses.id, shopName: businesses.name, tenantId: tenants.id, tenantName: tenants.name, roleName: roles.name, isActive: businessMembers.isActive })
    .from(businessMembers)
    .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
    .innerJoin(roles, eq(roles.id, businessMembers.roleId))
    .leftJoin(tenants, eq(tenants.id, businesses.tenantId))
    .where(eq(businessMembers.userId, userId));
}

export async function updateUser(ctx: AdminContext, userId: string, input: z.output<typeof adminUserUpdateSchema>) {
  const u = await ctx.db.select().from(users).where(eq(users.id, userId)).get();
  if (!u) throw notFound("User");
  if (userId === ctx.actorUserId && (input.isActive === false || input.platformRole === null)) {
    throw new AppError("FORBIDDEN", "You can't disable yourself or remove your own super admin access.");
  }
  const patch: Partial<typeof users.$inferInsert> = { updatedAt: ctx.now };
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  if (input.platformRole !== undefined) patch.platformRole = input.platformRole;
  const what = input.isActive === false ? "Disabled" : input.isActive === true ? "Enabled" : input.platformRole ? "Granted super admin to" : "Removed super admin from";
  await run(ctx, [ctx.db.update(users).set(patch).where(eq(users.id, userId)), audit(ctx, "USER_UPDATED", "user", userId, `${what} ${u.name} (+91 ${u.mobile})`, input)]);
  if (input.isActive === false || input.platformRole === null) await deleteUserSessions(ctx.db, userId);
  return { id: userId };
}

export async function resetUserPassword(ctx: AdminContext, userId: string, password: string) {
  const u = await ctx.db.select().from(users).where(eq(users.id, userId)).get();
  if (!u) throw notFound("User");
  await run(ctx, [
    ctx.db.update(users).set({ passwordHash: await hashPassword(password), updatedAt: ctx.now }).where(eq(users.id, userId)),
    audit(ctx, "USER_PASSWORD_RESET", "user", userId, `Reset password for ${u.name} (+91 ${u.mobile})`),
  ]);
  await deleteUserSessions(ctx.db, userId);
  return { id: userId };
}

// ─── Audit ───────────────────────────────────────────────────────────────────

export async function listPlatformAudit(ctx: AdminContext, input: ListInput) {
  const offset = page(input.cursor);
  const conds: SQL[] = [];
  if (input.q) conds.push(like(platformAuditLogs.summary, like_(input.q)));
  if (input.tenantId) conds.push(eq(platformAuditLogs.targetId, input.tenantId));
  const rows = await ctx.db
    .select({ id: platformAuditLogs.id, action: platformAuditLogs.action, targetType: platformAuditLogs.targetType, targetId: platformAuditLogs.targetId, summary: platformAuditLogs.summary, data: platformAuditLogs.data, createdAt: platformAuditLogs.createdAt, actorName: users.name })
    .from(platformAuditLogs)
    .leftJoin(users, eq(users.id, platformAuditLogs.actorUserId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(platformAuditLogs.createdAt))
    .limit(input.limit + 1)
    .offset(offset);
  return { items: rows.slice(0, input.limit), nextCursor: rows.length > input.limit ? String(offset + input.limit) : null };
}

/** Shops of a tenant for pickers (e.g. "copy catalogue from"). */
export async function tenantShopOptions(ctx: AdminContext, tenantId: string) {
  return ctx.db.select({ id: businesses.id, name: businesses.name, branchCode: businesses.branchCode, products: sql<number>`(select count(*) from products p where p.business_id = ${ref(businesses.id)})` }).from(businesses).where(and(eq(businesses.tenantId, tenantId), inArray(businesses.status, ["ACTIVE", "SUSPENDED"])));
}

function pickKeys(obj: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}
