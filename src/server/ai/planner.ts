/**
 * Planner: turns a validated ParsedIntent into exactly one of
 *   · a clarification (ambiguous/missing details — never guess)
 *   · a read-only answer (computed from services, never from the LLM)
 *   · a proposal (exact command + preview) that the user must confirm
 *   · an error message (e.g. not enough stock, no permission)
 * It never writes to the database.
 */
import { formatMoney } from "@/lib/money";
import { formatQty } from "@/lib/qty";
import { formatDate } from "@/lib/dates";
import type { Permission } from "@/lib/domain";
import { AppError } from "@/server/lib/errors";
import { createSaleSchema, createPurchaseSchema } from "@/schemas/sales";
import type { ServiceContext } from "@/server/services/context";
import { previewPurchase } from "@/server/services/purchases";
import { findLastSale, previewSale } from "@/server/services/sales";
import { inventorySummary, lowStockProducts } from "@/server/services/inventory";
import { outstandingTotals, periodRange, profitReport, salesTotals, topProducts } from "@/server/services/reports";
import { and, desc, eq, gte } from "drizzle-orm";
import { expenses, purchases } from "@/server/db/schema";
import type { Catalog, CatalogProduct, ConversationRefs } from "./catalog";
import type { ItemEntity, ParsedIntent, Period } from "./contract";
import { rankCandidates, resolveOne, type MatchCandidate } from "./matching";
import { isCommandWord } from "./rules-parser";
import { normalizeText, tokenize } from "@/lib/text";

export type Lang = ParsedIntent["language"];

export interface ClarifyOption {
  id: string;
  label: string;
  sublabel?: string;
}

export interface ProposalView {
  kind: string;
  title: string;
  lines: Array<{ label: string; detail?: string; amountPaise?: number }>;
  totals: Array<{ label: string; amountPaise: number; emphasis?: boolean }>;
  stockImpact: Array<{ name: string; unit: string; beforeMilli: number; afterMilli: number }>;
  notes: string[];
  warnings: string[];
  confirmLabel: string;
  editHref: string | null;
  /** Products picked automatically for ambiguous words, with one-tap alternatives. */
  autoPicks?: AutoPick[];
}

export interface AutoPick {
  slot: string;
  query: string;
  chosenId: string;
  chosenName: string;
  reason: string;
  options: ClarifyOption[];
}

export interface Proposal {
  kind:
    | "CREATE_SALE"
    | "CREATE_PURCHASE"
    | "ADJUST_STOCK"
    | "CREATE_EXPENSE"
    | "CUSTOMER_PAYMENT"
    | "SUPPLIER_PAYMENT"
    | "CREATE_CREDIT"
    | "CREATE_CUSTOMER"
    | "CREATE_SUPPLIER"
    | "REVERSE_SALE"
    | "REVERSE_PURCHASE"
    | "REVERSE_EXPENSE";
  /** Exact, validated input for the transaction service — executed verbatim on confirm. */
  command: Record<string, unknown>;
  view: ProposalView;
}

export interface Answer {
  message: string;
  data?: unknown;
  actions: Array<{ label: string; href: string }>;
}

export type PlanResult =
  | { type: "clarify"; slot: string; question: string; options: ClarifyOption[]; allowText?: "number" | "amount" }
  | { type: "answer"; answer: Answer }
  | { type: "proposal"; proposal: Proposal; message: string }
  | { type: "error"; message: string; actions?: Answer["actions"] };

export interface PlanInput {
  parsed: ParsedIntent;
  /** Choices the user made in earlier clarifications, by slot. */
  resolutions: Record<string, string>;
  /** Subject from the recent conversation (only within the follow-up window). */
  followUp: { refs: ConversationRefs } | null;
  /** The user's words, used to find a product the parser didn't attach to an item. */
  text?: string;
}

export interface PlanOutput {
  result: PlanResult;
  refs: ConversationRefs;
  contextNote: string | null;
}

const L = (lang: Lang, en: string, hi: string) => (lang === "english" ? en : hi);
const QTY_OPTIONS = [1, 2, 3, 5, 10, 12, 24];

class Clarify extends Error {
  constructor(readonly result: Extract<PlanResult, { type: "clarify" }>) {
    super("clarify");
  }
}
class Stop extends Error {
  constructor(readonly result: PlanResult) {
    super("stop");
  }
}

