import { describe, expect, it } from "vitest";
import { allocateProportionally } from "@/lib/money";
import { priceDocument, PricingError } from "@/lib/pricing";

describe("GST pricing", () => {
  it("splits GST-inclusive prices into taxable + CGST/SGST", () => {
    // 2 × ₹59 at 18% inclusive = ₹118 → taxable ₹100, tax ₹18
    const doc = priceDocument({ lines: [{ unitPricePaise: 5900, quantityMilli: 2000, gstRateBp: 1800 }], pricesIncludeGst: true, interstate: false });
    expect(doc.totalPaise).toBe(11800);
    expect(doc.taxablePaise).toBe(10000);
    expect(doc.taxPaise).toBe(1800);
    expect(doc.cgstPaise).toBe(900);
    expect(doc.sgstPaise).toBe(900);
    expect(doc.igstPaise).toBe(0);
  });

  it("adds GST on top for exclusive prices and uses IGST inter-state", () => {
    const doc = priceDocument({ lines: [{ unitPricePaise: 10000, quantityMilli: 1000, gstRateBp: 1200 }], pricesIncludeGst: false, interstate: true });
    expect(doc.taxablePaise).toBe(10000);
    expect(doc.igstPaise).toBe(1200);
    expect(doc.cgstPaise + doc.sgstPaise).toBe(0);
    expect(doc.totalPaise).toBe(11200);
  });

  it("handles odd tax paise without losing a paisa", () => {
    const doc = priceDocument({ lines: [{ unitPricePaise: 1001, quantityMilli: 1000, gstRateBp: 500 }], pricesIncludeGst: true, interstate: false });
    expect(doc.cgstPaise + doc.sgstPaise).toBe(doc.taxPaise);
    expect(doc.taxablePaise + doc.taxPaise).toBe(1001);
  });

  it("prices fractional quantities (0.5 kg) exactly", () => {
    const doc = priceDocument({ lines: [{ unitPricePaise: 4500, quantityMilli: 500, gstRateBp: 0 }], pricesIncludeGst: true, interstate: false });
    expect(doc.totalPaise).toBe(2250);
  });

  it("allocates bill discounts across lines and keeps totals consistent", () => {
    const doc = priceDocument({
      lines: [
        { unitPricePaise: 4000, quantityMilli: 20000, gstRateBp: 1800 },
        { unitPricePaise: 2000, quantityMilli: 10000, gstRateBp: 500 },
      ],
      billDiscountPaise: 10000,
      pricesIncludeGst: true,
      interstate: false,
    });
    expect(doc.subtotalPaise).toBe(100000);
    expect(doc.discountPaise).toBe(10000);
    expect(doc.totalPaise).toBe(90000);
    expect(doc.lines.reduce((a, l) => a + l.totalPaise, 0)).toBe(doc.totalPaise);
  });

  it("rejects invalid discounts and quantities", () => {
    expect(() => priceDocument({ lines: [{ unitPricePaise: 100, quantityMilli: 1000, discountPaise: 200, gstRateBp: 0 }], pricesIncludeGst: true, interstate: false })).toThrow(PricingError);
    expect(() => priceDocument({ lines: [{ unitPricePaise: 100, quantityMilli: 0, gstRateBp: 0 }], pricesIncludeGst: true, interstate: false })).toThrow(PricingError);
    expect(() => priceDocument({ lines: [{ unitPricePaise: 100, quantityMilli: 1000, gstRateBp: 0 }], billDiscountPaise: 101, pricesIncludeGst: true, interstate: false })).toThrow(PricingError);
  });

  it("totals always equal taxable + tax (property check)", () => {
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const rates = [0, 25, 300, 500, 1200, 1800, 2800];
    for (let i = 0; i < 500; i++) {
      const lines = Array.from({ length: 1 + rnd(5) }, () => ({ unitPricePaise: rnd(100000), quantityMilli: 1 + rnd(50000), gstRateBp: rates[rnd(rates.length)]! }));
      const gross = lines.reduce((a, l) => a + Math.round((l.unitPricePaise * l.quantityMilli) / 1000), 0);
      const doc = priceDocument({ lines, billDiscountPaise: rnd(Math.max(1, gross)), pricesIncludeGst: rnd(2) === 0, interstate: rnd(2) === 0 });
      expect(doc.totalPaise).toBe(doc.taxablePaise + doc.taxPaise);
      expect(doc.taxPaise).toBe(doc.cgstPaise + doc.sgstPaise + doc.igstPaise);
      expect(doc.lines.every((l) => l.taxablePaise >= 0 && l.taxPaise >= 0)).toBe(true);
    }
  });
});

describe("allocateProportionally", () => {
  it("always sums to the total", () => {
    for (const [t, w] of [[10, [1, 2, 3]], [7, [0, 0, 5]], [1000001, [333, 333, 334]], [5, [0, 0]]] as const) {
      expect(allocateProportionally(t, w).reduce((a, b) => a + b, 0)).toBe(t);
    }
  });
});
