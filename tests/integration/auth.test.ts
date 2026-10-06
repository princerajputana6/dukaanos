import { describe, expect, it } from "vitest";
import { call, nextMobile, signupOwner } from "./helpers";

describe("authentication", () => {
  it("signs up, returns an HttpOnly session, and loads /me", async () => {
    const mobile = nextMobile();
    const res = await call("POST", "/auth/signup", {
      body: { name: "Asha", mobile, password: "password123", businessName: "Asha Kirana", businessType: "grocery", city: "Pune" },
    });
    expect(res.status).toBe(201);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");

    const me = await call("GET", "/me", { cookie: res.cookie });
    expect(me.status).toBe(200);
    expect(me.body.data.user.mobile).toBe(mobile);
    expect(me.body.data.membership.roleKey).toBe("owner");
    expect(me.body.data.membership.permissions).toContain("users.manage");
    expect(me.body.data.business.name).toBe("Asha Kirana");
    expect(me.body.data.flags.VOICE_ENABLED).toBe(true);
  });

  it("never stores plaintext passwords", async () => {
    const { mobile } = await signupOwner({ password: "plain-text-check" });
    const { env } = await import("cloudflare:workers");
    const row = await env.DB.prepare("SELECT password_hash FROM users WHERE mobile = ?").bind(mobile).first<{ password_hash: string }>();
    expect(row!.password_hash).not.toContain("plain-text-check");
    expect(row!.password_hash.startsWith("pbkdf2$100000$")).toBe(true);
  });

  it("rejects duplicate mobile numbers", async () => {
    const { mobile } = await signupOwner();
    const res = await call("POST", "/auth/signup", {
      body: { name: "Xavier", mobile, password: "password123", businessName: "Y Store", businessType: "retail", city: "Delhi" },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("MOBILE_TAKEN");
  });

  it("logs in with mobile (any format) and rejects wrong passwords uniformly", async () => {
    const { mobile } = await signupOwner({ password: "correct-horse" });
    const good = await call("POST", "/auth/login", { body: { identifier: `+91 ${mobile}`, password: "correct-horse" } });
    expect(good.status).toBe(200);
    expect(good.cookie).toBeTruthy();

    const bad = await call("POST", "/auth/login", { body: { identifier: mobile, password: "nope-nope" } });
    const unknown = await call("POST", "/auth/login", { body: { identifier: "9999999999", password: "nope-nope" } });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body.error.message).toBe(unknown.body.error.message);
  });

  it("logs out and invalidates the session server-side", async () => {
    const { cookie } = await signupOwner();
    expect((await call("GET", "/me", { cookie })).status).toBe(200);
    await call("POST", "/auth/logout", { cookie });
    const after = await call("GET", "/me", { cookie });
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("resets a password with a single-use token and revokes sessions", async () => {
    const { mobile, cookie } = await signupOwner({ password: "old-password" });
    const forgot = await call("POST", "/auth/forgot-password", { body: { identifier: mobile } });
    expect(forgot.status).toBe(200);
    const link = new URL(forgot.body.data.devResetLink);
    const token = link.searchParams.get("token")!;

    const reset = await call("POST", "/auth/reset-password", { body: { token, password: "new-password-1" } });
    expect(reset.status).toBe(200);
    expect((await call("GET", "/me", { cookie })).status).toBe(401);
    expect((await call("POST", "/auth/login", { body: { identifier: mobile, password: "new-password-1" } })).status).toBe(200);

    const reuse = await call("POST", "/auth/reset-password", { body: { token, password: "another-pass-2" } });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe("INVALID_TOKEN");
  });

  it("does not reveal whether an account exists on forgot-password", async () => {
    const res = await call("POST", "/auth/forgot-password", { body: { identifier: "9123456780" } });
    expect(res.status).toBe(200);
    expect(res.body.data.devResetLink).toBeUndefined();
  });

  it("blocks cross-origin state-changing requests (CSRF)", async () => {
    const res = await call("POST", "/auth/login", { body: { identifier: "9876543210", password: "x" }, origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CSRF_REJECTED");
    const noOrigin = await call("POST", "/auth/login", { body: { identifier: "9876543210", password: "x" }, origin: null });
    expect(noOrigin.status).toBe(403);
  });

  it("validates input with a standard error envelope", async () => {
    const res = await call("POST", "/auth/signup", { body: { name: "A", mobile: "123" } });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
