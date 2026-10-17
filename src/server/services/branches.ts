/**
 * Branches (owner side). A branch is a full shop — its own stock, sales, khata and staff —
 * belonging to the same tenant and licence. Owners switch between them with the business switcher.
 */
import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { ref } from "@/server/db/sql";
import type { z } from "zod";
import { todayIst } from "@/lib/dates";
import { effectiveLicenseStatus, LICENSE_PLANS, type LicensePlan } from "@/lib/domain";
import { newId } from "@/lib/ids";
import {
  businessMembers,
  businesses,
  businessSettings,
  gstSettings,
  licenses,
  productAliases,
  productCategories,
  products,
  productUnits,
  tenants,
} from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import type { createBranchSchema } from "@/schemas/platform";
import { newBusinessStmts } from "./auth";
import { activeBranchSubs, linkPaidBranch } from "./billing";
import { requirePermission, type ServiceContext } from "./context";
import { auditStmt, commit, type Stmt } from "./engine";

async function tenantOf(ctx: ServiceContext) {
  const b = await ctx.db.select({ tenantId: businesses.tenantId }).from(businesses).where(eq(businesses.id, ctx.businessId)).get();
  if (!b?.tenantId) throw notFound("Account");
  const t = await ctx.db.select().from(tenants).where(eq(tenants.id, b.tenantId)).get();
  const l = await ctx.db.select().from(licenses).where(eq(licenses.tenantId, b.tenantId)).get();
  if (!t) throw notFound("Account");
  return { tenant: t, license: l ?? null };
}

export async function listBranches(ctx: ServiceContext) {
  const { tenant, license } = await tenantOf(ctx);
  const today = todayIst(ctx.now);
  const rows = await ctx.db
    .select({
      id: businesses.id,
      name: businesses.name,
      branchCode: businesses.branchCode,
      city: businesses.city,
      status: businesses.status,
      createdAt: businesses.createdAt,
      products: sql<number>`(select count(*) from products p where p.business_id = ${ref(businesses.id)} and p.is_active = 1)`,
      salesTodayPaise: sql<number>`(select coalesce(sum(s.total_paise), 0) from sales s where s.business_id = ${ref(businesses.id)} and s.status = 'COMPLETED' and s.txn_date = ${today})`,
      isMember: sql<number>`exists (select 1 from business_members m where m.business_id = ${ref(businesses.id)} and m.user_id = ${ctx.userId} and m.is_active = 1)`,
    })
    .from(businesses)
    .where(and(eq(businesses.tenantId, tenant.id), ne(businesses.status, "ARCHIVED")))
    .orderBy(businesses.createdAt);
  const used = rows.length;
  return {
    tenant: { id: tenant.id, name: tenant.name, isOwner: tenant.ownerUserId === ctx.userId },
    license: license
      ? {
          plan: license.plan as LicensePlan,
          planLabel: LICENSE_PLANS[license.plan as LicensePlan]?.label ?? license.plan,
          status: effectiveLicenseStatus(license, today),
          validUntil: license.validUntil,
          maxBranches: license.maxBranches,
          maxUsers: license.maxUsers,
        }
      : null,
    usedBranches: used,
    branches: rows.map((r) => ({ ...r, products: Number(r.products), salesTodayPaise: Number(r.salesTodayPaise), isMember: Boolean(r.isMember), isCurrent: r.id === ctx.businessId })),
  };
}

type CreateBranchInput = z.output<typeof createBranchSchema>;

/** Number of non-archived shops a tenant has. */
export async function branchCount(db: ServiceContext["db"], tenantId: string): Promise<number> {
  const r = await db.select({ n: count() }).from(businesses).where(and(eq(businesses.tenantId, tenantId), ne(businesses.status, "ARCHIVED"))).get();
  return Number(r?.n ?? 0);
}

