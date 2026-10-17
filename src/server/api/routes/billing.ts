import type { Context } from "hono";
import * as billing from "@/server/services/billing";
import { getDb } from "@/server/db/client";
import { ok } from "../respond";
import { bizRouter, requirePerm } from "../middleware";
import type { AppEnv } from "../types";

/** Owner billing: buy / list / cancel extra-branch subscriptions. */
export const billingRoutes = bizRouter()
  .get("/subscriptions", async (c) => ok(c, await billing.listBranchSubscriptions(c.get("ctx"))))
  .post("/branch/subscribe", requirePerm("settings.manage"), async (c) => ok(c, await billing.startBranchSubscription(c.get("ctx")), 201))
  .post("/subscriptions/:id/cancel", requirePerm("settings.manage"), async (c) => ok(c, await billing.cancelBranchSubscription(c.get("ctx"), c.req.param("id"))));

/**
 * Razorpay webhook — PUBLIC (no session), authenticated by HMAC signature over the raw body.
 * Registered before the authed billing router and exempted from CSRF in middleware.
 */
export async function billingWebhook(c: Context<AppEnv>) {
  const raw = await c.req.text();
  await billing.handleRazorpayWebhook(getDb(c.env.DB), c.env, c.get("logger"), raw, c.req.header("x-razorpay-signature") ?? null);
  return c.json({ success: true });
}
