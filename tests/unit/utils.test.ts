import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvObjects, toCsv } from "@/lib/csv";
import { addDays, endOfMonth, isValidIsoDate, startOfWeek, toIstDate } from "@/lib/dates";
import { formatQty, lineAmount, toMilli } from "@/lib/qty";
import { buildSearchText, normalizeMobile, normalizeText, phoneticKey, transliterate } from "@/lib/text";
import { redact } from "@/server/lib/logger";

describe("quantities", () => {
  it("converts to integer milli-units without float drift", () => {
    expect(toMilli("0.1")).toBe(100);
    expect(toMilli(2.5)).toBe(2500);
    expect(toMilli("1.2345")).toBeNull();
    expect(formatQty(2500)).toBe("2.5");
    expect(formatQty(1234567)).toBe("1,234.567");
    expect(lineAmount(4500, 500)).toBe(2250);
    expect(lineAmount(333, 3000)).toBe(999);
  });
});

describe("IST dates", () => {
  it("uses Asia/Kolkata for business dates", () => {
    // 20:00 UTC on 24 Sep = 01:30 IST on 25 Sep
    expect(toIstDate(Date.parse("2026-09-24T20:00:00Z"))).toBe("2026-09-25");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
    expect(startOfWeek("2026-09-25")).toBe("2026-09-21");
    expect(isValidIsoDate("2026-02-30")).toBe(false);
  });
});

describe("Hindi / Hinglish text", () => {
  it("transliterates Devanagari and matches phonetically", () => {
    expect(transliterate("कोक")).toBe("kok");
    expect(phoneticKey("कोक")).toBe(phoneticKey("coke"));
    expect(phoneticKey("पेप्सी")).toBe(phoneticKey("pepsi"));
    expect(phoneticKey("doodh")).toBe(phoneticKey("dudh"));
    expect(normalizeText("Coke 500ML")).toBe("coke 500 ml");
    expect(normalizeText("1 Litre")).toBe("1 l");
    expect(buildSearchText("Coke 500ml", "कोक")).toContain("kak");
  });
  it("normalises Indian mobile numbers", () => {
    expect(normalizeMobile("+91 98765-43210")).toBe("9876543210");
    expect(normalizeMobile("09876543210")).toBe("9876543210");
    expect(normalizeMobile("12345")).toBeNull();
    expect(normalizeMobile("1234567890")).toBeNull();
  });
});

describe("CSV", () => {
  it("parses quotes, escaped quotes, CRLF and BOM", () => {
    const rows = parseCsv('﻿name,note\r\n"Coke, 500ml","say ""hi"""\r\n');
    expect(rows).toEqual([["name", "note"], ["Coke, 500ml", 'say "hi"']]);
    expect(parseCsvObjects("Name,Selling Price\nMilk,29")[0]).toEqual({ name: "Milk", selling_price: "29" });
  });
  it("neutralises spreadsheet formula injection on export", () => {
    expect(toCsv(["a"], [["=HYPERLINK(1)"]])).toContain("'=HYPERLINK(1)");
    expect(toCsv(["a"], [["-12.50"]])).toContain("-12.50");
  });
});

describe("logging", () => {
  it("redacts secrets recursively", () => {
    expect(redact({ password: "x", nested: { token: "y", ok: 1 }, list: [{ apiKey: "z" }] })).toEqual({
      password: "[REDACTED]",
      nested: { token: "[REDACTED]", ok: 1 },
      list: [{ apiKey: "[REDACTED]" }],
    });
  });
});
