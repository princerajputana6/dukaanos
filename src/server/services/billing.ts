/**
 * Extra-branch billing via Razorpay Subscriptions (monthly auto-pay).
 *
 * The owner subscribes → Razorpay collects a UPI AutoPay / card mandate → webhooks drive the
 * subscription status. Each ACTIVE subscription raises the tenant's effective branch allowance
 * by one. When a subscription lapses, the funded branch is set to SUSPENDED (read-only) — never
 * deleted. The webhook is the single source of truth; the browser is never trusted to grant access.
 *
 * Everything degrades safely when Razorpay env vars are absent (local/dev or not-yet-configured):
 * the subscribe endpoint returns BILLING_UNAVAILABLE and the webhook rejects.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { newId } from "@/lib/ids";
import { branchSubscriptions, businesses, tenants } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import type { Logger } from "@/server/lib/logger";
import type { Db } from "@/server/db/client";
import { requirePermission, type ServiceContext } from "./context";

const DEFAULT_BRANCH_PRICE_PAISE = 49_900; // ₹499 / month

/** Subscriptions that count towards the branch allowance (mandate approved or actively charging). */
const ACTIVE_STATES = ["AUTHENTICATED", "ACTIVE"] as const;

export function branchPricePaise(env: Env): number {
  const v = env.BRANCH_PRICE_PAISE ? Number.parseInt(env.BRANCH_PRICE_PAISE, 10) : Number.NaN;
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_BRANCH_PRICE_PAISE;
}

export function billingConfigured(env: Env): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_BRANCH_PLAN_ID);
}

