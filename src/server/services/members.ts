/** Team & roles (Settings → Users / Roles). */
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { newId } from "@/lib/ids";
import type { Permission } from "@/lib/domain";
import { hashPassword } from "@/server/auth/password";
import { deleteUserSessions } from "@/server/auth/session";
import { businesses, businessMembers, licenses, rolePermissions, roles, users } from "@/server/db/schema";
import { tenantUserCount } from "./branches";
import { AppError, notFound } from "@/server/lib/errors";
import type { addMemberSchema, roleSchema, updateMemberSchema } from "@/schemas/admin";
import { requirePermission, type ServiceContext } from "./context";
import { auditStmt, commit, type Stmt } from "./engine";

export async function listMembers(ctx: ServiceContext) {
  requirePermission(ctx, "users.manage");
  return ctx.db
    .select({
      memberId: businessMembers.id,
      userId: users.id,
      name: users.name,
      mobile: users.mobile,
      email: users.email,
      lastLoginAt: users.lastLoginAt,
      isActive: businessMembers.isActive,
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
      joinedAt: businessMembers.createdAt,
    })
    .from(businessMembers)
    .innerJoin(users, eq(users.id, businessMembers.userId))
    .innerJoin(roles, eq(roles.id, businessMembers.roleId))
    .where(eq(businessMembers.businessId, ctx.businessId))
    .orderBy(asc(businessMembers.createdAt));
}

async function assertRole(ctx: ServiceContext, roleId: string) {
  const role = await ctx.db
    .select()
    .from(roles)
    .where(and(eq(roles.id, roleId), or(isNull(roles.businessId), eq(roles.businessId, ctx.businessId))))
    .get();
  if (!role) throw new AppError("VALIDATION_ERROR", "Role not found.");
  return role;
}

export async function addMember(ctx: ServiceContext, input: z.output<typeof addMemberSchema>) {
  requirePermission(ctx, "users.manage");
  const role = await assertRole(ctx, input.roleId);
  const existing = await ctx.db.select().from(users).where(eq(users.mobile, input.mobile)).get();
  const stmts: Stmt[] = [];
  let userId: string;
  if (existing) {
    const member = await ctx.db
      .select()
      .from(businessMembers)
      .where(and(eq(businessMembers.businessId, ctx.businessId), eq(businessMembers.userId, existing.id)))
      .get();
    if (member) throw new AppError("DUPLICATE", `${existing.name} is already part of your team.`);
    userId = existing.id;
  } else {
    if (!input.password) throw new AppError("VALIDATION_ERROR", "Set a temporary password for the new staff account.");
    userId = newId(ctx.now);
    stmts.push(
      ctx.db.insert(users).values({ id: userId, name: input.name, mobile: input.mobile, passwordHash: await hashPassword(input.password), createdAt: ctx.now, updatedAt: ctx.now }),
    );
  }
  // Licence user limit (counted across all branches of the tenant).
  const shop = await ctx.db.select({ tenantId: businesses.tenantId }).from(businesses).where(eq(businesses.id, ctx.businessId)).get();
  if (shop?.tenantId) {
    const lic = await ctx.db.select().from(licenses).where(eq(licenses.tenantId, shop.tenantId)).get();
    const used = await tenantUserCount(ctx.db, shop.tenantId);
    const alreadyInTenant = existing
      ? await ctx.db
          .select({ id: businessMembers.id })
          .from(businessMembers)
          .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
          .where(and(eq(businessMembers.userId, existing.id), eq(businesses.tenantId, shop.tenantId), eq(businessMembers.isActive, true)))
          .get()
      : undefined;
    if (lic && !alreadyInTenant && used >= lic.maxUsers) {
      throw new AppError("LIMIT_REACHED", `Your plan allows ${lic.maxUsers} users. Remove someone or contact Suvakta to upgrade.`);
    }
  }
  const memberId = newId(ctx.now);
  stmts.push(
    ctx.db.insert(businessMembers).values({ id: memberId, businessId: ctx.businessId, userId, roleId: role.id, createdAt: ctx.now, updatedAt: ctx.now }),
    auditStmt(ctx, {
      action: "MEMBER_ADDED",
      entityType: "member",
      entityId: memberId,
      summary: `Added ${existing?.name ?? input.name} (+91 ${input.mobile}) as ${role.name}`,
      after: { name: existing?.name ?? input.name, mobile: input.mobile, role: role.name },
    }),
  );
  await commit(ctx, stmts, null);
  return { memberId, userId, existingAccount: Boolean(existing) };
}

async function getMember(ctx: ServiceContext, memberId: string) {
  const m = await ctx.db
    .select({ member: businessMembers, user: users, role: roles })
    .from(businessMembers)
    .innerJoin(users, eq(users.id, businessMembers.userId))
    .innerJoin(roles, eq(roles.id, businessMembers.roleId))
    .where(and(eq(businessMembers.id, memberId), eq(businessMembers.businessId, ctx.businessId)))
    .get();
  if (!m) throw notFound("Team member");
  return m;
}

async function activeOwnerCount(ctx: ServiceContext) {
  const row = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(businessMembers)
    .where(and(eq(businessMembers.businessId, ctx.businessId), eq(businessMembers.roleId, "role_owner"), eq(businessMembers.isActive, true)))
    .get();
  return Number(row?.n ?? 0);
}

