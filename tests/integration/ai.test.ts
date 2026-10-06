import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { call, createCustomer, ownerAndStaff, signupOwner, stockOf } from "./helpers";

async function setup() {
  const owner = await signupOwner();
  await call("POST", "/products/samples", { cookie: owner.cookie });
  const list = await call("GET", "/products?limit=100", { cookie: owner.cookie });
  const byName = (n: string) => list.body.data.items.find((p: { name: string }) => p.name === n).id as string;
  return { ...owner, byName };
}
const say = (cookie: string, text: string) => call("POST", "/ai/interpret", { cookie, body: { text } });
const salesCount = async (businessId: string) => (await env.DB.prepare("SELECT COUNT(*) AS n FROM sales WHERE business_id = ?").bind(businessId).first<{ n: number }>())!.n;

describe("AI assistant: voice → understand → confirm → execute", () => {
  it("asks which Coke/Sprite, previews exactly, and only writes on confirm", async () => {
    const { cookie, byName, businessId } = await setup();
    const coke500 = byName("Coke 500ml");
    const sprite250 = byName("Sprite 250ml");

    const r1 = await say(cookie, "Aaj 20 Coke aur 10 Sprite biki");
    expect(r1.body.data.status).toBe("NEEDS_CLARIFICATION");
    expect(r1.body.data.message).toMatch(/Coke/);
    expect(r1.body.data.clarification.options.map((o: { label: string }) => o.label)).toEqual(expect.arrayContaining(["Coke 250ml", "Coke 500ml"]));
    const id = r1.body.data.interactionId;

    const r2 = await call("POST", `/ai/interactions/${id}/clarify`, { cookie, body: { optionId: coke500 } });
    expect(r2.body.data.status).toBe("NEEDS_CLARIFICATION");
    expect(r2.body.data.message).toMatch(/Sprite/);

    const r3 = await call("POST", `/ai/interactions/${id}/clarify`, { cookie, body: { optionId: sprite250 } });
    expect(r3.body.data.status).toBe("PROPOSED");
    const view = r3.body.data.proposal.view;
    expect(view.lines.map((l: { label: string }) => l.label)).toEqual(["Coke 500ml", "Sprite 250ml"]);
    expect(view.totals.find((t: { emphasis?: boolean }) => t.emphasis).amountPaise).toBe(20 * 4000 + 10 * 2000);
    expect(view.stockImpact[0]).toMatchObject({ name: "Coke 500ml", beforeMilli: 34000, afterMilli: 14000 });

    // Nothing written yet.
    expect(await salesCount(businessId)).toBe(0);
    expect(await stockOf(cookie, coke500)).toBe(34000);

    const done = await call("POST", `/ai/interactions/${id}/confirm`, { cookie });
    expect(done.body.data.status).toBe("CONFIRMED");
    expect(done.body.data.message).toMatch(/Ho gaya/);
    expect(await stockOf(cookie, coke500)).toBe(14000);
    expect(await stockOf(cookie, sprite250)).toBe(26000);

    // Double-tap confirm executes once.
    const again = await call("POST", `/ai/interactions/${id}/confirm`, { cookie });
    expect(again.body.data.status).toBe("CONFIRMED");
    expect(await salesCount(businessId)).toBe(1);

    const sale = await call("GET", `/sales/${done.body.data.result.id}`, { cookie });
    expect(sale.body.data.sale.source).toBe("VOICE");
    const audit = await call("GET", "/audit?source=VOICE", { cookie });
    expect(audit.body.data.items[0].action).toBe("SALE_CREATED");
  });

  it("understands follow-ups from recent context ('10 aur bech di')", async () => {
    const { cookie, byName } = await setup();
    const q = await say(cookie, "Coke 500ml kitni bachi hai?");
    expect(q.body.data.status).toBe("ANSWERED");
    expect(q.body.data.message).toContain("34");
    const f = await say(cookie, "10 aur bech di");
    expect(f.body.data.status).toBe("PROPOSED");
    expect(f.body.data.contextNote).toMatch(/Coke 500ml/);
    expect(f.body.data.proposal.command.items[0]).toMatchObject({ productId: byName("Coke 500ml"), quantityMilli: 10000 });
  });

  it("does not let stale context drive an action", async () => {
    const { cookie, businessId } = await setup();
    await say(cookie, "Coke 500ml kitni bachi hai?");
    await env.DB.prepare("UPDATE ai_interactions SET created_at = created_at - 3600000 WHERE business_id = ?").bind(businessId).run();
    const f = await say(cookie, "10 aur bech di");
    expect(f.body.data.status).toBe("NEEDS_CLARIFICATION");
    expect(f.body.data.message).toMatch(/Kaunsa product/);
  });

  it("records customer payments and udhaar via voice", async () => {
    const { cookie } = await setup();
    const ramesh = await createCustomer(cookie, "Ramesh");
    const credit = await say(cookie, "Ramesh ka 850 udhaar likh do");
    expect(credit.body.data.proposal.kind).toBe("CREATE_CREDIT");
    await call("POST", `/ai/interactions/${credit.body.data.interactionId}/confirm`, { cookie });
    const pay = await say(cookie, "Ramesh ne ₹500 diye");
    expect(pay.body.data.proposal.kind).toBe("CUSTOMER_PAYMENT");
    expect(pay.body.data.proposal.view.totals.at(-1).amountPaise).toBe(35000);
    await call("POST", `/ai/interactions/${pay.body.data.interactionId}/confirm`, { cookie });
    const c = await call("GET", `/customers/${ramesh}`, { cookie });
    expect(c.body.data.customer.balancePaise).toBe(35000);
    const ask = await say(cookie, "Ramesh ka kitna baki hai?");
    expect(ask.body.data.message).toContain("350");
  });

  it("refuses to invent products and reports stock problems before confirming", async () => {
    const { cookie } = await setup();
    const unknown = await say(cookie, "5 Thums Up biki");
    expect(unknown.body.data.status).toBe("FAILED");
    expect(unknown.body.data.message).toMatch(/Thums Up/);
    expect(unknown.body.data.proposal).toBeNull();
    const tooMany = await say(cookie, "100 Coke 500ml biki");
    expect(tooMany.body.data.status).toBe("FAILED");
    expect(tooMany.body.data.message).toMatch(/Only 34/);
  });

  it("answers read-only questions immediately from real data", async () => {
    const { cookie } = await setup();
    const low = await say(cookie, "Kaunsa product low stock hai?");
    expect(low.body.data.status).toBe("ANSWERED");
    const summary = await say(cookie, "Aaj ka business kaisa raha?");
    expect(summary.body.data.status).toBe("ANSWERED");
    expect(summary.body.data.message).toMatch(/Sale: ₹0/);
    expect(summary.body.data.answer.actions.map((a: { label: string }) => a.label)).toContain("Sales dekhein");
    const coke = await say(cookie, "Coke kitni bachi hai?");
    // Ambiguous for a read-only question → show all matches instead of asking.
    expect(coke.body.data.status).toBe("ANSWERED");
    expect(coke.body.data.message).toContain("Coke 250ml");
    expect(coke.body.data.message).toContain("Coke 500ml");
  });

  it("enforces permissions and ownership of interactions", async () => {
    const { owner, staffCookie } = await ownerAndStaff("role_staff");
    await call("POST", "/products/samples", { cookie: owner.cookie });
    const undo = await say(staffCookie, "undo last sale");
    expect(undo.body.data.status).toBe("FAILED");
    expect(undo.body.data.message).toMatch(/permission/);
    const profit = await say(staffCookie, "Is month ka profit kitna hai?");
    expect(profit.body.data.status).toBe("FAILED");

    const mine = await say(owner.cookie, "2 Pepsi biki");
    expect(mine.body.data.status).toBe("PROPOSED");
    const hijack = await call("POST", `/ai/interactions/${mine.body.data.interactionId}/confirm`, { cookie: staffCookie });
    expect(hijack.status).toBe(404);
  });

  it("expires unconfirmed proposals", async () => {
    const { cookie, businessId } = await setup();
    const r = await say(cookie, "2 Pepsi biki");
    await env.DB.prepare("UPDATE ai_interactions SET expires_at = 1 WHERE business_id = ?").bind(businessId).run();
    const c = await call("POST", `/ai/interactions/${r.body.data.interactionId}/confirm`, { cookie });
    expect(c.status).toBe(410);
    expect(await salesCount(businessId)).toBe(0);
  });

  it("supports purchases with pack units and undo", async () => {
    const { cookie, byName } = await setup();
    await call("POST", "/suppliers", { cookie, body: { name: "Sharma Wholesale" } });
    const r = await say(cookie, "Sharma se 2 crate Coke 500ml aayi");
    expect(r.body.data.status).toBe("PROPOSED");
    expect(r.body.data.proposal.command.items[0]).toMatchObject({ quantityMilli: 48000 });
    await call("POST", `/ai/interactions/${r.body.data.interactionId}/confirm`, { cookie });
    expect(await stockOf(cookie, byName("Coke 500ml"))).toBe(34000 + 48000);

    const sale = await say(cookie, "2 Pepsi biki");
    await call("POST", `/ai/interactions/${sale.body.data.interactionId}/confirm`, { cookie });
    const undo = await say(cookie, "undo last sale");
    expect(undo.body.data.proposal.kind).toBe("REVERSE_SALE");
    await call("POST", `/ai/interactions/${undo.body.data.interactionId}/confirm`, { cookie });
    expect(await stockOf(cookie, byName("Pepsi 500ml"))).toBe(20000);
  });
});
