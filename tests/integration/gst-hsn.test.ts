import { describe, expect, it } from "vitest";
import { call, createProduct, key, signupOwner } from "./helpers";

async function getText(path: string, cookie?: string) {
  const { env } = await import("cloudflare:workers");
  const { getApp } = await import("@/server/api/app");
  const res = await getApp().fetch(new Request(`http://localhost/api${path}`, { headers: cookie ? { cookie } : {} }), env);
  return { status: res.status, text: await res.text() };
}

const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // IST calendar date
const range = `?from=${today}&to=${today}`;

describe("GST HSN summary (GSTR-1 HSN table)", () => {
  it("groups outward sales by HSN code and rate, and exports a CSV", async () => {
    const { cookie } = await signupOwner();
    // Two products sharing an HSN, one with a different HSN.
    const coke = await createProduct(cookie, { name: "Coke 500ml", sellingPricePaise: 4000, purchasePricePaise: 3000, gstRateBp: 1800, hsnCode: "2202", openingStockMilli: 50000 });
    const sprite = await createProduct(cookie, { name: "Sprite 500ml", sellingPricePaise: 4000, purchasePricePaise: 3000, gstRateBp: 1800, hsnCode: "2202", openingStockMilli: 50000 });
    const chips = await createProduct(cookie, { name: "Lays", sellingPricePaise: 2000, purchasePricePaise: 1500, gstRateBp: 1200, hsnCode: "2106", openingStockMilli: 50000 });

    await call("POST", "/sales", { cookie, idempotencyKey: key(), body: { items: [{ productId: coke, quantityMilli: 2000 }, { productId: sprite, quantityMilli: 3000 }, { productId: chips, quantityMilli: 1000 }], payment: { method: "CASH" } } });

    const r = await call("GET", `/reports/gst${range}`, { cookie });
    expect(r.status).toBe(200);
    const hsn = r.body.data.hsn as { hsnCode: string; rateBp: number; qtyMilli: number; taxablePaise: number }[];
    const h2202 = hsn.find((x) => x.hsnCode === "2202");
    const h2106 = hsn.find((x) => x.hsnCode === "2106");
    expect(h2202).toBeTruthy();
    expect(h2202!.rateBp).toBe(1800);
    expect(h2202!.qtyMilli).toBe(5000); // Coke 2 + Sprite 3, same HSN merged
    expect(h2106).toBeTruthy();
    expect(h2106!.qtyMilli).toBe(1000);

    const csv = await getText(`/reports/export/gst-hsn${range}`, cookie);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("hsn,gst_rate,quantity,taxable");
    expect(csv.text).toContain("2202");
    expect(csv.text).toContain("2106");
  });

  it("gates the GST report to reports.view", async () => {
    const { cookie } = await signupOwner();
    // Owner can see it; a staff-scoped read is covered by the shared reports guard.
    expect((await call("GET", `/reports/gst${range}`, { cookie })).status).toBe(200);
    expect((await getText(`/reports/export/gst-hsn${range}`)).status).toBe(401);
  });
});