export async function updateMember(ctx: ServiceContext, memberId: string, input: z.output<typeof updateMemberSchema>) {
  requirePermission(ctx, "users.manage");
  const m = await getMember(ctx, memberId);
  if (m.user.id === ctx.userId) throw new AppError("FORBIDDEN", "You can't change your own role or access.");
  const newRole = input.roleId ? await assertRole(ctx, input.roleId) : m.role;
  const removingOwner = m.role.id === "role_owner" && (newRole.id !== "role_owner" || input.isActive === false);
  if (removingOwner && (await activeOwnerCount(ctx)) <= 1) throw new AppError("CONFLICT", "A business must have at least one owner.");
  await commit(
    ctx,
    [
      ctx.db
        .update(businessMembers)
        .set({ roleId: newRole.id, ...(input.isActive !== undefined && { isActive: input.isActive }), updatedAt: ctx.now })
        .where(and(eq(businessMembers.id, memberId), eq(businessMembers.businessId, ctx.businessId))),
      auditStmt(ctx, {
        action: input.isActive === false ? "MEMBER_DEACTIVATED" : input.isActive === true ? "MEMBER_REACTIVATED" : "MEMBER_ROLE_CHANGED",
        entityType: "member",
        entityId: memberId,
        summary: input.isActive === false ? `Removed access for ${m.user.name}` : input.isActive === true ? `Restored access for ${m.user.name}` : `${m.user.name} is now ${newRole.name}`,
        before: { role: m.role.name, isActive: m.member.isActive },
        after: { role: newRole.name, isActive: input.isActive ?? m.member.isActive },
      }),
    ],
    null,
  );
  // Deactivation takes effect immediately.
  if (input.isActive === false) await deleteUserSessions(ctx.db, m.user.id);
  return { memberId };
}

/**
 * Owners can reset a staff password — but only for accounts that belong solely to this
 * business, so one business can never take over an account used elsewhere.
 */
export async function resetMemberPassword(ctx: ServiceContext, memberId: string, password: string) {
  requirePermission(ctx, "users.manage");
  const m = await getMember(ctx, memberId);
  if (m.user.id === ctx.userId) throw new AppError("FORBIDDEN", "Use Account & security to change your own password.");
  const other = await ctx.db
    .select({ id: businessMembers.id })
    .from(businessMembers)
    .where(and(eq(businessMembers.userId, m.user.id), ne(businessMembers.businessId, ctx.businessId)))
    .get();
  if (other) throw new AppError("FORBIDDEN", "This person also uses Suvakta elsewhere. Ask them to reset their own password.");
  await commit(
    ctx,
    [
      ctx.db.update(users).set({ passwordHash: await hashPassword(password), updatedAt: ctx.now }).where(eq(users.id, m.user.id)),
      auditStmt(ctx, { action: "MEMBER_PASSWORD_RESET", entityType: "member", entityId: memberId, summary: `Reset password for ${m.user.name}` }),
    ],
    null,
  );
  await deleteUserSessions(ctx.db, m.user.id);
  return { memberId };
}

export async function listRoles(ctx: ServiceContext) {
  const rs = await ctx.db
    .select()
    .from(roles)
    .where(or(isNull(roles.businessId), eq(roles.businessId, ctx.businessId)))
    .orderBy(asc(roles.createdAt));
  const perms = rs.length
    ? await ctx.db.select().from(rolePermissions).where(inArray(rolePermissions.roleId, rs.map((r) => r.id)))
    : [];
  const order = ["owner", "manager", "staff"];
  return rs
    .map((r) => ({ id: r.id, key: r.key, name: r.name, isSystem: r.isSystem, permissions: perms.filter((p) => p.roleId === r.id).map((p) => p.permissionKey as Permission) }))
    .sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99));
}

export async function saveRole(ctx: ServiceContext, input: z.output<typeof roleSchema>, roleId?: string) {
  requirePermission(ctx, "users.manage");
  // Custom roles can never grant more than the creator holds.
  const escalation = input.permissions.filter((p) => !ctx.permissions.has(p));
  if (escalation.length) throw new AppError("FORBIDDEN", "You can't grant permissions you don't have.");
  const stmts: Stmt[] = [];
  let id = roleId;
  if (id) {
    const r = await ctx.db.select().from(roles).where(and(eq(roles.id, id), eq(roles.businessId, ctx.businessId))).get();
    if (!r) throw notFound("Role");
    if (r.isSystem) throw new AppError("FORBIDDEN", "Built-in roles can't be edited.");
    stmts.push(ctx.db.update(roles).set({ name: input.name }).where(eq(roles.id, id)), ctx.db.delete(rolePermissions).where(eq(rolePermissions.roleId, id)));
  } else {
    id = newId(ctx.now);
    stmts.push(ctx.db.insert(roles).values({ id, businessId: ctx.businessId, key: `custom_${id.slice(-8)}`, name: input.name, isSystem: false, createdAt: ctx.now }));
  }
  for (const p of new Set(input.permissions)) stmts.push(ctx.db.insert(rolePermissions).values({ roleId: id, permissionKey: p }));
  stmts.push(auditStmt(ctx, { action: roleId ? "ROLE_UPDATED" : "ROLE_CREATED", entityType: "role", entityId: id, summary: `${roleId ? "Updated" : "Created"} role ${input.name}`, after: input }));
  await commit(ctx, stmts, null);
  return { id };
}
