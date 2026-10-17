import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { newId } from "@/lib/ids";
import { getDb } from "@/server/db/client";
import { branchSubscriptions, businesses } from "@/server/db/schema";
import { logger } from "@/server/lib/logger";
import { handleRazorpayWebhook } from "@/server/services/billing";
import { call, signupOwner } from "./helpers";

const db = () => getDb(env.DB);
const SECRET = "whsec_test";
const envWith = { ...env, RAZORPAY_WEBHOOK_SECRET: SECRET } as unknown as Env;

async function tenantOf(businessId: string): Promise<string> {
  const b = await db().select({ t: businesses.tenantId }).from(businesses).where(eq(businesses.id, businessId)).get();
  return b!.t as string;
}

async function sign(body: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function evt(event: string, subId: string): string {
  return JSON.stringify({ event, payload: { subscription: { entity: { id: subId, current_end: 1_900_000_000 } } } });
}

async function seedSub(tenantId: string, ownerUserId: string, providerSubId: string, status = "ACTIVE") {
  const now = Date.now();
  await db().insert(branchSubscriptions).values({ id: newId(now), tenantId, ownerUserId, providerSubId, providerPlanId: "plan_test", status, amountPaise: 49_900, createdAt: now, updatedAt: now });
}

describe("billing: extra-branch entitlement", () => {
  it("blocks a 2nd branch on the trial plan, then allows and links it once a subscription is active", async () => {
    const owner = await signupOwner();
    const tenantId = await tenantOf(owner.businessId);

    const blocked = await call("POST", "/branches", { cookie: owner.cookie, body: { name: "Second Branch", copyCatalogue: false } });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("LIMIT_REACHED");

    await seedSub(tenantId, owner.userId, "sub_entitle");
    const allowed = await call("POST", "/branches", { cookie: owner.cookie, body: { name: "Second Branch", copyCatalogue: false } });
    expect(allowed.status).toBe(201);

    const sub = await db().select().from(branchSubscriptions).where(eq(branchSubscriptions.providerSubId, "sub_entitle")).get();
    expect(sub?.branchBusinessId).toBe(allowed.body.data.businessId);
  });
});

describe("billing: Razorpay webhook", () => {
  it("rejects a bad signature", async () => {
    await expect(handleRazorpayWebhook(db(), envWith, logger, evt("subscription.halted", "sub_x"), "deadbeef")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("suspends the funded branch when payment lapses and reactivates it when it resumes", async () => {
    const owner = await signupOwner();
    const tenantId = await tenantOf(owner.businessId);
    await seedSub(tenantId, owner.userId, "sub_life");
    // Create the paid branch so it links to the subscription.
    const created = await call("POST", "/branches", { cookie: owner.cookie, body: { name: "Paid Branch", copyCatalogue: false } });
    expect(created.status).toBe(201);
    const branchId = created.body.data.businessId as string;

    // Payment fails → subscription halted → branch goes read-only (SUSPENDED).
    const halt = evt("subscription.halted", "sub_life");
    await handleRazorpayWebhook(db(), envWith, logger, halt, await sign(halt));
    let b = await db().select({ s: businesses.status }).from(businesses).where(eq(businesses.id, branchId)).get();
    expect(b?.s).toBe("SUSPENDED");
    let sub = await db().select({ s: branchSubscriptions.status }).from(branchSubscriptions).where(eq(branchSubscriptions.providerSubId, "sub_life")).get();
    expect(sub?.s).toBe("HALTED");

    // Payment resumes → subscription charged → branch active again.
    const charged = evt("subscription.charged", "sub_life");
    await handleRazorpayWebhook(db(), envWith, logger, charged, await sign(charged));
    b = await db().select({ s: businesses.status }).from(businesses).where(eq(businesses.id, branchId)).get();
    expect(b?.s).toBe("ACTIVE");
    sub = await db().select({ s: branchSubscriptions.status }).from(branchSubscriptions).where(eq(branchSubscriptions.providerSubId, "sub_life")).get();
    expect(sub?.s).toBe("ACTIVE");
  });

  it("ignores an unknown subscription id without error", async () => {
    const body = evt("subscription.activated", "sub_unknown_zzz");
    await expect(handleRazorpayWebhook(db(), envWith, logger, body, await sign(body))).resolves.toBeUndefined();
  });
});
