/**
 * Tenancy building blocks shared by self-signup, the owner's "add branch" flow and the
 * super admin console. Hierarchy: agency (optional) → tenant (owner organisation, holds the
 * licence) → shops/branches (businesses — each with its own stock, sales and khata).
 */
import { addDays, todayIst } from "@/lib/dates";
import { LICENSE_PLANS, type LicensePlan, type LicenseStatus } from "@/lib/domain";
import { newId } from "@/lib/ids";
import type { Db } from "@/server/db/client";
import { licenseEvents, licenses, tenants } from "@/server/db/schema";
import type { Stmt } from "./engine";

export interface NewTenant {
  tenantId: string;
  name: string;
  ownerUserId: string;
  agencyId?: string | null;
  plan?: LicensePlan;
  status?: LicenseStatus;
  /** Defaults to today + plan days. `null` = no end date. */
  validUntil?: string | null;
  maxBranches?: number;
  maxUsers?: number;
  note?: string | null;
  actorUserId: string | null;
  now: number;
}

export function newTenantStmts(db: Db, t: NewTenant): Stmt[] {
  const plan = t.plan ?? "TRIAL";
  const p = LICENSE_PLANS[plan];
  const validUntil = t.validUntil === undefined ? addDays(todayIst(t.now), p.days) : t.validUntil;
  const license = {
    plan,
    status: t.status ?? (plan === "TRIAL" ? "TRIAL" : "ACTIVE"),
    maxBranches: t.maxBranches ?? p.maxBranches,
    maxUsers: t.maxUsers ?? p.maxUsers,
    validUntil,
  };
  return [
    db.insert(tenants).values({
      id: t.tenantId,
      name: t.name,
      agencyId: t.agencyId ?? null,
      ownerUserId: t.ownerUserId,
      status: "ACTIVE",
      createdAt: t.now,
      updatedAt: t.now,
    }),
    db.insert(licenses).values({ id: newId(t.now), tenantId: t.tenantId, ...license, note: t.note ?? null, updatedBy: t.actorUserId, createdAt: t.now, updatedAt: t.now }),
    db.insert(licenseEvents).values({ id: newId(t.now), tenantId: t.tenantId, action: "LICENSE_CREATED", afterData: license, note: t.note ?? null, actorUserId: t.actorUserId, createdAt: t.now }),
  ];
}
