/**
 * Captures real app screenshots for the marketing site into public/marketing/.
 *
 *   pnpm build && pnpm marketing:screens
 *
 * Seeds a throwaway local database (.wrangler/screens-state) with the demo shop, runs the
 * production build against it, and drives Chromium with Playwright. Never touches your
 * normal local or remote data.
 */
import { execSync, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

const ROOT = path.resolve(import.meta.dirname, "..");
const STATE = ".wrangler/screens-state";
const PORT = 8793;
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(ROOT, "public/marketing");
// Demo owner from scripts/seed.ts (local-only test account).
const OWNER = { identifier: "9876543210", password: "dukaan123" };

const sh = (cmd: string, env: Record<string, string> = {}) => execSync(cmd, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } });

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("server did not start");
}

async function login(ctx: BrowserContext) {
  const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: OWNER, headers: { origin: BASE } });
  if (!res.ok()) throw new Error(`login failed: ${res.status()} ${await res.text()}`);
}

async function settle(page: Page) {
  await page.waitForSelector("html[data-hydrated]", { state: "attached", timeout: 30_000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  // Hide toasts / install prompts so they never appear in marketing shots.
  await page.addStyleTag({ content: "[data-sonner-toaster],[data-install-prompt]{display:none!important} *{caret-color:transparent!important}" });
  await page.waitForTimeout(800);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 82 });
  console.log(`  ✓ ${name}.jpg`);
}

async function main() {
  rmSync(path.join(ROOT, STATE), { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  sh(`npx wrangler d1 migrations apply dukaanos-dev --local --persist-to ${STATE} --config wrangler.jsonc`);
  sh("npx tsx scripts/seed.ts", { SEED_PERSIST_TO: STATE });

  const server = spawn("npx", ["wrangler", "dev", "--config", "dist/server/wrangler.json", "--port", String(PORT), "--persist-to", STATE], { cwd: ROOT, stdio: "ignore" });
  try {
    await waitForServer();
    const browser = await chromium.launch();

    // ── Phone shots (390×844 @3x) ──────────────────────────────────────────
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "light", locale: "en-IN" });
    await login(phone);
    const p = await phone.newPage();

    await p.goto(`${BASE}/dashboard`);
    await settle(p);
    await shot(p, "dashboard");

    await p.goto(`${BASE}/inventory`);
    await settle(p);
    await shot(p, "inventory");

    await p.goto(`${BASE}/customers`);
    await settle(p);
    await shot(p, "khata");

    // Voice flow: typed into the assistant (same pipeline as speech), up to the confirmation card.
    await p.goto(`${BASE}/ai`);
    await settle(p);
    const box = p.getByRole("textbox").last();
    await box.fill("Aaj 20 Coke 500ml aur 10 Sprite 250ml biki");
    await box.press("Enter");
    await p.getByRole("region", { name: "Confirm action" }).last().waitFor({ timeout: 30_000 });
    await p.waitForTimeout(600);
    await p.getByRole("region", { name: "Confirm action" }).last().scrollIntoViewIfNeeded();
    await shot(p, "voice-confirm");

    // ── Desktop shots (1440×900 @2x) ───────────────────────────────────────
    const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light", locale: "en-IN" });
    await login(desk);
    const d = await desk.newPage();
    await d.goto(`${BASE}/reports`);
    await settle(d);
    await shot(d, "reports-desktop");
    await d.goto(`${BASE}/dashboard`);
    await settle(d);
    await shot(d, "dashboard-desktop");

    // Social preview image (1200×630).
    const og = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, colorScheme: "light" });
    const o = await og.newPage();
    await o.goto(`${BASE}/`);
    await settle(o);
    await shot(o, "og");

    await browser.close();
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
