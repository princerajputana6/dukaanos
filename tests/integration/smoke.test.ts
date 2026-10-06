import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("database", () => {
  it("has reference data and the stock guard trigger", async () => {
    const perms = await env.DB.prepare("SELECT COUNT(*) AS n FROM permissions").first<{ n: number }>();
    expect(perms?.n).toBe(15);
    const trg = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all();
    expect(trg.results.map((r: Record<string, unknown>) => r.name)).toContain("trg_products_stock_guard");
  });
});
