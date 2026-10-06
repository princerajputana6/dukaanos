import { env } from "cloudflare:workers";
import { getApp } from "@/server/api/app";

const ORIGIN = "http://localhost";
let mobileSeq = 0;

export interface ApiResult<T = any> {
  status: number;
  body: { success: boolean; data: T; error: { code: string; message: string } };
  cookie: string | null;
  headers: Headers;
}

export async function call<T = any>(
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string | null; idempotencyKey?: string; origin?: string | null; headers?: Record<string, string> } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  const res = await getApp().fetch(
    new Request(`${ORIGIN}/api${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }),
    env,
  );
  const setCookie = res.headers.get("set-cookie");
  const cookie = setCookie ? setCookie.split(";")[0] ?? null : null;
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, cookie, headers: res.headers };
}

/** Unique valid Indian mobile per call. */
export function nextMobile(): string {
  mobileSeq += 1;
  return `9${String(Date.now() % 1e5).padStart(5, "0")}${String(mobileSeq).padStart(4, "0")}`;
}

export async function signupOwner(overrides: Record<string, unknown> = {}) {
  const mobile = nextMobile();
  const res = await call("POST", "/auth/signup", {
    body: {
      name: "Prince Sharma",
      mobile,
      password: "secret-pass-1",
      businessName: "Sharma General Store",
      businessType: "grocery",
      city: "Jaipur",
      ...overrides,
    },
  });
  if (res.status !== 201) throw new Error(`signup failed: ${JSON.stringify(res.body)}`);
  return { cookie: res.cookie!, mobile, businessId: res.body.data.businessId as string, userId: res.body.data.userId as string };
}

export function key(): string {
  return crypto.randomUUID();
}

export async function createProduct(cookie: string, overrides: Record<string, unknown> = {}) {
  const res = await call("POST", "/products", {
    cookie,
    idempotencyKey: key(),
    body: { name: `Product ${Math.random().toString(36).slice(2, 7)}`, sellingPricePaise: 4000, purchasePricePaise: 3000, gstRateBp: 1800, openingStockMilli: 50000, lowStockThresholdMilli: 10000, ...overrides },
  });
  if (res.status !== 201) throw new Error(`createProduct failed: ${JSON.stringify(res.body)}`);
  return res.body.data.id as string;
}

export async function createCustomer(cookie: string, name = "Ramesh", extra: Record<string, unknown> = {}) {
  const res = await call("POST", "/customers", { cookie, idempotencyKey: key(), body: { name, ...extra } });
  if (res.status !== 201) throw new Error(`createCustomer failed: ${JSON.stringify(res.body)}`);
  return res.body.data.id as string;
}

export async function stockOf(cookie: string, productId: string): Promise<number> {
  const res = await call("GET", `/products/${productId}`, { cookie });
  return res.body.data.product.currentStockMilli;
}

/** Owner + a staff member of the same business; returns both cookies. */
export async function ownerAndStaff(role: "role_staff" | "role_manager" = "role_staff") {
  const owner = await signupOwner();
  const mobile = nextMobile();
  const add = await call("POST", "/team/members", { cookie: owner.cookie, body: { name: "Staff Member", mobile, roleId: role, password: "staff-pass-1" } });
  if (add.status !== 201) throw new Error(`add member failed: ${JSON.stringify(add.body)}`);
  const login = await call("POST", "/auth/login", { body: { identifier: mobile, password: "staff-pass-1" } });
  return { owner, staffCookie: login.cookie!, memberId: add.body.data.memberId as string };
}