async function razorpay<T = Record<string, unknown>>(env: Env, path: string, method: string, body?: unknown): Promise<T> {
  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  let res: Response;
  try {
    res = await fetch(`https://api.razorpay.com/v1${path}`, {
      method,
      headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AppError("PAYMENT_ERROR", "Couldn't reach the payment provider. Please try again.");
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { description?: string } };
  if (!res.ok) throw new AppError("PAYMENT_ERROR", json?.error?.description ?? "Payment provider error.");
  return json as T;
}

async function tenantFor(ctx: ServiceContext): Promise<{ id: string; ownerUserId: string }> {
  const b = await ctx.db.select({ tenantId: businesses.tenantId }).from(businesses).where(eq(businesses.id, ctx.businessId)).get();
  if (!b?.tenantId) throw new AppError("NOT_FOUND", "Account not found.");
  const t = await ctx.db.select({ id: tenants.id, ownerUserId: tenants.ownerUserId }).from(tenants).where(eq(tenants.id, b.tenantId)).get();
  if (!t) throw new AppError("NOT_FOUND", "Account not found.");
  return t;
}

/** Count of subscriptions currently granting a branch slot for this tenant. */
export async function activeBranchSubs(db: Db, tenantId: string): Promise<number> {
  const r = await db
    .select({ n: sql<number>`count(*)` })
    .from(branchSubscriptions)
    .where(and(eq(branchSubscriptions.tenantId, tenantId), inArray(branchSubscriptions.status, [...ACTIVE_STATES])))
    .get();
  return Number(r?.n ?? 0);
}

/** Link a freshly-created paid branch to an active subscription that doesn't yet fund a branch. */
export async function linkPaidBranch(db: Db, tenantId: string, branchBusinessId: string, now: number): Promise<void> {
  const unlinked = await db
    .select({ id: branchSubscriptions.id })
    .from(branchSubscriptions)
    .where(and(eq(branchSubscriptions.tenantId, tenantId), inArray(branchSubscriptions.status, [...ACTIVE_STATES]), isNull(branchSubscriptions.branchBusinessId)))
    .get();
  if (unlinked) await db.update(branchSubscriptions).set({ branchBusinessId, updatedAt: now }).where(eq(branchSubscriptions.id, unlinked.id));
}

export interface StartSubscriptionResult {
  subscriptionId: string;
  keyId: string;
  amountPaise: number;
}

/** Owner starts a monthly subscription for one extra branch. Returns data for Razorpay Checkout. */
export async function startBranchSubscription(ctx: ServiceContext): Promise<StartSubscriptionResult> {
  requirePermission(ctx, "settings.manage");
  const tenant = await tenantFor(ctx);
  if (tenant.ownerUserId !== ctx.userId) throw new AppError("FORBIDDEN", "Only the account owner can buy branches.");
  if (!billingConfigured(ctx.env)) throw new AppError("BILLING_UNAVAILABLE", "Online payment isn't set up yet. Please contact Suvakta.");

  const amountPaise = branchPricePaise(ctx.env);
  const sub = await razorpay<{ id: string }>(ctx.env, "/subscriptions", "POST", {
    plan_id: ctx.env.RAZORPAY_BRANCH_PLAN_ID,
    total_count: 120, // up to ten years of monthly cycles
    customer_notify: 1,
    notes: { tenantId: tenant.id, ownerUserId: ctx.userId },
  });
  await ctx.db.insert(branchSubscriptions).values({
    id: newId(ctx.now),
    tenantId: tenant.id,
    ownerUserId: ctx.userId,
    providerSubId: sub.id,
    providerPlanId: ctx.env.RAZORPAY_BRANCH_PLAN_ID!,
    status: "CREATED",
    amountPaise,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  });
  return { subscriptionId: sub.id, keyId: ctx.env.RAZORPAY_KEY_ID!, amountPaise };
}

export async function listBranchSubscriptions(ctx: ServiceContext) {
  const tenant = await tenantFor(ctx);
  const rows = await ctx.db
    .select({
      id: branchSubscriptions.id,
      status: branchSubscriptions.status,
      amountPaise: branchSubscriptions.amountPaise,
      currentPeriodEnd: branchSubscriptions.currentPeriodEnd,
      branchBusinessId: branchSubscriptions.branchBusinessId,
      createdAt: branchSubscriptions.createdAt,
    })
    .from(branchSubscriptions)
    .where(eq(branchSubscriptions.tenantId, tenant.id))
    .orderBy(sql`${branchSubscriptions.createdAt} desc`);
  return { subscriptions: rows, billingEnabled: billingConfigured(ctx.env), pricePaise: branchPricePaise(ctx.env) };
}

/** Owner cancels a subscription at the cycle end; access stays until the paid period lapses. */
export async function cancelBranchSubscription(ctx: ServiceContext, id: string) {
  requirePermission(ctx, "settings.manage");
  const tenant = await tenantFor(ctx);
  if (tenant.ownerUserId !== ctx.userId) throw new AppError("FORBIDDEN", "Only the account owner can manage billing.");
  const row = await ctx.db.select().from(branchSubscriptions).where(and(eq(branchSubscriptions.id, id), eq(branchSubscriptions.tenantId, tenant.id))).get();
  if (!row) throw new AppError("NOT_FOUND", "Subscription not found.");
  if (billingConfigured(ctx.env)) await razorpay(ctx.env, `/subscriptions/${row.providerSubId}/cancel`, "POST", { cancel_at_cycle_end: 1 });
  await ctx.db.update(branchSubscriptions).set({ updatedAt: ctx.now }).where(eq(branchSubscriptions.id, row.id));
  return { cancelled: true };
}

// ─── Webhook (source of truth) ───────────────────────────────────────────────

const EVENT_STATUS: Record<string, string> = {
  "subscription.authenticated": "AUTHENTICATED",
  "subscription.activated": "ACTIVE",
  "subscription.charged": "ACTIVE",
  "subscription.pending": "PENDING",
  "subscription.halted": "HALTED",
  "subscription.cancelled": "CANCELLED",
  "subscription.completed": "COMPLETED",
  "subscription.expired": "EXPIRED",
};

/** Verifies the Razorpay signature over the raw body, then applies the lifecycle event. */
export async function handleRazorpayWebhook(db: Db, env: Env, logger: Logger, rawBody: string, signature: string | null): Promise<void> {
  if (!env.RAZORPAY_WEBHOOK_SECRET) throw new AppError("BILLING_UNAVAILABLE", "Billing webhook is not configured.");
  if (!signature || !(await verifyHmacSha256Hex(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET))) {
    throw new AppError("FORBIDDEN", "Invalid webhook signature.");
  }
  let evt: { event?: string; payload?: { subscription?: { entity?: { id?: string; current_end?: number } }; payment?: { entity?: { id?: string } } } };
  try {
    evt = JSON.parse(rawBody);
  } catch {
    throw new AppError("VALIDATION_ERROR", "Malformed webhook body.");
  }
  const newStatus = evt.event ? EVENT_STATUS[evt.event] : undefined;
  const subId = evt.payload?.subscription?.entity?.id;
  if (!newStatus || !subId) return; // event we don't act on

  const row = await db.select().from(branchSubscriptions).where(eq(branchSubscriptions.providerSubId, subId)).get();
  if (!row) {
    logger.warn("razorpay webhook for unknown subscription", { subId, event: evt.event });
    return;
  }
  const now = Date.now();
  const periodEnd = evt.payload?.subscription?.entity?.current_end ? evt.payload.subscription.entity.current_end * 1000 : row.currentPeriodEnd;
  const paymentId = evt.payload?.payment?.entity?.id ?? row.lastPaymentId;
  await db.update(branchSubscriptions).set({ status: newStatus, currentPeriodEnd: periodEnd, lastPaymentId: paymentId, updatedAt: now }).where(eq(branchSubscriptions.id, row.id));

  // Suspend the funded branch when the subscription lapses; reactivate when it resumes.
  const active = newStatus === "ACTIVE" || newStatus === "AUTHENTICATED";
  if (row.branchBusinessId) {
    if (!active) {
      await db.update(businesses).set({ status: "SUSPENDED", updatedAt: now }).where(and(eq(businesses.id, row.branchBusinessId), eq(businesses.status, "ACTIVE")));
    } else {
      await db.update(businesses).set({ status: "ACTIVE", updatedAt: now }).where(and(eq(businesses.id, row.branchBusinessId), eq(businesses.status, "SUSPENDED")));
    }
  }
  logger.info("razorpay subscription event", { subId, event: evt.event, status: newStatus });
}

async function verifyHmacSha256Hex(body: string, signatureHex: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(expected, signatureHex.trim().toLowerCase());
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
