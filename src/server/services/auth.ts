/**
 * Authentication & account lifecycle. These functions run before a business context exists,
 * so they take the Db directly instead of a ServiceContext.
 */
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { z } from "zod";
import { DEFAULT_EXPENSE_CATEGORIES } from "@/lib/domain";
import { newId } from "@/lib/ids";
import { normalizeMobile } from "@/lib/text";
import { DUMMY_HASH, hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, deleteUserSessions, loadMembership } from "@/server/auth/session";
import type { Db } from "@/server/db/client";
import {
  appEvents,
  auditLogs,
  businesses,
  businessMembers,
  businessSettings,
  expenseCategories,
  gstSettings,
  passwordResetTokens,
  users,
} from "@/server/db/schema";
import { randomToken, sha256Hex } from "@/server/lib/crypto";
import { AppError } from "@/server/lib/errors";
import type { Logger } from "@/server/lib/logger";
import type { loginSchema, resetPasswordSchema, signupSchema } from "@/schemas/auth";
import type { Stmt } from "./engine";
import { newTenantStmts } from "./tenancy";

type SignupData = z.output<typeof signupSchema>;
type LoginData = z.output<typeof loginSchema>;
type ResetData = z.output<typeof resetPasswordSchema>;

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
  now: number;
}

const RESET_TTL_MS = 30 * 60_000;

/** Statements that create a business with sensible defaults and the creator as owner. */
export function newBusinessStmts(
  db: Db,
  opts: {
    businessId: string;
    userId: string;
    name: string;
    type: string;
    city: string | null;
    now: number;
    tenantId: string;
    branchCode?: string;
    stateCode?: string | null;
    onboarded?: boolean;
  },
): Stmt[] {
  const { businessId, userId, now } = opts;
  return [
    db.insert(businesses).values({
      id: businessId,
      tenantId: opts.tenantId,
      branchCode: opts.branchCode ?? "MAIN",
      stateCode: opts.stateCode ?? null,
      onboardedAt: opts.onboarded ? now : null,
      name: opts.name,
      type: opts.type,
      city: opts.city,
      onboardingStep: 1,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(businessMembers).values({ id: newId(now), businessId, userId, roleId: "role_owner", createdAt: now, updatedAt: now }),
    db.insert(businessSettings).values({ businessId, updatedAt: now }),
    db.insert(gstSettings).values({ businessId, updatedAt: now }),
    ...DEFAULT_EXPENSE_CATEGORIES.map((name) =>
      db.insert(expenseCategories).values({ id: newId(now), businessId, name, isSystem: true, createdAt: now }),
    ),
  ];
}

export async function signup(db: Db, input: SignupData, meta: RequestMeta) {
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.mobile, input.mobile)).get();
  if (existing) throw new AppError("MOBILE_TAKEN", "An account with this mobile number already exists. Please log in.");
  if (input.email) {
    const e = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).get();
    if (e) throw new AppError("EMAIL_TAKEN", "An account with this email already exists.");
  }

  const now = meta.now;
  const userId = newId(now);
  const businessId = newId(now);
  const tenantId = newId(now);
  const passwordHash = await hashPassword(input.password);

  try {
    await db.batch([
      db.insert(users).values({
        id: userId,
        name: input.name,
        mobile: input.mobile,
        email: input.email ?? null,
        passwordHash,
        lastLoginAt: now,
        createdAt: now,
        updatedAt: now,
      }),
      // Self-signup starts a free-trial licence for a new tenant with one shop.
      ...newTenantStmts(db, { tenantId, name: input.businessName, ownerUserId: userId, plan: "TRIAL", actorUserId: userId, now }),
      ...newBusinessStmts(db, { businessId, userId, tenantId, name: input.businessName, type: input.businessType, city: input.city, now }),
      db.insert(auditLogs).values({
        id: newId(now),
        businessId,
        userId,
        action: "BUSINESS_CREATED",
        entityType: "business",
        entityId: businessId,
        summary: `Created ${input.businessName}`,
        afterData: { name: input.businessName, type: input.businessType, city: input.city },
        source: "WEB",
        requestId: meta.requestId,
        ip: meta.ip,
        createdAt: now,
      }),
      db.insert(appEvents).values({ id: newId(now), businessId, userId, name: "signup", props: { type: input.businessType }, createdAt: now }),
    ]);
  } catch (err) {
    // Concurrent signup with the same mobile/email.
    if (String(err).includes("UNIQUE")) throw new AppError("MOBILE_TAKEN", "An account with this mobile number already exists.");
    throw err;
  }

  const session = await createSession(db, { userId, businessId, userAgent: meta.userAgent, ip: meta.ip, now });
  return { userId, businessId, ...session };
}

