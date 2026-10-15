import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { newId } from "@/lib/ids";
import { getDb } from "@/server/db/client";
import { runDailyJobs } from "@/server/services/notifications";
import { createLogger } from "@/server/lib/logger";
import { call, createProduct, key, signupOwner } from "./helpers";

async function superAdmin() {
  const a = await signupOwner({ businessName: "Platform HQ" });
  await env.DB.prepare("UPDATE users SET platform_role = 'SUPER_ADMIN' WHERE id = ?").bind(a.userId).run();
  return a;
}

/** Insert a provider-usage row directly (mimics what the AI path records). */
async function seedUsage(businessId: string, row: { task: string; model: string; cost: number; inTok?: number; outTok?: number; audioMs?: number }) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO ai_usage_events (id, business_id, provider, model, task, input_tokens, output_tokens, cached_tokens, audio_ms, est_cost_micros, price_version, status, retry_count, created_at)
     VALUES (?, ?, 'workers-ai', ?, ?, ?, ?, 0, ?, ?, '2026-10-15', 'ok', 0, ?)`,
  )
    .bind(newId(now), businessId, row.model, row.task, row.inTok ?? 0, row.outTok ?? 0, row.audioMs ?? 0, row.cost, now)
    .run();
}

describe("AI usage metering & budgets", () => {
  it("aggregates provider usage for the super admin, and only super admins can see it", async () => {
    const admin = await superAdmin();
    const owner = await signupOwner({ businessName: "Sharma Store" });
    await seedUsage(owner.businessId, { task: "intent", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", cost: 40, inTok: 1200, outTok: 300 });
    await seedUsage(owner.businessId, { task: "stt", model: "@cf/openai/whisper-large-v3-turbo", cost: 300, audioMs: 3000 });

    const forbidden = await call("GET", "/admin/ai-usage", { cookie: owner.cookie });
    expect(forbidden.status).toBe(403);

    const res = await call("GET", "/admin/ai-usage?days=30", { cookie: admin.cookie });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.totals.calls).toBe(2);
    expect(d.totals.costMicros).toBe(340);
    expect(d.priceVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.byTask.map((t: { task: string }) => t.task).sort()).toEqual(["intent", "stt"]);
    const biz = d.topBusinesses.find((b: { businessId: string }) => b.businessId === owner.businessId);
    expect(biz).toMatchObject({ calls: 2, costMicros: 340, killSwitch: false, monthlyCapMicros: null });
  });

  it("lets the super admin set a cap / kill switch, recorded in the platform audit log", async () => {
    const admin = await superAdmin();
    const owner = await signupOwner();
    await seedUsage(owner.businessId, { task: "intent", model: "m", cost: 10 });

    const put = await call("PUT", `/admin/ai-budget/${owner.businessId}`, { cookie: admin.cookie, body: { monthlyCapRupees: 200, killSwitch: false, alertPct: 80 } });
    expect(put.status).toBe(200);

    const usage = await call("GET", "/admin/ai-usage", { cookie: admin.cookie });
    const biz = usage.body.data.topBusinesses.find((b: { businessId: string }) => b.businessId === owner.businessId);
    expect(biz.monthlyCapMicros).toBe(200_000_000); // ₹200 → micros

    const kill = await call("PUT", `/admin/ai-budget/${owner.businessId}`, { cookie: admin.cookie, body: { monthlyCapRupees: null, killSwitch: true, alertPct: 80 } });
    expect(kill.status).toBe(200);
    const row = await env.DB.prepare("SELECT kill_switch FROM ai_budgets WHERE business_id = ?").bind(owner.businessId).first<{ kill_switch: number }>();
    expect(row?.kill_switch).toBe(1);
    const audit = await env.DB.prepare("SELECT action FROM platform_audit_logs WHERE action = 'AI_BUDGET_SET' AND target_id = ?").bind(owner.businessId).first();
    expect(audit).toBeTruthy();
  });

  it("an exhausted/off AI budget never blocks core billing or stock", async () => {
    const owner = await signupOwner();
    const admin = await superAdmin();
    // Turn AI off for the shop entirely.
    await call("PUT", `/admin/ai-budget/${owner.businessId}`, { cookie: admin.cookie, body: { monthlyCapRupees: 0, killSwitch: true, alertPct: 80 } });

    const coke = await createProduct(owner.cookie, { name: "Coke 500ml", sellingPricePaise: 4000, purchasePricePaise: 3300, gstRateBp: 1800, openingStockMilli: 34000 });
    const sale = await call("POST", "/sales", { cookie: owner.cookie, idempotencyKey: key(), body: { items: [{ productId: coke, quantityMilli: 2000 }], payment: { method: "CASH" } } });
    expect(sale.status).toBe(201);
    expect(sale.body.data.invoiceNumber).toBe("INV-0001");

    const stock = await env.DB.prepare("SELECT current_stock_milli AS s FROM products WHERE id = ?").bind(coke).first<{ s: number }>();
    expect(stock?.s).toBe(32000); // 34 - 2 bottles, billing unaffected by AI budget
  });

  it("shows a shop its own month-to-date AI usage and limit", async () => {
    const admin = await superAdmin();
    const owner = await signupOwner();
    await seedUsage(owner.businessId, { task: "intent", model: "m", cost: 120, inTok: 800, outTok: 200 });
    await seedUsage(owner.businessId, { task: "stt", model: "w", cost: 300, audioMs: 3000 });
    await call("PUT", `/admin/ai-budget/${owner.businessId}`, { cookie: admin.cookie, body: { monthlyCapRupees: 10, killSwitch: false, alertPct: 80 } });

    const r = await call("GET", "/business/ai-usage", { cookie: owner.cookie });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ monthSpendMicros: 420, monthCapMicros: 10_000_000, killSwitch: false, callsThisMonth: 2 });
    expect(r.body.data.pctUsed).toBe(0); // 420 micros of ₹10 cap rounds to 0%
    expect(r.body.data.byTask.map((t: { task: string }) => t.task).sort()).toEqual(["intent", "stt"]);
  });

  it("raises a daily notification when a shop crosses its AI budget threshold", async () => {
    const admin = await superAdmin();
    const owner = await signupOwner();
    await env.DB.prepare("UPDATE businesses SET onboarded_at = ? WHERE id = ?").bind(Date.now(), owner.businessId).run();
    // Cap ₹10 (=10,000,000 micros), alert at 80% → threshold 8,000,000. Seed 9,000,000 micros spent.
    await call("PUT", `/admin/ai-budget/${owner.businessId}`, { cookie: admin.cookie, body: { monthlyCapRupees: 10, killSwitch: false, alertPct: 80 } });
    await seedUsage(owner.businessId, { task: "intent", model: "m", cost: 9_000_000 });

    await runDailyJobs(getDb(env.DB), env, Date.now(), createLogger({ test: "cron" }));
    const note = await env.DB.prepare("SELECT title, type, link FROM notifications WHERE business_id = ? AND type = 'AI_BUDGET'").bind(owner.businessId).first<{ title: string; link: string }>();
    expect(note).toBeTruthy();
    expect(note!.link).toBe("/settings/ai-usage");
  });
});

