/**
 * Session management. The cookie carries a random token; the DB stores only SHA-256(token).
 */
import { and, eq, gt, lt } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { businesses, businessMembers, licenses, roles, rolePermissions, sessions, tenants, users } from "@/server/db/schema";
import { randomToken, sha256Hex } from "@/server/lib/crypto";
import { effectiveLicenseStatus, licenseAllowsWrites, type LicenseStatus, type Permission, type PlatformRole } from "@/lib/domain";
import { todayIst } from "@/lib/dates";

export const SESSION_COOKIE = "dk_session";
export const SESSION_TTL_MS = 30 * 24 * 3600_000;
const REFRESH_AFTER_MS = 3600_000;

export async function createSession(
  db: Db,
  opts: { userId: string; businessId: string | null; userAgent?: string | null; ip?: string | null; now: number },
): Promise<{ token: string; expiresAt: number }> {
  const token = randomToken(32);
  const id = await sha256Hex(token);
  const expiresAt = opts.now + SESSION_TTL_MS;
  await db.insert(sessions).values({
    id,
    userId: opts.userId,
    businessId: opts.businessId,
    expiresAt,
    lastSeenAt: opts.now,
    userAgent: opts.userAgent?.slice(0, 300) ?? null,
    ip: opts.ip ?? null,
    createdAt: opts.now,
  });
  return { token, expiresAt };
}

export interface SessionUser {
  sessionId: string;
  expiresAt: number;
  refreshed: boolean;
  user: { id: string; name: string; mobile: string; email: string | null; platformRole: PlatformRole | null };
  membership: Membership | null;
}

export interface ShopAccess {
  tenantId: string | null;
  businessStatus: string;
  tenantStatus: string;
  plan: string | null;
  licenseStatus: LicenseStatus;
  validUntil: string | null;
  /** False when the shop, tenant or licence is not in good standing → read-only. */
  writable: boolean;
  /** Human explanation when not writable. */
  reason: string | null;
}

export interface Membership {
  businessId: string;
  businessName: string;
  onboardedAt: number | null;
  roleKey: string;
  roleName: string;
  permissions: Permission[];
  access: ShopAccess;
}

/** Validates a session token, slides its expiry, and loads the active membership. */
export async function resolveSession(db: Db, token: string, now: number): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  const id = await sha256Hex(token);
  const row = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
    .get();
  if (!row || !row.user.isActive) return null;

  let refreshed = false;
  let expiresAt = row.session.expiresAt;
  if (now - row.session.lastSeenAt > REFRESH_AFTER_MS) {
    expiresAt = now + SESSION_TTL_MS;
    refreshed = true;
    await db.update(sessions).set({ lastSeenAt: now, expiresAt }).where(eq(sessions.id, id));
  }

  const membership = row.session.businessId ? await loadMembership(db, row.user.id, row.session.businessId) : null;
  return {
    sessionId: id,
    expiresAt,
    refreshed,
    user: {
      id: row.user.id,
      name: row.user.name,
      mobile: row.user.mobile,
      email: row.user.email,
      platformRole: (row.user.platformRole as PlatformRole | null) ?? null,
    },
    membership,
  };
}

export async function loadMembership(db: Db, userId: string, businessId: string): Promise<Membership | null> {
  const m = await db
    .select({
      businessId: businesses.id,
      businessName: businesses.name,
      onboardedAt: businesses.onboardedAt,
      businessStatus: businesses.status,
      tenantId: businesses.tenantId,
      tenantStatus: tenants.status,
      plan: licenses.plan,
      licenseStatus: licenses.status,
      validUntil: licenses.validUntil,
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
    })
    .from(businessMembers)
    .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
    .innerJoin(roles, eq(roles.id, businessMembers.roleId))
    .leftJoin(tenants, eq(tenants.id, businesses.tenantId))
    .leftJoin(licenses, eq(licenses.tenantId, businesses.tenantId))
    .where(and(eq(businessMembers.userId, userId), eq(businessMembers.businessId, businessId), eq(businessMembers.isActive, true)))
    .get();
  if (!m) return null;
  const perms = await db.select({ key: rolePermissions.permissionKey }).from(rolePermissions).where(eq(rolePermissions.roleId, m.roleId));
  return {
    businessId: m.businessId,
    businessName: m.businessName,
    onboardedAt: m.onboardedAt,
    roleKey: m.roleKey,
    roleName: m.roleName,
    permissions: perms.map((p) => p.key as Permission),
    access: shopAccess(m, todayIst()),
  };
}

/** Works out whether a shop may record transactions today, and why not. */
export function shopAccess(
  m: { tenantId: string | null; businessStatus: string; tenantStatus: string | null; plan: string | null; licenseStatus: string | null; validUntil: string | null },
  today: string,
): ShopAccess {
  const licenseStatus = m.licenseStatus ? effectiveLicenseStatus({ status: m.licenseStatus, validUntil: m.validUntil }, today) : "ACTIVE";
  const tenantStatus = m.tenantStatus ?? "ACTIVE";
  let reason: string | null = null;
  if (m.businessStatus !== "ACTIVE") reason = "This shop has been suspended by DukaanOS. You can view your data but not record new entries.";
  else if (tenantStatus !== "ACTIVE") reason = "Your DukaanOS account is suspended. You can view your data but not record new entries.";
  else if (!licenseAllowsWrites(licenseStatus))
    reason = licenseStatus === "EXPIRED" ? "Your DukaanOS licence has expired. Renew it to keep recording sales." : `Your DukaanOS licence is ${licenseStatus.toLowerCase()}. You can view your data but not record new entries.`;
  return {
    tenantId: m.tenantId,
    businessStatus: m.businessStatus,
    tenantStatus,
    plan: m.plan,
    licenseStatus,
    validUntil: m.validUntil,
    writable: reason === null,
    reason,
  };
}

export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function deleteUserSessions(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function purgeExpiredSessions(db: Db, now: number): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
}

export function sessionCookie(token: string, expiresAt: number, secure: boolean): string {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}