async function findUserByIdentifier(db: Db, identifier: string) {
  const mobile = normalizeMobile(identifier);
  if (mobile) return db.select().from(users).where(eq(users.mobile, mobile)).get();
  if (identifier.includes("@")) return db.select().from(users).where(eq(users.email, identifier.trim().toLowerCase())).get();
  return undefined;
}

export async function login(db: Db, input: LoginData, meta: RequestMeta) {
  const user = await findUserByIdentifier(db, input.identifier);
  // Always run a hash verification so response timing does not reveal whether the account exists.
  const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new AppError("INVALID_CREDENTIALS", "Mobile number / email or password is incorrect.");
  if (!user.isActive) throw new AppError("ACCOUNT_DISABLED", "This account has been disabled. Contact the shop owner.");

  const membership = await db
    .select({ businessId: businessMembers.businessId })
    .from(businessMembers)
    .where(and(eq(businessMembers.userId, user.id), eq(businessMembers.isActive, true)))
    .orderBy(desc(businessMembers.createdAt))
    .get();

  await db.update(users).set({ lastLoginAt: meta.now }).where(eq(users.id, user.id));
  const session = await createSession(db, {
    userId: user.id,
    businessId: membership?.businessId ?? null,
    userAgent: meta.userAgent,
    ip: meta.ip,
    now: meta.now,
  });
  return { userId: user.id, businessId: membership?.businessId ?? null, platformRole: user.platformRole ?? null, ...session };
}

/**
 * Starts a password reset. Always succeeds from the caller's perspective (no account
 * enumeration). Returns the raw token only so the delivery layer can send it.
 */
export async function createPasswordReset(db: Db, identifier: string, now: number) {
  const user = await findUserByIdentifier(db, identifier);
  if (!user || !user.isActive) return null;
  const token = randomToken(32);
  await db.insert(passwordResetTokens).values({
    id: await sha256Hex(token),
    userId: user.id,
    expiresAt: now + RESET_TTL_MS,
    createdAt: now,
  });
  return { token, user: { id: user.id, name: user.name, email: user.email, mobile: user.mobile } };
}

export async function resetPassword(db: Db, input: ResetData, now: number, logger: Logger) {
  const id = await sha256Hex(input.token);
  const row = await db
    .select()
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.id, id), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, now)))
    .get();
  if (!row) throw new AppError("INVALID_TOKEN", "This reset link is invalid or has expired. Please request a new one.");
  const passwordHash = await hashPassword(input.password);
  await db.batch([
    db.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, row.userId)),
    db.update(passwordResetTokens).set({ usedAt: now }).where(eq(passwordResetTokens.id, id)),
  ]);
  await deleteUserSessions(db, row.userId);
  logger.info("password reset completed", { userId: row.userId });
}

export async function changePassword(db: Db, userId: string, current: string, next: string, now: number) {
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user || !(await verifyPassword(current, user.passwordHash))) {
    throw new AppError("INVALID_CREDENTIALS", "Current password is incorrect.");
  }
  await db.update(users).set({ passwordHash: await hashPassword(next), updatedAt: now }).where(eq(users.id, userId));
}

/** Lists businesses the user belongs to (for the business switcher). */
export async function listUserBusinesses(db: Db, userId: string) {
  return db
    .select({ id: businesses.id, name: businesses.name, type: businesses.type })
    .from(businessMembers)
    .innerJoin(businesses, eq(businesses.id, businessMembers.businessId))
    .where(and(eq(businessMembers.userId, userId), eq(businessMembers.isActive, true)))
    .all();
}

/** Verifies membership before pointing the session at another business. */
export async function assertMembership(db: Db, userId: string, businessId: string) {
  const m = await loadMembership(db, userId, businessId);
  if (!m) throw new AppError("NOT_FOUND", "Business not found.");
  return m;
}