export async function plan(ctx: ServiceContext, catalog: Catalog, input: PlanInput): Promise<PlanOutput> {
  const refs: ConversationRefs = { productIds: [], customerId: null, supplierId: null };
  let contextNote: string | null = null;
  const lang = input.parsed.language;
  const e = input.parsed.entities;

  const need = (p: Permission) => {
    if (!ctx.permissions.has(p)) throw new Stop({ type: "error", message: L(lang, "You don't have permission to do that. Ask the shop owner.", "Aapke paas iski permission nahi hai. Shop owner se poochhiye.") });
  };

  /** Resolves a product query, honouring earlier clarification choices. */
  const autoPicks: AutoPick[] = [];
  const sellIntent = input.parsed.intent === "CREATE_SALE" || (input.parsed.intent === "ADJUST_STOCK" && e.stock_direction === "decrease");

  /**
   * For an ambiguous word, pick the product when the choice is clear — the shop's learned
   * preference, the only one in stock (for sales), or a clear best-seller. The confirmation
   * card shows what was picked and offers the alternatives; nothing is saved without Confirm.
   */
  const autoPick = (slot: string, query: string, options: CatalogProduct[], chosenId?: string): CatalogProduct | null => {
    let pick: CatalogProduct | undefined;
    let reason = "";
    if (chosenId) {
      pick = options.find((o) => o.id === chosenId);
      reason = L(lang, "your choice", "aapki pasand");
    }
    if (!pick) {
      const pref = catalog.preferences.get(normalizeText(query));
      pick = options.find((o) => o.id === pref);
      if (pick) reason = L(lang, "your usual", "aap aksar yahi lete hain");
    }
    if (!pick && sellIntent) {
      // Auto-pick only when the choice isn't genuinely ambiguous: exactly one variant is actually
      // in stock. With several in stock we ask (don't guess a size for the shopkeeper).
      const inStock = options.filter((o) => !o.trackStock || o.currentStockMilli > 0);
      if (inStock.length === 1) {
        pick = inStock[0];
        reason = L(lang, "the only one in stock", "sirf yahi stock mein hai");
      }
    }
    // When multiple variants are in stock and the shop has no learned preference, fall through to a
    // clarification question rather than silently choosing a best-seller.
    if (!pick) return null;
    autoPicks.push({ slot, query, chosenId: pick.id, chosenName: pick.name, reason, options: options.map(productOption) });
    return pick;
  };

  /** Finds exactly one product mentioned anywhere in the user's words. */
  const productInText = (): CatalogProduct | null => {
    if (!input.text) return null;
    const words = tokenize(input.text).filter((w) => !/^\d/.test(w) && !isCommandWord(w));
    const found = new Set<string>();
    for (let n = Math.min(3, words.length); n >= 1; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        const r = resolveOne(words.slice(i, i + n).join(" "), catalog.products);
        if (r.status === "resolved" && r.match.score >= 0.85) found.add(r.match.value.id);
      }
      if (found.size) break;
    }
    if (found.size !== 1) return null;
    return catalog.products.find((c) => c.value.id === [...found][0])?.value ?? null;
  };

  const resolveProduct = (slot: string, query: string | null | undefined, singleItem = false): CatalogProduct => {
    const chosen = input.resolutions[slot];
    if (chosen) {
      const p = catalog.products.find((c) => c.value.id === chosen);
      if (p) {
        // Keep the alternatives on the card after the user switched.
        if (query) {
          const r = resolveOne(query, catalog.products);
          if (r.status === "ambiguous" && r.options.some((o) => o.value.id === chosen)) autoPick(slot, query, r.options.map((o) => o.value), chosen);
        }
        return p.value;
      }
    }
    if (!query && singleItem) {
      const p = productInText();
      if (p) return p;
    }
    if (!query) {
      const fromContext = input.followUp?.refs.productIds ?? [];
      if (fromContext.length === 1) {
        const p = catalog.products.find((c) => c.value.id === fromContext[0]);
        if (p) {
          contextNote = L(lang, `Using ${p.value.name} from your last message.`, `Pichli baat se ${p.value.name} samjha.`);
          return p.value;
        }
      }
      throw new Clarify({
        type: "clarify",
        slot,
        question: L(lang, "Which product?", "Kaunsa product?"),
        options: catalog.products
          .slice()
          .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
          .slice(0, 6)
          .map((c) => productOption(c.value)),
      });
    }
    const r = resolveOne(query, catalog.products);
    if (r.status === "resolved") return r.match.value;
    if (r.status === "ambiguous") {
      const picked = autoPick(slot, query, r.options.map((o) => o.value));
      if (picked) return picked;
      throw new Clarify({
        type: "clarify",
        slot,
        question: L(lang, `Which ${query}?`, `Kaunsa ${query}?`),
        options: r.options.map((o) => productOption(o.value)),
      });
    }
    if (r.suggestions.length) {
      throw new Clarify({
        type: "clarify",
        slot,
        question: L(lang, `I couldn't find "${query}". Did you mean:`, `"${query}" nahi mila. Kya aapka matlab:`),
        options: r.suggestions.map((o) => productOption(o.value)),
      });
    }
    throw new Stop({
      type: "error",
      message: L(lang, `"${query}" is not in your products yet. Add it first, then try again.`, `"${query}" aapke products mein nahi hai. Pehle product add kijiye.`),
      actions: [{ label: L(lang, "Add product", "Product add karein"), href: `/products/new?name=${encodeURIComponent(query)}` }],
    });
  };

  const resolveParty = <T extends { id: string; name: string; balancePaise?: number; phone?: string | null }>(slot: string, query: string | null | undefined, cands: MatchCandidate<T>[], kind: "customer" | "supplier"): T => {
    const chosen = input.resolutions[slot];
    if (chosen) {
      const c = cands.find((x) => x.value.id === chosen);
      if (c) return c.value;
    }
    const label = kind === "customer" ? L(lang, "customer", "customer") : L(lang, "supplier", "supplier");
    if (!query) {
      const ctxId = kind === "customer" ? input.followUp?.refs.customerId : input.followUp?.refs.supplierId;
      const c = ctxId ? cands.find((x) => x.value.id === ctxId) : undefined;
      if (c) {
        contextNote = L(lang, `Using ${c.value.name} from your last message.`, `Pichli baat se ${c.value.name} samjha.`);
        return c.value;
      }
      throw new Stop({ type: "error", message: L(lang, `Which ${label}? Please say the name.`, `Kaunsa ${label}? Naam bataiye.`) });
    }
    const r = resolveOne(query, cands);
    if (r.status === "resolved") return r.match.value;
    if (r.status === "ambiguous") {
      throw new Clarify({ type: "clarify", slot, question: L(lang, `Which ${query}?`, `Kaunsa ${query}?`), options: r.options.map((o) => ({ id: o.value.id, label: o.value.name, sublabel: partySub(o.value) })) });
    }
    if (r.suggestions.length) {
      throw new Clarify({
        type: "clarify",
        slot,
        question: L(lang, `No ${label} named "${query}". Did you mean:`, `"${query}" naam ka ${label} nahi mila. Kya aapka matlab:`),
        options: r.suggestions.map((o) => ({ id: o.value.id, label: o.value.name, sublabel: partySub(o.value) })),
      });
    }
    throw new Stop({
      type: "error",
      message: L(lang, `No ${label} named "${query}". Add them first.`, `"${query}" naam ka koi ${label} nahi hai. Pehle add kijiye.`),
      actions: [{ label: L(lang, `Add ${label}`, `${label} add karein`), href: `/${kind}s?new=${encodeURIComponent(query)}` }],
    });
  };

  /** Quantity in milli base units; asks when missing; converts pack units. */
  const quantityFor = (slot: string, item: ItemEntity, product: CatalogProduct, warnings: string[]): number => {
    const chosen = input.resolutions[slot];
    const qty = chosen ? Number(chosen) : item.quantity;
    if (!qty || !Number.isFinite(qty) || qty <= 0) {
      throw new Clarify({
        type: "clarify",
        slot,
        question: L(lang, `How many ${product.name}?`, `Kitne ${product.name}?`),
        options: QTY_OPTIONS.map((n) => ({ id: String(n), label: `${n} ${product.unit}` })),
        allowText: "number",
      });
    }
    const unit = item.unit?.toLowerCase();
    let factor = 1000;
    if (unit && unit !== product.unit && !["pcs", "piece", "bottle", "packet", "pack", "nos"].includes(unit)) {
      const pu = product.units.find((u) => u.name === unit);
      if (pu) factor = pu.factorMilli;
      else if (unit === "dozen") factor = 12000;
      else warnings.push(L(lang, `"${unit}" is not set up for ${product.name}; counted as ${product.unit}.`, `${product.name} ke liye "${unit}" set nahi hai; ${product.unit} mein gina.`));
    }
    return Math.round(qty * factor);
  };

  const amountPaise = (slot: string, rupees: number | null | undefined, question: string): number => {
    const chosen = input.resolutions[slot];
    const r = chosen ? Number(chosen) : rupees;
    if (!r || !Number.isFinite(r) || r <= 0) throw new Clarify({ type: "clarify", slot, question, options: [], allowText: "amount" });
    return Math.round(r * 100);
  };

  try {
    const result = await dispatch();
    if (result.type === "proposal" && autoPicks.length) result.proposal.view.autoPicks = autoPicks;
    return { result, refs, contextNote };
  } catch (err) {
    if (err instanceof Clarify) return { result: err.result, refs, contextNote };
    if (err instanceof Stop) return { result: err.result, refs, contextNote };
    if (err instanceof AppError && err.status < 500) return { result: { type: "error", message: err.message }, refs, contextNote };
    throw err;
  }

  async function dispatch(): Promise<PlanResult> {
    const p = input.parsed;
    switch (p.intent) {
      // ─── Mutations → proposals ───────────────────────────────────────────
      case "CREATE_SALE": {
        need("sales.create");
        const items = e.items?.length ? e.items : [{ query: null, quantity: null, unit: null }];
        const warnings: string[] = [];
        const lines = items.map((it, i) => {
          const product = resolveProduct(`item:${i}`, it.query, items.length === 1);
          refs.productIds.push(product.id);
          const quantityMilli = quantityFor(`qty:${i}`, it, product, warnings);
          return { productId: product.id, quantityMilli, ...(it.price_rupees ? { unitPricePaise: Math.round((it.price_rupees * 100 * 1000) / Math.max(1, quantityMilli / (it.quantity ?? 1))) } : {}) };
        });
        let customerId: string | null = null;
        if (e.customer || input.resolutions.customer) {
          const c = resolveParty("customer", e.customer, catalog.customers, "customer");
          customerId = c.id;
          refs.customerId = c.id;
        }
        const method = e.payment_method === "CREDIT" ? "CREDIT" : (e.payment_method ?? "CASH");
        if (method === "CREDIT" && !customerId) {
          throw new Stop({ type: "error", message: L(lang, "Whose udhaar? Say the customer's name, e.g. 'Ramesh ko 5 Coke udhaar'.", "Kiske khate mein? Customer ka naam bataiye, jaise 'Ramesh ko 5 Coke udhaar'.") });
        }
        const command = createSaleSchema.parse({
          items: lines,
          customerId,
          payment: { method },
          ...(e.date === "yesterday" ? { txnDate: periodRange("yesterday", ctx.now).from } : {}),
        });
        const { preview } = await previewSale(ctx, command);
        const view: ProposalView = {
          kind: "sale",
          title: L(lang, "Sale", "Sale (Bikri)"),
          lines: preview.lines.map((l) => ({ label: l.productName, detail: `×${formatQty(l.quantityMilli)} ${l.unit} @ ${formatMoney(l.unitPricePaise, { compact: true })}`, amountPaise: l.totalPaise })),
          totals: [
            ...(preview.taxPaise ? [{ label: L(lang, "GST included", "GST shamil"), amountPaise: preview.taxPaise }] : []),
            { label: L(lang, "Total", "Kul"), amountPaise: preview.totalPaise, emphasis: true },
            ...(preview.creditPaise ? [{ label: L(lang, `Udhaar for ${preview.customer?.name}`, `${preview.customer?.name} ke khate mein`), amountPaise: preview.creditPaise }] : []),
          ],
          stockImpact: preview.lines.filter((l) => l.trackStock).map((l) => ({ name: l.productName, unit: l.unit, beforeMilli: l.stockBeforeMilli, afterMilli: l.stockAfterMilli })),
          notes: [
            `${L(lang, "Payment", "Payment")}: ${method === "CREDIT" ? "Udhaar" : method}`,
            ...(preview.txnDate !== periodRange("today", ctx.now).from ? [`${L(lang, "Date", "Tareekh")}: ${formatDate(preview.txnDate)}`] : []),
          ],
          warnings,
          confirmLabel: L(lang, "Confirm Sale", "Sale confirm karein"),
          editHref: "/sales/new",
        };
        return { type: "proposal", proposal: { kind: "CREATE_SALE", command, view }, message: L(lang, "I understood this sale:", "Maine yeh sale samjhi:") };
      }

      case "CREATE_PURCHASE": {
        need("purchase.create");
        const items = e.items?.length ? e.items : [{ query: null, quantity: null, unit: null }];
        const warnings: string[] = [];
        let supplierId: string | null = null;
        if (e.supplier || input.resolutions.supplier) {
          const s = resolveParty("supplier", e.supplier, catalog.suppliers, "supplier");
          supplierId = s.id;
          refs.supplierId = s.id;
        }
        const lines = items.map((it, i) => {
          const product = resolveProduct(`item:${i}`, it.query, items.length === 1);
          refs.productIds.push(product.id);
          const quantityMilli = quantityFor(`qty:${i}`, it, product, warnings);
          let unitCostPaise: number;
          if (it.price_rupees) {
            // Price is per the unit the user said (e.g. per crate) → convert to per base unit.
            const perSaidUnit = Math.round(it.price_rupees * 100);
            const saidUnits = it.quantity ?? 1;
            unitCostPaise = Math.round((perSaidUnit * saidUnits * 1000) / quantityMilli);
          } else if (product.purchasePricePaise > 0) {
            unitCostPaise = product.purchasePricePaise;
            warnings.push(L(lang, `${product.name}: using last purchase rate ${formatMoney(unitCostPaise)} per ${product.unit}. Edit if the rate changed.`, `${product.name}: pichla rate ${formatMoney(unitCostPaise)} / ${product.unit} liya. Rate badla ho to Edit karein.`));
          } else {
            throw new Stop({ type: "error", message: L(lang, `What was the rate for ${product.name}? e.g. "3 crate Coke 800 rupaye crate".`, `${product.name} ka rate kya tha? Jaise "3 crate Coke 800 rupaye crate".`) });
          }
          return { productId: product.id, quantityMilli, unitCostPaise };
        });
        const credit = e.payment_method === "CREDIT";
        if (credit && !supplierId) throw new Stop({ type: "error", message: L(lang, "Which supplier gave it on credit?", "Kis supplier se udhaar aaya?") });
        const command = createPurchaseSchema.parse({
          supplierId,
          items: lines,
          payment: credit ? { status: "UNPAID" } : { status: "PAID", method: e.payment_method && e.payment_method !== "CREDIT" ? e.payment_method : "CASH" },
          ...(e.date === "yesterday" ? { txnDate: periodRange("yesterday", ctx.now).from } : {}),
        });
        const pv = await previewPurchase(ctx, command);
        const view: ProposalView = {
          kind: "purchase",
          title: L(lang, "Purchase (stock in)", "Purchase (maal aaya)"),
          lines: command.items.map((l, i) => {
            const prod = pv.byId.get(l.productId)!;
            return { label: prod.name, detail: `×${formatQty(l.quantityMilli)} ${prod.unit} @ ${formatMoney(l.unitCostPaise)}`, amountPaise: pv.priced.lines[i]!.totalPaise };
          }),
          totals: [
            { label: L(lang, "Total", "Kul"), amountPaise: pv.total, emphasis: true },
            ...(pv.credit ? [{ label: L(lang, `Payable to ${pv.supplier?.name}`, `${pv.supplier?.name} ko dena`), amountPaise: pv.credit }] : []),
          ],
          stockImpact: command.items
            .filter((l) => pv.byId.get(l.productId)!.trackStock)
            .map((l) => {
              const prod = pv.byId.get(l.productId)!;
              return { name: prod.name, unit: prod.unit, beforeMilli: prod.currentStockMilli, afterMilli: prod.currentStockMilli + l.quantityMilli };
            }),
          notes: [pv.supplier ? `${L(lang, "Supplier", "Supplier")}: ${pv.supplier.name}` : L(lang, "No supplier (cash purchase)", "Bina supplier (cash purchase)"), `${L(lang, "Payment", "Payment")}: ${credit ? "Udhaar" : command.payment.method}`],
          warnings,
          confirmLabel: L(lang, "Confirm Purchase", "Purchase confirm karein"),
          editHref: "/purchases/new",
        };
        return { type: "proposal", proposal: { kind: "CREATE_PURCHASE", command, view }, message: L(lang, "I understood this purchase:", "Maine yeh purchase samjhi:") };
      }

      case "ADJUST_STOCK": {
        need("inventory.adjust");
        const it = e.items?.[0] ?? { query: null, quantity: null, unit: null };
        const product = resolveProduct("item:0", it.query, true);
        refs.productIds.push(product.id);
        const warnings: string[] = [];
        const qty = quantityFor("qty:0", it, product, warnings);
        const type = e.adjustment_type ?? "ADJUSTMENT";
        const dir = e.stock_direction ?? (type === "DAMAGE" ? "decrease" : "increase");
        const delta = dir === "set" ? qty - product.currentStockMilli : dir === "decrease" ? -qty : qty;
        const after = product.currentStockMilli + delta;
        if (after < 0) throw new Stop({ type: "error", message: L(lang, `Only ${formatQty(product.currentStockMilli)} ${product.unit} of ${product.name} in stock.`, `${product.name} sirf ${formatQty(product.currentStockMilli)} ${product.unit} hai.`) });
        const command = { productId: product.id, type, mode: dir === "set" ? "set" : "delta", direction: dir === "decrease" ? "decrease" : "increase", quantityMilli: qty, reason: e.note ?? (type === "DAMAGE" ? "Damaged (voice)" : type === "RETURN" ? "Returned (voice)" : "Adjusted (voice)") };
        const label = type === "DAMAGE" ? L(lang, "Damaged stock", "Kharab/toota maal") : type === "RETURN" ? L(lang, "Returned stock", "Wapas aaya maal") : L(lang, "Stock adjustment", "Stock badlav");
        return {
          type: "proposal",
          proposal: {
            kind: "ADJUST_STOCK",
            command,
            view: { kind: "adjustment", title: label, lines: [{ label: product.name, detail: `${delta > 0 ? "+" : ""}${formatQty(delta)} ${product.unit}` }], totals: [], stockImpact: [{ name: product.name, unit: product.unit, beforeMilli: product.currentStockMilli, afterMilli: after }], notes: [], warnings, confirmLabel: L(lang, "Update stock", "Stock update karein"), editHref: `/inventory/${product.id}` },
          },
          message: L(lang, "I understood this stock change:", "Maine yeh stock badlav samjha:"),
        };
      }

      case "CREATE_EXPENSE": {
        need("expense.create");
        const amount = amountPaise("amount", e.amount_rupees, L(lang, "How much was the expense (₹)?", "Kharcha kitne ka tha (₹)?"));
        const wanted = e.expense_category ?? "Other";
        const cat = catalog.expenseCategories.find((c) => c.name.toLowerCase() === wanted.toLowerCase()) ?? catalog.expenseCategories.find((c) => c.name === "Other");
        const command = { amountPaise: amount, ...(cat ? { categoryId: cat.id } : { categoryName: wanted }), paymentMethod: e.payment_method && e.payment_method !== "CREDIT" ? e.payment_method : "CASH", notes: e.note ?? null, ...(e.date === "yesterday" ? { txnDate: periodRange("yesterday", ctx.now).from } : {}) };
        return {
          type: "proposal",
          proposal: {
            kind: "CREATE_EXPENSE",
            command,
            view: { kind: "expense", title: L(lang, "Expense", "Kharcha"), lines: [{ label: cat?.name ?? wanted, detail: e.note ?? undefined, amountPaise: amount }], totals: [{ label: L(lang, "Amount", "Rakam"), amountPaise: amount, emphasis: true }], stockImpact: [], notes: [`${L(lang, "Paid by", "Payment")}: ${command.paymentMethod}`], warnings: [], confirmLabel: L(lang, "Save Expense", "Kharcha save karein"), editHref: "/expenses" },
          },
          message: L(lang, "I understood this expense:", "Maine yeh kharcha samjha:"),
        };
      }

      case "CREATE_PAYMENT": {
        const received = e.direction !== "paid";
        const amount = amountPaise("amount", e.amount_rupees, L(lang, "How much (₹)?", "Kitne rupaye?"));
        const method = e.payment_method && e.payment_method !== "CREDIT" ? e.payment_method : "CASH";
        if (received) {
          need("customer.ledger");
          const c = resolveParty("customer", e.customer, catalog.customers, "customer");
          refs.customerId = c.id;
          const after = c.balancePaise - amount;
          return {
            type: "proposal",
            proposal: {
              kind: "CUSTOMER_PAYMENT",
              command: { customerId: c.id, amountPaise: amount, method },
              view: {
                kind: "payment",
                title: L(lang, "Payment received", "Payment mila"),
                lines: [{ label: c.name, detail: method, amountPaise: amount }],
                totals: [
                  { label: L(lang, "Outstanding before", "Pehle baki"), amountPaise: c.balancePaise },
                  { label: L(lang, "Outstanding after", "Ab baki"), amountPaise: after, emphasis: true },
                ],
                stockImpact: [],
                notes: [],
                warnings: after < 0 ? [L(lang, `This is more than the outstanding amount; ${c.name} will have ${formatMoney(-after)} advance.`, `Yeh baki se zyada hai; ${c.name} ka ${formatMoney(-after)} advance ho jayega.`)] : [],
                confirmLabel: L(lang, "Confirm Payment", "Payment confirm karein"),
                editHref: `/customers/${c.id}`,
              },
            },
            message: L(lang, `${c.name} paid ${formatMoney(amount, { compact: true })}:`, `${c.name} ne ${formatMoney(amount, { compact: true })} diye:`),
          };
        }
        need("supplier.ledger");
        const s = resolveParty("supplier", e.supplier ?? e.customer, catalog.suppliers, "supplier");
        refs.supplierId = s.id;
        return {
          type: "proposal",
          proposal: {
            kind: "SUPPLIER_PAYMENT",
            command: { supplierId: s.id, amountPaise: amount, method },
            view: {
              kind: "payment",
              title: L(lang, "Payment to supplier", "Supplier ko payment"),
              lines: [{ label: s.name, detail: method, amountPaise: amount }],
              totals: [
                { label: L(lang, "Payable before", "Pehle dena"), amountPaise: s.balancePaise },
                { label: L(lang, "Payable after", "Ab dena"), amountPaise: s.balancePaise - amount, emphasis: true },
              ],
              stockImpact: [],
              notes: [],
              warnings: [],
              confirmLabel: L(lang, "Confirm Payment", "Payment confirm karein"),
              editHref: `/suppliers/${s.id}`,
            },
          },
          message: L(lang, `Paying ${s.name}:`, `${s.name} ko payment:`),
        };
      }

      case "CREATE_CREDIT": {
        need("customer.ledger");
        const c = resolveParty("customer", e.customer, catalog.customers, "customer");
        refs.customerId = c.id;
        const amount = amountPaise("amount", e.amount_rupees, L(lang, `How much udhaar for ${c.name} (₹)?`, `${c.name} ka kitna udhaar (₹)?`));
        return {
          type: "proposal",
          proposal: {
            kind: "CREATE_CREDIT",
            command: { customerId: c.id, amountPaise: amount, note: e.note ?? null },
            view: {
              kind: "credit",
              title: L(lang, "Add udhaar (credit)", "Udhaar likhein"),
              lines: [{ label: c.name, amountPaise: amount }],
              totals: [
                { label: L(lang, "Outstanding before", "Pehle baki"), amountPaise: c.balancePaise },
                { label: L(lang, "Outstanding after", "Ab baki"), amountPaise: c.balancePaise + amount, emphasis: true },
              ],
              stockImpact: [],
              notes: [],
              warnings: [],
              confirmLabel: L(lang, "Add Udhaar", "Udhaar likhein"),
              editHref: `/customers/${c.id}`,
            },
          },
          message: L(lang, `Udhaar for ${c.name}:`, `${c.name} ka udhaar:`),
        };
      }

      case "CREATE_CUSTOMER":
      case "CREATE_SUPPLIER": {
        const isCustomer = p.intent === "CREATE_CUSTOMER";
        need(isCustomer ? "customer.create" : "supplier.create");
        const name = (isCustomer ? e.customer : e.supplier) ?? null;
        if (!name) throw new Stop({ type: "error", message: L(lang, "What is the name?", "Naam kya hai?") });
        const existing = rankCandidates(name, isCustomer ? catalog.customers : catalog.suppliers).filter((r) => r.score >= 0.95);
        const phone = e.phone ?? null;
        return {
          type: "proposal",
          proposal: {
            kind: isCustomer ? "CREATE_CUSTOMER" : "CREATE_SUPPLIER",
            command: { name, phone },
            view: {
              kind: isCustomer ? "customer" : "supplier",
              title: isCustomer ? L(lang, "New customer", "Naya customer") : L(lang, "New supplier", "Naya supplier"),
              lines: [{ label: name, detail: phone ? `+91 ${phone}` : undefined }],
              totals: [],
              stockImpact: [],
              notes: [],
              warnings: existing.length ? [L(lang, `You already have ${existing.map((x) => x.name).join(", ")}.`, `${existing.map((x) => x.name).join(", ")} pehle se hai.`)] : [],
              confirmLabel: L(lang, "Add", "Add karein"),
              editHref: isCustomer ? "/customers" : "/suppliers",
            },
          },
          message: isCustomer ? L(lang, "Add this customer?", "Yeh customer add karein?") : L(lang, "Add this supplier?", "Yeh supplier add karein?"),
        };
      }

      case "UNDO_TRANSACTION": {
        const target = e.undo_target ?? "sale";
        if (target === "sale") {
          need("sales.delete");
          const last = await findLastSale(ctx);
          if (!last) return { type: "error", message: L(lang, "You have no sale from the last 24 hours to undo.", "Pichle 24 ghante mein aapki koi sale nahi hai.") };
          return {
            type: "proposal",
            proposal: {
              kind: "REVERSE_SALE",
              command: { saleId: last.id, reason: "Undo (voice)" },
              view: { kind: "reversal", title: L(lang, "Undo sale", "Sale undo karein"), lines: [{ label: last.invoiceNumber, detail: `${last.itemCount} item(s)`, amountPaise: last.totalPaise }], totals: [], stockImpact: [], notes: [L(lang, "Stock goes back and any udhaar is removed. The bill is kept, marked reversed.", "Stock wapas judega aur udhaar hat jayega. Bill 'reversed' ke saath rahega.")], warnings: [], confirmLabel: L(lang, "Undo Sale", "Sale undo karein"), editHref: `/sales/${last.id}` },
            },
            message: L(lang, "Undo your last sale?", "Aapki pichli sale undo karein?"),
          };
        }
        if (target === "purchase") {
          need("purchase.create");
          need("sales.delete");
          const last = await ctx.db.select().from(purchases).where(and(eq(purchases.businessId, ctx.businessId), eq(purchases.createdBy, ctx.userId), eq(purchases.status, "COMPLETED"), gte(purchases.createdAt, ctx.now - 86_400_000))).orderBy(desc(purchases.createdAt)).limit(1).get();
          if (!last) return { type: "error", message: L(lang, "No purchase from the last 24 hours to undo.", "Pichle 24 ghante mein koi purchase nahi.") };
          return {
            type: "proposal",
            proposal: { kind: "REVERSE_PURCHASE", command: { purchaseId: last.id, reason: "Undo (voice)" }, view: { kind: "reversal", title: L(lang, "Undo purchase", "Purchase undo karein"), lines: [{ label: last.purchaseNumber, amountPaise: last.totalPaise }], totals: [], stockImpact: [], notes: [], warnings: [], confirmLabel: L(lang, "Undo Purchase", "Purchase undo karein"), editHref: `/purchases` } },
            message: L(lang, "Undo your last purchase?", "Pichli purchase undo karein?"),
          };
        }
        need("expense.create");
        const last = await ctx.db.select().from(expenses).where(and(eq(expenses.businessId, ctx.businessId), eq(expenses.createdBy, ctx.userId), eq(expenses.status, "COMPLETED"), gte(expenses.createdAt, ctx.now - 86_400_000))).orderBy(desc(expenses.createdAt)).limit(1).get();
        if (!last) return { type: "error", message: L(lang, "No expense from the last 24 hours to undo.", "Pichle 24 ghante mein koi kharcha nahi.") };
        return {
          type: "proposal",
          proposal: { kind: "REVERSE_EXPENSE", command: { expenseId: last.id, reason: "Undo (voice)" }, view: { kind: "reversal", title: L(lang, "Undo expense", "Kharcha undo karein"), lines: [{ label: formatDate(last.txnDate), amountPaise: last.amountPaise }], totals: [], stockImpact: [], notes: [], warnings: [], confirmLabel: L(lang, "Undo Expense", "Kharcha undo karein"), editHref: "/expenses" } },
          message: L(lang, "Undo your last expense?", "Pichla kharcha undo karein?"),
        };
      }

      // ─── Read-only → answers ─────────────────────────────────────────────
      case "CHECK_STOCK": {
        const q = e.items?.[0]?.query ?? null;
        let matches: CatalogProduct[];
        if (!q && input.followUp?.refs.productIds.length) {
          matches = catalog.products.filter((c) => input.followUp!.refs.productIds.includes(c.value.id)).map((c) => c.value);
          if (matches.length) contextNote = L(lang, `Using ${matches.map((m) => m.name).join(", ")} from your last message.`, `Pichli baat se ${matches.map((m) => m.name).join(", ")} samjha.`);
        } else if (!q) {
          return { type: "error", message: L(lang, "Which product's stock? e.g. 'Coke kitni bachi hai?'", "Kis product ka stock? Jaise 'Coke kitni bachi hai?'") };
        } else {
          const r = resolveOne(q, catalog.products);
          // Read-only: for several matches, just show them all (no need to ask).
          matches = r.status === "resolved" ? [r.match.value] : r.status === "ambiguous" ? r.options.map((o) => o.value) : [];
          if (!matches.length) {
            return { type: "error", message: L(lang, `"${q}" is not in your products.`, `"${q}" aapke products mein nahi hai.`), actions: [{ label: L(lang, "Add product", "Product add karein"), href: `/products/new?name=${encodeURIComponent(q)}` }] };
          }
        }
        refs.productIds = matches.map((m) => m.id);
        const lines = matches.map((m) => (m.trackStock ? `${m.name}: ${formatQty(Math.max(0, m.currentStockMilli))} ${m.unit}${m.currentStockMilli <= 0 ? L(lang, " (out of stock)", " (khatam)") : m.currentStockMilli <= m.lowStockThresholdMilli ? L(lang, " (low)", " (kam hai)") : ""}` : `${m.name}: ${L(lang, "stock not tracked", "stock track nahi hota")}`));
        const single = matches.length === 1 && matches[0]!.trackStock;
        return {
          type: "answer",
          answer: {
            message: single
              ? L(lang, `${matches[0]!.name}: ${formatQty(Math.max(0, matches[0]!.currentStockMilli))} ${matches[0]!.unit} in stock.`, `${matches[0]!.name}: ${formatQty(Math.max(0, matches[0]!.currentStockMilli))} ${matches[0]!.unit} bache hain.`)
              : lines.join("\n"),
            data: { products: matches.map((m) => ({ id: m.id, name: m.name, unit: m.unit, stockMilli: m.currentStockMilli, thresholdMilli: m.lowStockThresholdMilli })) },
            actions: matches.slice(0, 3).map((m) => ({ label: matches.length === 1 ? L(lang, "View product", "Product dekhein") : m.name, href: `/inventory/${m.id}` })),
          },
        };
      }

      case "CHECK_SALES": {
        const period: Period = e.period ?? "today";
        const r = periodRange(period, ctx.now);
        const t = await salesTotals(ctx, r);
        const top = await topProducts(ctx, r, 1);
        const label = periodLabel(period, lang);
        return {
          type: "answer",
          answer: {
            message:
              t.orders === 0
                ? L(lang, `No sales ${label}.`, `${label} koi sale nahi hui.`)
                : L(lang, `Sales ${label}: ${formatMoney(t.totalPaise, { compact: true })} from ${t.orders} bill${t.orders > 1 ? "s" : ""}.${top[0] ? ` Top product: ${top[0].name}.` : ""}`, `${label} ki sale: ${formatMoney(t.totalPaise, { compact: true })} (${t.orders} bill).${top[0] ? ` Sabse zyada bika: ${top[0].name}.` : ""}`),
            data: { period, range: r, totalPaise: t.totalPaise, orders: t.orders },
            actions: [{ label: L(lang, "View Sales", "Sales dekhein"), href: `/sales?from=${r.from}&to=${r.to}` }],
          },
        };
      }

      case "CHECK_PROFIT": {
        need("reports.view");
        const period: Period = e.period ?? "today";
        const r = periodRange(period, ctx.now);
        const pr = await profitReport(ctx, r);
        const label = periodLabel(period, lang);
        return {
          type: "answer",
          answer: {
            message: L(
              lang,
              `Profit ${label}: ${formatMoney(pr.grossProfitPaise, { compact: true })} gross${pr.expensesPaise ? `, ${formatMoney(pr.netProfitPaise, { compact: true })} after ${formatMoney(pr.expensesPaise, { compact: true })} expenses` : ""}.`,
              `${label} ka profit: ${formatMoney(pr.grossProfitPaise, { compact: true })}${pr.expensesPaise ? `; kharche (${formatMoney(pr.expensesPaise, { compact: true })}) ke baad ${formatMoney(pr.netProfitPaise, { compact: true })}` : ""}.`,
            ),
            data: pr,
            actions: [{ label: L(lang, "View Profit", "Profit dekhein"), href: `/reports?tab=profit&from=${r.from}&to=${r.to}` }],
          },
        };
      }

      case "CHECK_OUTSTANDING": {
        if (!ctx.permissions.has("customer.ledger") && !ctx.permissions.has("reports.view")) need("reports.view");
        if (e.customer || input.resolutions.customer) {
          const c = resolveParty("customer", e.customer, catalog.customers, "customer");
          refs.customerId = c.id;
          return {
            type: "answer",
            answer: {
              message: c.balancePaise > 0 ? L(lang, `${c.name} owes ${formatMoney(c.balancePaise)}.`, `${c.name} ka ${formatMoney(c.balancePaise)} baki hai.`) : c.balancePaise < 0 ? L(lang, `${c.name} has ${formatMoney(-c.balancePaise)} advance.`, `${c.name} ka ${formatMoney(-c.balancePaise)} advance hai.`) : L(lang, `${c.name} has nothing outstanding.`, `${c.name} ka kuch baki nahi hai.`),
              data: { customerId: c.id, balancePaise: c.balancePaise },
              actions: [{ label: L(lang, "Open Khata", "Khata kholein"), href: `/customers/${c.id}` }],
            },
          };
        }
        const o = await outstandingTotals(ctx);
        const top = catalog.customers.filter((c) => c.value.balancePaise > 0).sort((a, b) => b.value.balancePaise - a.value.balancePaise).slice(0, 3);
        return {
          type: "answer",
          answer: {
            message:
              o.receivablePaise === 0
                ? L(lang, "No customer udhaar is pending.", "Kisi customer ka udhaar baki nahi hai.")
                : L(lang, `${formatMoney(o.receivablePaise, { compact: true })} is outstanding from ${o.customersWithDues} customers.`, `${o.customersWithDues} customers se ${formatMoney(o.receivablePaise, { compact: true })} baki hai.`) +
                  (top.length ? `\n${top.map((t) => `• ${t.value.name}: ${formatMoney(t.value.balancePaise, { compact: true })}`).join("\n")}` : ""),
            data: o,
            actions: [{ label: L(lang, "View Khata", "Khata dekhein"), href: "/customers?filter=outstanding" }],
          },
        };
      }

      case "CHECK_INVENTORY": {
        const canMoney = ctx.permissions.has("reports.view");
        const [sum, low] = await Promise.all([inventorySummary(ctx), lowStockProducts(ctx, 20)]);
        refs.productIds = low.slice(0, 5).map((l) => l.id);
        const valueLine = canMoney
          ? L(lang, `You have about ${formatMoney(sum.costValuePaise, { compact: true })} of stock`, `Aapke paas lagbhag ${formatMoney(sum.costValuePaise, { compact: true })} ka maal hai`)
          : L(lang, `You have ${sum.totalProducts} products in stock`, `Aapke paas ${sum.totalProducts} products hain`);
        const statusLine =
          sum.outOfStock || sum.lowStock
            ? L(lang, ` — ${sum.outOfStock} out of stock, ${sum.lowStock} running low.`, ` — ${sum.outOfStock} khatam, ${sum.lowStock} kam ho rahe hain.`)
            : L(lang, ` across ${sum.totalProducts} products — all well stocked.`, ` ${sum.totalProducts} products mein — sab theek hai.`);
        const needs = low.length ? L(lang, ` Want me to show what to reorder?`, ` Kya mangwane wali cheezein dikhaun?`) : "";
        return {
          type: "answer",
          answer: {
            message: valueLine + statusLine + needs,
            data: { summary: sum, low },
            actions: low.length
              ? [{ label: L(lang, "What to reorder", "Kya mangwayein"), href: "/inventory?tab=reorder" }, { label: L(lang, "View inventory", "Inventory dekhein"), href: "/inventory" }]
              : [{ label: L(lang, "View inventory", "Inventory dekhein"), href: "/inventory" }],
          },
        };
      }

      case "LOW_STOCK_QUERY": {
        const low = await lowStockProducts(ctx, 20);
        refs.productIds = low.slice(0, 5).map((l) => l.id);
        return {
          type: "answer",
          answer: {
            message: low.length
              ? L(lang, `${low.length} product${low.length > 1 ? "s need" : " needs"} attention:`, `${low.length} product kam hain:`) + `\n${low.slice(0, 6).map((l) => `• ${l.name}: ${formatQty(Math.max(0, l.currentStockMilli))} ${l.unit} (${L(lang, "reorder", "mangaiye")} ~${formatQty(l.suggestedReorderMilli)})`).join("\n")}`
              : L(lang, "All products are well stocked.", "Sab products ka stock theek hai."),
            data: { items: low },
            actions: [{ label: L(lang, "View Low Stock", "Low stock dekhein"), href: "/inventory?stock=low" }],
          },
        };
      }

      case "DAILY_SUMMARY":
      case "MONTHLY_SUMMARY": {
        const period: Period = e.period ?? (p.intent === "MONTHLY_SUMMARY" ? "this_month" : "today");
        const r = periodRange(period, ctx.now);
        const canMoney = ctx.permissions.has("reports.view");
        const [t, top, low, pr] = await Promise.all([salesTotals(ctx, r), topProducts(ctx, r, 1), lowStockProducts(ctx, 50), canMoney ? profitReport(ctx, r) : Promise.resolve(null)]);
        const label = periodLabel(period, lang);
        const parts = [
          `${L(lang, "Sales", "Sale")}: ${formatMoney(t.totalPaise, { compact: true })}`,
          ...(pr ? [`${L(lang, "Profit", "Profit")}: ${formatMoney(pr.grossProfitPaise, { compact: true })}`] : []),
          ...(pr && pr.expensesPaise ? [`${L(lang, "Expenses", "Kharche")}: ${formatMoney(pr.expensesPaise, { compact: true })}`] : []),
          `${L(lang, "Orders", "Bills")}: ${t.orders}`,
          `${L(lang, "Low-stock products", "Kam stock wale products")}: ${low.length}`,
        ];
        return {
          type: "answer",
          answer: {
            message: `${L(lang, `Summary for ${label}:`, `${label} ka hisaab:`)}\n${parts.join("\n")}${top[0] ? `\n\n${L(lang, `Your highest-selling product was ${top[0].name}.`, `Sabse zyada bikne wala product: ${top[0].name}.`)}` : ""}`,
            data: { period, range: r, sales: t, profit: pr, lowStock: low.length, topProduct: top[0] ?? null },
            actions: [
              { label: L(lang, "View Sales", "Sales dekhein"), href: `/sales?from=${r.from}&to=${r.to}` },
              { label: L(lang, "View Low Stock", "Low stock dekhein"), href: "/inventory?stock=low" },
              ...(canMoney ? [{ label: L(lang, "View Profit", "Profit dekhein"), href: `/reports?tab=profit&from=${r.from}&to=${r.to}` }] : []),
            ],
          },
        };
      }

      case "SEARCH_PRODUCT": {
        const q = e.search_query ?? e.items?.[0]?.query ?? null;
        if (!q) return { type: "error", message: L(lang, "What should I search for?", "Kya dhoondhna hai?") };
        const found = rankCandidates(q, catalog.products).filter((r) => r.score >= 0.6).slice(0, 5);
        refs.productIds = found.map((f) => f.value.id);
        return {
          type: "answer",
          answer: {
            message: found.length ? found.map((f) => `• ${f.value.name} — ${formatMoney(f.value.sellingPricePaise, { compact: true })}${f.value.trackStock ? ` · ${formatQty(Math.max(0, f.value.currentStockMilli))} ${f.value.unit}` : ""}`).join("\n") : L(lang, `No products match "${q}".`, `"${q}" se koi product nahi mila.`),
            data: { products: found.map((f) => f.value) },
            actions: found.slice(0, 3).map((f) => ({ label: f.value.name, href: `/inventory/${f.value.id}` })),
          },
        };
      }

      case "SEARCH_CUSTOMER":
      case "SEARCH_SUPPLIER": {
        const isC = p.intent === "SEARCH_CUSTOMER";
        if (!isC) need("supplier.create");
        const q = e.search_query ?? (isC ? e.customer : e.supplier) ?? null;
        if (!q) return { type: "error", message: L(lang, "Whom should I search for?", "Kise dhoondhna hai?") };
        const found = rankCandidates(q, (isC ? catalog.customers : catalog.suppliers) as MatchCandidate<{ id: string; name: string; balancePaise: number }>[]).filter((r) => r.score >= 0.6).slice(0, 5);
        return {
          type: "answer",
          answer: {
            message: found.length ? found.map((f) => `• ${f.value.name}${f.value.balancePaise ? ` — ${isC ? L(lang, "owes", "baki") : L(lang, "payable", "dena")} ${formatMoney(f.value.balancePaise, { compact: true })}` : ""}`).join("\n") : L(lang, `No match for "${q}".`, `"${q}" nahi mila.`),
            data: { results: found.map((f) => f.value) },
            actions: found.slice(0, 3).map((f) => ({ label: f.value.name, href: `/${isC ? "customers" : "suppliers"}/${f.value.id}` })),
          },
        };
      }

      case "UNKNOWN":
      default:
        return {
          type: "error",
          message:
            p.clarification ??
            L(lang, "Sorry, I couldn't understand that. Try: “Aaj 20 Coke biki” or “Ramesh ne ₹500 diye”.", "Maaf kijiye, samajh nahi aaya. Aise boliye: “Aaj 20 Coke biki” ya “Ramesh ne ₹500 diye”."),
        };
    }
  }
}

function productOption(p: CatalogProduct): ClarifyOption {
  return { id: p.id, label: p.name, sublabel: `${formatMoney(p.sellingPricePaise, { compact: true })}${p.trackStock ? ` · ${formatQty(Math.max(0, p.currentStockMilli))} ${p.unit}` : ""}` };
}

function partySub(v: { balancePaise?: number; phone?: string | null }): string | undefined {
  const bits = [v.phone ? `+91 ${v.phone}` : null, v.balancePaise ? `${formatMoney(v.balancePaise, { compact: true })}` : null].filter(Boolean);
  return bits.length ? bits.join(" · ") : undefined;
}

function periodLabel(p: Period, lang: Lang): string {
  const en: Record<Period, string> = { today: "today", yesterday: "yesterday", this_week: "this week", last_7_days: "in the last 7 days", this_month: "this month", last_month: "last month", last_30_days: "in the last 30 days" };
  const hi: Record<Period, string> = { today: "Aaj", yesterday: "Kal", this_week: "Is hafte", last_7_days: "Pichle 7 din", this_month: "Is mahine", last_month: "Pichle mahine", last_30_days: "Pichle 30 din" };
  return lang === "english" ? en[p] : hi[p];
}
