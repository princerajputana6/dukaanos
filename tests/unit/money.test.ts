import { describe, expect, it } from "vitest";
import { allocateProportionally, formatMoney, parseRupees, roundDiv } from "@/lib/money";

describe("money", () => {
  it("parses rupees into paise", () => {
    expect(parseRupees("100.50")).toBe(10050);
    expect(parseRupees("₹1,250.5")).toBe(125050);
  });
  it("rounds half away from zero", () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(-5, 2)).toBe(-3);
  });
  it("allocates exactly", () => {
    expect(allocateProportionally(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
  it("formats INR", () => {
    expect(formatMoney(12345650)).toBe("₹1,23,456.50");
  });
});
