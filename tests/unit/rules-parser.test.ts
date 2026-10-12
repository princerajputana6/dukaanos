import { describe, expect, it } from "vitest";
import { parsedIntentSchema } from "@/server/ai/contract";
import { parseWithRules } from "@/server/ai/rules-parser";

const p = (s: string) => {
  const r = parseWithRules(s);
  expect(parsedIntentSchema.safeParse(r).success).toBe(true);
  return r;
};

describe("rules parser — mutations", () => {
  it.each([
    ["Aaj 20 Coke aur 10 Sprite biki.", [["Coke", 20], ["Sprite", 10]]],
    ["20 Coke bechi", [["Coke", 20]]],
    ["20 Coke sold", [["Coke", 20]]],
    ["Aaj 10 Sprite nikli", [["Sprite", 10]]],
    ["do Parle G aur teen chips biki", [["Parle G", 2], ["chips", 3]]],
    ["आज 20 कोक बिकी", [["kok", 20]]],
    ["sold 5 coke 500ml and 2 bread", [["coke 500 ml", 5], ["bread", 2]]],
  ])("sale: %s", (text, expected) => {
    const r = p(text);
    expect(r.intent).toBe("CREATE_SALE");
    expect(r.requires_confirmation).toBe(true);
    expect(r.entities.items?.map((i) => [i.query, i.quantity])).toEqual(expected);
  });

  it("follow-up sale without a product: '10 aur bech di'", () => {
    const r = p("10 aur bech di");
    expect(r.intent).toBe("CREATE_SALE");
    expect(r.entities.items).toEqual([{ query: null, quantity: 10, unit: null, price_rupees: null }]);
  });

  it("credit sale to a customer", () => {
    const r = p("Ramesh ko 5 Coke udhaar pe diye");
    expect(r.intent).toBe("CREATE_SALE");
    expect(r.entities.customer).toBe("Ramesh");
    expect(r.entities.payment_method).toBe("CREDIT");
    expect(r.entities.items?.[0]).toMatchObject({ query: "Coke", quantity: 5 });
  });

  it("purchase with supplier and pack unit", () => {
    const r = p("Sharma se 3 crate Coke aayi");
    expect(r.intent).toBe("CREATE_PURCHASE");
    expect(r.entities.supplier).toBe("Sharma");
    expect(r.entities.items?.[0]).toMatchObject({ query: "Coke", quantity: 3, unit: "crate" });
  });

  it("manual udhaar", () => {
    const r = p("Ramesh ka 850 udhaar likh do");
    expect(r.intent).toBe("CREATE_CREDIT");
    expect(r.entities).toMatchObject({ customer: "Ramesh", amount_rupees: 850 });
  });

  it.each(["Ramesh ne 500 de diye", "Ramesh ne ₹500 diye", "Ramesh se 500 rupaye mile"])("customer payment: %s", (text) => {
    const r = p(text);
    expect(r.intent).toBe("CREATE_PAYMENT");
    expect(r.entities).toMatchObject({ customer: "Ramesh", amount_rupees: 500, direction: "received" });
  });

  it("supplier payment", () => {
    const r = p("Sharma ko 2000 rupaye diye UPI se");
    expect(r.intent).toBe("CREATE_PAYMENT");
    expect(r.entities).toMatchObject({ supplier: "Sharma", amount_rupees: 2000, direction: "paid", payment_method: "UPI" });
  });

  it("hindi number words with multipliers", () => {
    expect(p("Ramesh ne paanch sau diye").entities.amount_rupees).toBe(500);
    expect(p("bijli ka bill 1,200 diya").entities.amount_rupees).toBe(1200);
  });

  it.each([
    ["Bijli ka bill 1200 diya", "Electricity", 1200],
    ["dukaan ka kiraya 8000", "Rent", 8000],
    ["500 ka kharcha chai nashta", "Other", 500],
  ])("expense: %s", (text, category, amount) => {
    const r = p(text);
    expect(r.intent).toBe("CREATE_EXPENSE");
    expect(r.entities).toMatchObject({ expense_category: category, amount_rupees: amount });
  });

  it("damage adjustment", () => {
    const r = p("2 Coke toot gayi");
    expect(r.intent).toBe("ADJUST_STOCK");
    expect(r.entities).toMatchObject({ adjustment_type: "DAMAGE", stock_direction: "decrease" });
    expect(r.entities.items?.[0]).toMatchObject({ query: "Coke", quantity: 2 });
  });

  it("new customer with phone", () => {
    const r = p("naya customer Amit 98765 43210");
    expect(r.intent).toBe("CREATE_CUSTOMER");
    expect(r.entities).toMatchObject({ customer: "Amit", phone: "9876543210" });
  });

  it("undo", () => {
    expect(p("undo last sale").intent).toBe("UNDO_TRANSACTION");
    expect(p("pichli sale cancel karo").entities.undo_target).toBe("sale");
  });
});