export async function createBranch(ctx: ServiceContext, input: CreateBranchInput) {
  requirePermission(ctx, "settings.manage");
  const { tenant, license } = await tenantOf(ctx);
  if (tenant.ownerUserId !== ctx.userId) throw new AppError("FORBIDDEN", "Only the account owner can add branches.");
  if (!license) throw new AppError("LICENSE_INACTIVE", "No licence found for this account.");
  const used = await branchCount(ctx.db, tenant.id);
  // Effective allowance = plan's base branches + any active paid branch subscriptions.
  const paid = await activeBranchSubs(ctx.db, tenant.id);
  if (used >= license.maxBranches + paid) {
    throw new AppError("LIMIT_REACHED", `Your ${LICENSE_PLANS[license.plan as LicensePlan]?.label ?? license.plan} plan allows ${license.maxBranches} branch${license.maxBranches === 1 ? "" : "es"}. Add another branch from Settings → Branches to continue.`);
  }
  const isPaidBranch = used >= license.maxBranches;
  const source = await ctx.db.select().from(businesses).where(eq(businesses.id, ctx.businessId)).get();
  const [srcSettings, srcGst] = await Promise.all([
    ctx.db.select().from(businessSettings).where(eq(businessSettings.businessId, ctx.businessId)).get(),
    ctx.db.select().from(gstSettings).where(eq(gstSettings.businessId, ctx.businessId)).get(),
  ]);
  const businessId = newId(ctx.now);
  const branchCode = input.branchCode ?? `BR-${used + 1}`;
  const stmts: Stmt[] = [
    ...newBusinessStmts(ctx.db, {
      businessId,
      userId: ctx.userId,
      tenantId: tenant.id,
      branchCode,
      name: input.name,
      type: source?.type ?? "other",
      city: input.city ?? source?.city ?? null,
      stateCode: input.stateCode ?? source?.stateCode ?? null,
      onboarded: true,
      now: ctx.now,
    }),
  ];
  // Same operating preferences as the current shop; GSTIN only if the branch is in the same state.
  if (srcSettings) {
    const { businessId: _b, updatedAt: _u, ...rest } = srcSettings;
    stmts.push(ctx.db.update(businessSettings).set({ ...rest, invoicePrefix: branchCode.replace(/[^A-Z0-9]/g, "").slice(0, 8) || rest.invoicePrefix, updatedAt: ctx.now }).where(eq(businessSettings.businessId, businessId)));
  }
  const sameState = !input.stateCode || input.stateCode === srcGst?.stateCode;
  if (srcGst && sameState) {
    stmts.push(ctx.db.update(gstSettings).set({ gstin: srcGst.gstin, legalName: srcGst.legalName, stateCode: srcGst.stateCode, registrationStatus: srcGst.registrationStatus, updatedAt: ctx.now }).where(eq(gstSettings.businessId, businessId)));
  }
  stmts.push(auditStmt(ctx, { action: "BRANCH_CREATED", entityType: "business", entityId: businessId, summary: `Added branch ${input.name} (${branchCode})`, after: input }));
  await commit(ctx, stmts, null);
  // A paid branch is tied to a subscription so that, if payment lapses, this branch (not the
  // plan's free branches) is the one suspended.
  if (isPaidBranch) await linkPaidBranch(ctx.db, tenant.id, businessId, ctx.now);

  let copied = 0;
  if (input.copyCatalogue) copied = await copyCatalogue(ctx, ctx.businessId, businessId);
  return { businessId, branchCode, copiedProducts: copied };
}

/**
 * Copies products (prices, GST, aliases, packs, categories) to another shop of the same tenant,
 * with ZERO stock — every branch counts its own opening stock.
 */
export async function copyCatalogue(ctx: ServiceContext, fromBusinessId: string, toBusinessId: string): Promise<number> {
  const [prods, cats, aliases, units] = await Promise.all([
    ctx.db.select().from(products).where(and(eq(products.businessId, fromBusinessId), eq(products.isActive, true))),
    ctx.db.select().from(productCategories).where(eq(productCategories.businessId, fromBusinessId)),
    ctx.db.select().from(productAliases).where(eq(productAliases.businessId, fromBusinessId)),
    ctx.db.select().from(productUnits).where(eq(productUnits.businessId, fromBusinessId)),
  ]);
  const catMap = new Map(cats.map((c) => [c.id, newId(ctx.now)]));
  const target: ServiceContext = { ...ctx, businessId: toBusinessId };
  if (cats.length) await commit(target, cats.map((c) => ctx.db.insert(productCategories).values({ id: catMap.get(c.id)!, businessId: toBusinessId, name: c.name, createdAt: ctx.now })), null);
  for (let i = 0; i < prods.length; i += 25) {
    const chunk = prods.slice(i, i + 25);
    const stmts: Stmt[] = [];
    for (const p of chunk) {
      const id = newId(ctx.now);
      const { id: _id, businessId: _bid, createdAt: _c, updatedAt: _u, imageKey: _img, ...rest } = p;
      stmts.push(
        ctx.db.insert(products).values({
          ...rest,
          id,
          businessId: toBusinessId,
          categoryId: p.categoryId ? (catMap.get(p.categoryId) ?? null) : null,
          supplierId: null,
          openingStockMilli: 0,
          currentStockMilli: 0,
          createdBy: ctx.userId,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        }),
      );
      for (const a of aliases.filter((x) => x.productId === p.id)) stmts.push(ctx.db.insert(productAliases).values({ id: newId(ctx.now), businessId: toBusinessId, productId: id, alias: a.alias, aliasNorm: a.aliasNorm, createdAt: ctx.now }));
      for (const u of units.filter((x) => x.productId === p.id)) stmts.push(ctx.db.insert(productUnits).values({ id: newId(ctx.now), businessId: toBusinessId, productId: id, name: u.name, factorMilli: u.factorMilli, createdAt: ctx.now }));
    }
    await commit(target, stmts, null);
  }
  if (prods.length) {
    await commit(target, [auditStmt(target, { action: "CATALOGUE_COPIED", entityType: "product", entityId: null, summary: `Copied ${prods.length} products (without stock) from another branch` })], null);
  }
  return prods.length;
}

/** Active users across all branches of a tenant (for the licence user limit). */
export async function tenantUserCount(db: ServiceContext["db"], tenantId: string): Promise<number> {
  const shopIds = (await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.tenantId, tenantId))).map((b) => b.id);
  if (!shopIds.length) return 0;
  const r = await db
    .select({ n: sql<number>`count(distinct ${businessMembers.userId})` })
    .from(businessMembers)
    .where(and(inArray(businessMembers.businessId, shopIds), eq(businessMembers.isActive, true)))
    .get();
  return Number(r?.n ?? 0);
}

