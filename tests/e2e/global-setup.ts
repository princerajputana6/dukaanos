import { mkdirSync } from "node:fs";
import { request, type FullConfig } from "@playwright/test";

/** Creates one onboarded owner with sample products; its cookie is reused by the specs. */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!;
  const ctx = await request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL } });
  const mobile = `98${String(Date.now()).slice(-8)}`;
  const res = await ctx.post("/api/auth/signup", {
    data: { name: "E2E Owner", mobile, password: "e2e-password-1", businessName: "E2E General Store", businessType: "grocery", city: "Jaipur" },
  });
  if (!res.ok()) throw new Error(`signup failed: ${res.status()} ${await res.text()}`);
  await ctx.post("/api/products/samples");
  await ctx.post("/api/customers", { data: { name: "Ramesh", phone: "9811000001" } });
  const done = await ctx.post("/api/business/onboarding", { data: { step: 5, complete: true } });
  if (!done.ok()) throw new Error(`onboarding failed: ${await done.text()}`);
  mkdirSync("tests/e2e/.auth", { recursive: true });
  await ctx.storageState({ path: "tests/e2e/.auth/owner.json" });
  await ctx.dispose();
}
