import { Hono, type MiddlewareHandler } from "hono";
import type { Permission } from "@/lib/domain";
import { newId } from "@/lib/ids";
import { readCookie, resolveSession, SESSION_COOKIE, sessionCookie } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { AppError, forbidden } from "@/server/lib/errors";
import { logger as rootLogger } from "@/server/lib/logger";
import type { AppEnv } from "./types";

/** Request id, logger, db handle, timing log. */
export const requestContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  const requestId = c.req.header("x-request-id")?.slice(0, 64) || newId();
  const started = Date.now();
  const log = rootLogger.child({ requestId, method: c.req.method, path: c.req.path });
  c.set("requestId", requestId);
  c.set("logger", log);
  c.set("db", getDb(c.env.DB));
  c.set("now", started);
  c.set("ip", c.req.header("cf-connecting-ip") ?? null);
  c.set("session", null);
  await next();
  c.header("x-request-id", requestId);
  const ms = Date.now() - started;
  log.info("request", { status: c.res.status, ms, userId: c.get("session")?.user.id, businessId: c.get("session")?.membership?.businessId });
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF protection: session cookie is SameSite=Lax, and every state-changing request must
 * come from our own origin (Origin header) or be marked same-origin by the browser.
 */
export const csrf: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();
  const origin = c.req.header("origin");
  const expected = new URL(c.req.url).origin;
  const fetchSite = c.req.header("sec-fetch-site");
  const allowed = origin ? origin === expected || origin === c.env.APP_URL : fetchSite === "same-origin";
  if (!allowed) throw new AppError("CSRF_REJECTED", "Request blocked for your security. Please reload the page.");
  return next();
};

/** Loads the session (if any) and slides its cookie. */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = readCookie(c.req.header("cookie"), SESSION_COOKIE);
  if (token) {
    const session = await resolveSession(c.get("db"), token, c.get("now"));
    c.set("session", session);
    if (session?.refreshed) {
      c.header("set-cookie", sessionCookie(token, session.expiresAt, new URL(c.req.url).protocol === "https:"), { append: true });
    }
  }
  return next();
};

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("session")) throw new AppError("UNAUTHENTICATED", "Please log in to continue.");
  return next();
};

/**
 * Builds the ServiceContext from the session's ACTIVE business. The business id always comes
 * from the server-side session, never from the request.
 */
export const requireBusiness: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = c.get("session");
  if (!session) throw new AppError("UNAUTHENTICATED", "Please log in to continue.");
  const m = session.membership;
  if (!m) throw new AppError("FORBIDDEN", "You are not a member of any business yet.");
  c.set("ctx", {
    db: c.get("db"),
    env: c.env,
    businessId: m.businessId,
    userId: session.user.id,
    userName: session.user.name,
    roleKey: m.roleKey,
    permissions: new Set(m.permissions),
    // VOICE is set server-side by the AI confirmation endpoint; clients cannot choose it.
    source: "WEB",
    requestId: c.get("requestId"),
    ip: c.get("ip"),
    now: c.get("now"),
    logger: c.get("logger").child({ businessId: m.businessId, userId: session.user.id }),
  });
  return next();
};

/** Route-level permission declaration (services enforce again — defence in depth). */
export function requirePerm(...perms: Permission[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const ctx = c.get("ctx");
    if (!perms.every((p) => ctx.permissions.has(p))) throw forbidden();
    return next();
  };
}

/** Cloudflare Rate Limiting binding; no-op when the binding is absent (local/test). */
export function rateLimit(binding: "AUTH_LIMITER" | "AI_LIMITER", keyOf: "ip" | "user"): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const limiter = c.env[binding];
    if (limiter) {
      const key = keyOf === "user" ? (c.get("session")?.user.id ?? c.get("ip") ?? "anon") : (c.get("ip") ?? "anon");
      const { success } = await limiter.limit({ key: `${binding}:${key}` });
      if (!success) throw new AppError("RATE_LIMITED", "Too many attempts. Please wait a minute and try again.");
    }
    return next();
  };
}

/** A router whose every route requires an active business membership. */
export function bizRouter() {
  return new Hono<AppEnv>().use("*", requireBusiness);
}
