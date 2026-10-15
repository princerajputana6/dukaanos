import { Hono, type Context } from "hono";

import {
  adminListSchema,
  adminResetPasswordSchema,
  adminUserUpdateSchema,
  agencySchema,
  createShopSchema,
  updateLicenseSchema,
  updateShopSchema,
  updateTenantSchema,
  aiBudgetSchema,
} from "@/schemas/platform";
import { updateLeadSchema } from "@/schemas/marketing";
import * as admin from "@/server/services/admin";
import * as leads from "@/server/services/leads";
import { body, ok, query } from "../respond";
import { requireSuperAdmin, requireUser } from "../middleware";
import type { AppEnv } from "../types";

function actx(c: Context<AppEnv>): admin.AdminContext {
  const s = c.get("session")!;
  return {
    db: c.get("db"),
    env: c.env,
    actorUserId: s.user.id,
    actorName: s.user.name,
    ip: c.get("ip"),
    requestId: c.get("requestId"),
    now: c.get("now"),
    logger: c.get("logger").child({ admin: s.user.id }),
  };
}

/** Platform super admin console API. Every route requires platform_role = SUPER_ADMIN. */
export const adminRoutes = new Hono<AppEnv>()
  .use("*", requireUser, requireSuperAdmin)
  .get("/overview", async (c) => ok(c, await admin.overview(actx(c))))
  .get("/ai-usage", async (c) => ok(c, await admin.aiUsage(actx(c), Math.min(90, Math.max(1, Number(c.req.query("days") ?? 30))))))
  .put("/ai-budget/:businessId", async (c) => {
    const b = await body(c, aiBudgetSchema);
    return ok(c, await admin.setAiBudget(actx(c), c.req.param("businessId"), { monthlyCapMicros: b.monthlyCapRupees == null ? null : Math.round(b.monthlyCapRupees * 1_000_000), killSwitch: b.killSwitch, alertBp: b.alertPct * 100 }));
  })
  .get("/leads", async (c) => ok(c, await leads.listLeads(actx(c), query(c, adminListSchema))))
  .patch("/leads/:id", async (c) => ok(c, await leads.updateLead(actx(c), c.req.param("id"), await body(c, updateLeadSchema))))
  .get("/tenants", async (c) => ok(c, await admin.listTenants(actx(c), query(c, adminListSchema))))
  .get("/tenants/:id", async (c) => ok(c, await admin.getTenant(actx(c), c.req.param("id"))))
  .get("/tenants/:id/shops", async (c) => ok(c, await admin.tenantShopOptions(actx(c), c.req.param("id"))))
  .patch("/tenants/:id", async (c) => ok(c, await admin.updateTenant(actx(c), c.req.param("id"), await body(c, updateTenantSchema))))
  .patch("/tenants/:id/license", async (c) => ok(c, await admin.updateLicense(actx(c), c.req.param("id"), await body(c, updateLicenseSchema))))
  .get("/shops", async (c) => ok(c, await admin.listShops(actx(c), query(c, adminListSchema))))
  .post("/shops", async (c) => ok(c, await admin.createShop(actx(c), await body(c, createShopSchema)), 201))
  .patch("/shops/:id", async (c) => ok(c, await admin.updateShop(actx(c), c.req.param("id"), await body(c, updateShopSchema))))
  .get("/agencies", async (c) => ok(c, await admin.listAgencies(actx(c))))
  .post("/agencies", async (c) => ok(c, await admin.saveAgency(actx(c), await body(c, agencySchema)), 201))
  .patch("/agencies/:id", async (c) => ok(c, await admin.saveAgency(actx(c), await body(c, agencySchema), c.req.param("id"))))
  .get("/users", async (c) => ok(c, await admin.listUsers(actx(c), query(c, adminListSchema))))
  .get("/users/:id/memberships", async (c) => ok(c, await admin.getUserMemberships(actx(c), c.req.param("id"))))
  .patch("/users/:id", async (c) => ok(c, await admin.updateUser(actx(c), c.req.param("id"), await body(c, adminUserUpdateSchema))))
  .post("/users/:id/reset-password", async (c) => ok(c, await admin.resetUserPassword(actx(c), c.req.param("id"), (await body(c, adminResetPasswordSchema)).password)))
  .get("/audit", async (c) => ok(c, await admin.listPlatformAudit(actx(c), query(c, adminListSchema))));

