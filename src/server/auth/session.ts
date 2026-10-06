/**
 * Session management. The cookie carries a random token; the DB stores only SHA-256(token).
 */
import { and, eq, gt, lt } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { businesses, businessMembers, roles, rolePermissions, sessions, users } from "@/server/db/schema";
import { randomToken, sha256Hex } from "@/server/lib/crypto";
import type { Permission } from "@/lib/domain";

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
  user: { id: string; name: string; mobile: string; email: string | null };
  membership: {
    businessId: string;
    businessName: string;
    onboardedAt: number | null;
    roleKey: string;
    roleName: string;
    permissions: Permission[];
  } | null;
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
    user: { id: row.user.id, name: row.user.name, mobile: row.user.mobile, email: row.user.email },
    membership,
  };
}

export async function loadMembership(db: Db, userId: string, businessId: string): Promise<SessionUser["membership"]> {
  const m = await db
    .select({
      businessId: businesses.id,
      businessName: businesses.name,
      onboardedAt: businesses.onboardedAt,
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
    })
    .from(businessMembers)
    .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
    .innerJoin(roles, eq(roles.id, businessMembers.roleId))
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
