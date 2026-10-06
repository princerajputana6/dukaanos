import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import { changePasswordSchema, forgotPasswordSchema, loginSchema, resetPasswordSchema, signupSchema, switchBusinessSchema } from "@/schemas/auth";
import { getDelivery } from "@/server/auth/delivery";
import { clearSessionCookie, deleteSession, sessionCookie } from "@/server/auth/session";
import { sessions } from "@/server/db/schema";
import * as auth from "@/server/services/auth";
import { body, ok } from "../respond";
import { rateLimit, requireUser } from "../middleware";
import type { AppEnv } from "../types";

const isHttps = (url: string) => new URL(url).protocol === "https:";

export const authRoutes = new Hono<AppEnv>()
  .post("/signup", rateLimit("AUTH_LIMITER", "ip"), async (c) => {
    const input = await body(c, signupSchema);
    const res = await auth.signup(c.get("db"), input, meta(c));
    c.header("set-cookie", sessionCookie(res.token, res.expiresAt, isHttps(c.req.url)));
    return ok(c, { userId: res.userId, businessId: res.businessId }, 201);
  })
  .post("/login", rateLimit("AUTH_LIMITER", "ip"), async (c) => {
    const input = await body(c, loginSchema);
    const res = await auth.login(c.get("db"), input, meta(c));
    c.header("set-cookie", sessionCookie(res.token, res.expiresAt, isHttps(c.req.url)));
    return ok(c, { userId: res.userId, businessId: res.businessId });
  })
  .post("/logout", async (c) => {
    const s = c.get("session");
    if (s) await deleteSession(c.get("db"), s.sessionId);
    c.header("set-cookie", clearSessionCookie(isHttps(c.req.url)));
    return ok(c, { loggedOut: true });
  })
  .post("/forgot-password", rateLimit("AUTH_LIMITER", "ip"), async (c) => {
    const { identifier } = await body(c, forgotPasswordSchema);
    const reset = await auth.createPasswordReset(c.get("db"), identifier, c.get("now"));
    const devMode = c.env.ENVIRONMENT === "development" || c.env.ENVIRONMENT === "test";
    let devResetLink: string | undefined;
    if (reset) {
      const link = `${new URL(c.req.url).origin}/reset-password?token=${encodeURIComponent(reset.token)}`;
      const delivery = getDelivery(c.env, c.get("logger"));
      const sent = delivery ? await delivery.sendPasswordReset(reset.user, link) : false;
      if (!sent) c.get("logger").warn("password reset requested but no delivery channel reached the user", { userId: reset.user.id });
      if (devMode) devResetLink = link;
    }
    // Identical response whether or not the account exists (no enumeration).
    return ok(c, {
      message: "If an account exists, we've sent reset instructions. If you don't receive them, ask your shop owner to reset your password.",
      ...(devResetLink ? { devResetLink } : {}),
    });
  })
  .post("/reset-password", rateLimit("AUTH_LIMITER", "ip"), async (c) => {
    const input = await body(c, resetPasswordSchema);
    await auth.resetPassword(c.get("db"), input, c.get("now"), c.get("logger"));
    return ok(c, { reset: true });
  })
  .post("/change-password", requireUser, rateLimit("AUTH_LIMITER", "ip"), async (c) => {
    const input = await body(c, changePasswordSchema);
    await auth.changePassword(c.get("db"), c.get("session")!.user.id, input.currentPassword, input.newPassword, c.get("now"));
    return ok(c, { changed: true });
  })
  .post("/switch-business", requireUser, async (c) => {
    const { businessId } = await body(c, switchBusinessSchema);
    const s = c.get("session")!;
    await auth.assertMembership(c.get("db"), s.user.id, businessId);
    await c.get("db").update(sessions).set({ businessId }).where(eq(sessions.id, s.sessionId));
    return ok(c, { businessId });
  });

function meta(c: Context<AppEnv>): auth.RequestMeta {
  return { ip: c.get("ip"), userAgent: c.req.header("user-agent") ?? null, requestId: c.get("requestId"), now: c.get("now") };
}
