import { describe, expect, it } from "vitest";
import { resolveOne, type MatchCandidate } from "@/server/ai/matching";

const products: MatchCandidate<string>[] = [
  { value: "coke250", name: "Coke 250ml", aliases: ["Coke", "Coca Cola", "कोक"], popularity: 5 },
  { value: "coke500", name: "Coke 500ml", aliases: ["Coke", "Coca Cola", "Coke bottle", "500 Coke", "कोक"], popularity: 9 },
  { value: "coke750", name: "Coke 750ml", aliases: [], popularity: 1 },
  { value: "sprite250", name: "Sprite 250ml", aliases: ["Sprite"] },
  { value: "pepsi500", name: "Pepsi 500ml", aliases: ["Pepsi", "पेप्सी"] },
  { value: "parle", name: "Parle-G Biscuit 100g", aliases: ["Biscuit", "Parle G"] },
  { value: "milk", name: "Amul Milk 500ml", aliases: ["Milk", "Doodh", "दूध"] },
  { value: "chips", name: "Lay's Chips 52g", aliases: ["Chips", "Lays"] },
];

describe("product resolution", () => {
  it("asks which Coke when several SKUs match (never guesses)", () => {
    const r = resolveOne("Coke", products);
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") expect(r.options.map((o) => o.value)).toEqual(expect.arrayContaining(["coke250", "coke500", "coke750"]));
  });

  it("resolves when the size disambiguates", () => {
    for (const q of ["Coke 500ml", "coke 500", "500 coke", "coke 500 ml"]) {
      const r = resolveOne(q, products);
      expect(r.status, q).toBe("resolved");
      if (r.status === "resolved") expect(r.match.value).toBe("coke500");
    }
  });

  it("resolves aliases, Hinglish spellings and Devanagari", () => {
    const cases: Array<[string, string]> = [
      ["Sprite", "sprite250"],
      ["spirte", "sprite250"],
      ["पेप्सी", "pepsi500"],
      ["doodh", "milk"],
      ["dudh", "milk"],
      ["दूध", "milk"],
      ["parle g", "parle"],
      ["biskut", "parle"],
      ["lays", "chips"],
    ];
    for (const [q, expected] of cases) {
      const r = resolveOne(q, products);
      expect(r.status, q).toBe("resolved");
      if (r.status === "resolved") expect(r.match.value, q).toBe(expected);
    }
  });

  it("reports not found (with suggestions) instead of inventing products", () => {
    const r = resolveOne("Thums Up", products);
    expect(r.status).toBe("not_found");
    expect(resolveOne("Maggi", products).status).toBe("not_found");
  });
});

describe("customer resolution", () => {
  const customers: MatchCandidate<string>[] = [
    { value: "r1", name: "Ramesh Kumar", aliases: [] },
    { value: "r2", name: "Ramesh Gupta", aliases: [] },
    { value: "s", name: "Suresh", aliases: [] },
    { value: "a", name: "Amit", aliases: [] },
  ];
  it("disambiguates people with the same first name", () => {
    expect(resolveOne("Ramesh", customers).status).toBe("ambiguous");
    const r = resolveOne("Ramesh Gupta", customers);
    expect(r.status === "resolved" && r.match.value).toBe("r2");
    const s = resolveOne("suresh", customers);
    expect(s.status === "resolved" && s.match.value).toBe("s");
  });
});