describe("rules parser — questions", () => {
  it.each([
    ["Coke kitni bachi hai?", "CHECK_STOCK"],
    ["Coke ka stock kitna hai", "CHECK_STOCK"],
    ["Aaj kitni sale hui?", "CHECK_SALES"],
    ["Kal ka total sale batao", "CHECK_SALES"],
    ["Is month ka profit kitna hai?", "CHECK_PROFIT"],
    ["Kaunsa product low stock hai?", "LOW_STOCK_QUERY"],
    ["Aaj ka business kaisa raha?", "DAILY_SUMMARY"],
    ["Ramesh ka kitna baki hai?", "CHECK_OUTSTANDING"],
    ["how much stock of sprite is left?", "CHECK_STOCK"],
  ])("%s → %s", (text, intent) => {
    const r = p(text);
    expect(r.intent).toBe(intent);
    expect(r.requires_confirmation).toBe(false);
  });

  it("extracts products and periods", () => {
    expect(p("Coke kitni bachi hai?").entities.items?.[0]?.query).toBe("Coke");
    expect(p("Kal ka total sale batao").entities.period).toBe("yesterday");
    expect(p("Is month ka profit kitna hai?").entities.period).toBe("this_month");
    expect(p("Ramesh ka kitna baki hai?").entities.customer).toBe("Ramesh");
  });

  it("returns UNKNOWN for gibberish", () => {
    expect(p("asdf qwerty").intent).toBe("UNKNOWN");
  });
});

describe("rules parser — Devanagari transcripts (server speech / Whisper)", () => {
  const p2 = (s: string) => parseWithRules(s);
  it.each([
    ["आज 20 कोक बिकी।", "CREATE_SALE"],
    ["आज बीस कोक और दस स्प्राइट बिकी", "CREATE_SALE"],
    ["रमेश ने 500 रुपये दिए", "CREATE_PAYMENT"],
    ["रमेश का 850 उधार लिख दो", "CREATE_CREDIT"],
    ["कोक कितनी बची है?", "CHECK_STOCK"],
    ["आज कितनी सेल हुई?", "CHECK_SALES"],
    ["इस महीने का मुनाफा कितना है?", "CHECK_PROFIT"],
    ["बिजली का बिल 1200 दिया", "CREATE_EXPENSE"],
    ["शर्मा से 3 क्रेट कोक आई", "CREATE_PURCHASE"],
  ])("%s → %s", (text, intent) => {
    expect(p2(text).intent).toBe(intent);
  });

  it("keeps the product and quantity", () => {
    const r = p2("आज बीस कोक और दस स्प्राइट बिकी");
    expect(r.entities.items?.map((i) => i.quantity)).toEqual([20, 10]);
    expect(r.entities.items?.every((i) => i.query)).toBe(true);
    expect(p2("रमेश ने 500 रुपये दिए").entities).toMatchObject({ amount_rupees: 500, direction: "received" });
  });

  it("does not rewrite product names into command words", () => {
    const r = p2("5 dal biki");
    expect(r.entities.items?.[0]?.query).toBe("dal");
  });

  it("treats a bare 'quantity + product' as a sale", () => {
    for (const [text, query] of [["Two water bottle.", "water"], ["do pani ki bottle", "pani"], ["दो पानी की बोतल", "paanee"], ["3 Maggi", "Maggi"]] as const) {
      const r = p2(text);
      expect(r.intent, text).toBe("CREATE_SALE");
      expect(r.confidence).toBeGreaterThanOrEqual(0.9);
      expect(r.entities.items?.[0]).toMatchObject({ query, quantity: Number(text.match(/\d/)?.[0] ?? 2) || 2 });
    }
    expect(p2("Two water bottle.").entities.items?.[0]?.unit).toBe("bottle");
  });

  it("does not turn questions, money or expenses into implicit sales", () => {
    expect(p2("coke kitni hai").intent).toBe("CHECK_STOCK");
    expect(p2("Ramesh 500").intent).not.toBe("CREATE_SALE");
    expect(p2("bijli 500").intent).toBe("CREATE_EXPENSE");
    expect(p2("chai 20 rupaye").intent).toBe("CREATE_EXPENSE");
  });
});

