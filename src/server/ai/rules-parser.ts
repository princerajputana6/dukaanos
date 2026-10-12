/**
 * Deterministic parser for common Hindi / Hinglish / English shop phrases.
 * Fast, free and predictable — it handles most everyday commands; anything it is unsure
 * about is handed to the LLM parser (see hybrid.ts). Pure function: no DB access.
 *
 *   "Aaj 20 Coke aur 10 Sprite biki"      → CREATE_SALE  [Coke×20, Sprite×10]
 *   "Sharma se 3 crate Coke aayi"         → CREATE_PURCHASE supplier=Sharma [Coke×3 crate]
 *   "Ramesh ka 850 udhaar likh do"        → CREATE_CREDIT customer=Ramesh ₹850
 *   "Ramesh ne 500 de diye"               → CREATE_PAYMENT received customer=Ramesh ₹500
 *   "Coke kitni bachi hai?"               → CHECK_STOCK Coke
 */
import { hasDevanagari, normalizeText, transliterate } from "@/lib/text";
import type { ItemEntity, ParsedIntent, Period } from "./contract";

type Lang = ParsedIntent["language"];

// ─── Vocabulary (Latin; Devanagari input is transliterated first) ────────────

const SALE_VERBS = new Set([
  "bik", "bikta", "bikti", "bikte", "becho", "bechna", "becha",
  "biki", "bika", "bike", "bikey", "bikee", "bech", "bechi", "becha", "beche", "bechdi", "bechiya", "nikli", "nikla", "nikle", "sold", "sell", "sale", "sales", "bechne", "bikri",
]);
const PURCHASE_VERBS = new Set([
  "aayi", "aaya", "aaye", "aai", "aae", "ayi", "aya", "aye", "ai", "kharida", "kharidi", "kharide", "kharidaa", "purchase", "purchased", "bought", "mangaya", "mangayi", "mangaye", "liya", "liye", "li", "stock",
]);
const PAYMENT_VERBS = new Set(["diye", "die", "diya", "di", "paid", "pay", "payment", "jama", "mile", "mila", "mili", "received", "chukaya", "chukaye", "lautaye", "lautaya", "bheje", "bheja"]);
const CREDIT_WORDS = new Set(["udhaar", "udhar", "udhari", "udhaari", "credit", "khata", "khate", "baki", "baaki"]);
const EXPENSE_WORDS = new Set(["kharcha", "kharch", "kharche", "expense", "expenses", "spent", "bill"]);
const EXPENSE_CATEGORIES: Record<string, string> = {
  rent: "Rent", kiraya: "Rent", bhada: "Rent", bhaada: "Rent",
  bijli: "Electricity", electricity: "Electricity", light: "Electricity", current: "Electricity",
  salary: "Salary", tankhwah: "Salary", tankha: "Salary", pagaar: "Salary", wages: "Salary", majduri: "Salary",
  transport: "Transport", bhada_gaadi: "Transport", auto: "Transport", tempo: "Transport", petrol: "Transport", diesel: "Transport", delivery: "Transport",
  repair: "Maintenance", maintenance: "Maintenance", marammat: "Maintenance", safai: "Maintenance",
  marketing: "Marketing", advertisement: "Marketing", ad: "Marketing", pamphlet: "Marketing", banner: "Marketing",
  chai: "Other", nashta: "Other", internet: "Other", phone: "Other", recharge: "Other", paani: "Other",
};
const DAMAGE_WORDS = new Set(["toot", "tooti", "tuta", "tooti", "tute", "phoot", "phooti", "kharab", "damage", "damaged", "broken", "expire", "expired", "sad", "sada", "sadi", "leak", "chori"]);
const RETURN_WORDS = new Set(["return", "returned", "wapas", "vapas", "lautaya", "lautayi", "lautaye"]);
const UNDO_WORDS = new Set(["undo", "cancel", "galti", "galat", "hata", "hatao", "delete", "mita", "mitao", "reverse", "radd"]);
const LAST_WORDS = new Set(["last", "pichla", "pichli", "pichle", "aakhri", "akhri", "previous", "abhi"]);
const QUESTION_WORDS = new Set(["kitna", "kitni", "kitne", "kya", "kaunsa", "kaunse", "kaun", "konsa", "konse", "how", "what", "which", "batao", "bata", "bataye", "dikhao", "show", "tell", "check", "kaisa", "kaisi", "kaise"]);
const STOCK_WORDS = new Set(["stock", "bacha", "bachi", "bache", "bachaa", "available", "inventory", "maal", "left", "remaining"]);
const PROFIT_WORDS = new Set(["profit", "munafa", "munaafa", "fayda", "faayda", "kamai", "margin", "earning", "earnings"]);
const LOW_WORDS = new Set(["low", "khatam", "kam", "short", "finish", "finished", "reorder", "mangana", "mangwana"]);
const OUTSTANDING_WORDS = new Set(["outstanding", "baki", "baaki", "due", "dues", "pending", "lena", "dena", "udhaar", "udhar"]);
const SUMMARY_WORDS = new Set(["summary", "hisaab", "hisab", "report", "business", "dhandha", "dhanda", "kaisa", "kaisi"]);
const SEARCH_WORDS = new Set(["dhundo", "dhoondo", "search", "find", "khojo", "rate", "price", "daam", "dam", "mrp"]);
const NEW_WORDS = new Set(["naya", "nayi", "new", "add", "jodo", "banao", "create"]);
const CUSTOMER_WORDS = new Set(["customer", "grahak", "graahak", "client"]);
const SUPPLIER_WORDS = new Set(["supplier", "vendor", "dealer", "distributor", "wholesaler", "wholesale", "company"]);
const UPI_WORDS = new Set(["upi", "gpay", "phonepe", "paytm", "online", "googlepay", "bhim", "scan", "qr"]);
const CARD_WORDS = new Set(["card", "swipe"]);
const CASH_WORDS = new Set(["cash", "nakad", "naqad", "nagad"]);

const CONJUNCTIONS = new Set(["aur", "and", "or", "plus", "tatha", "evam", "sath", "saath", "bhi"]);
const UNITS: Record<string, string> = {
  pcs: "pcs", pc: "pcs", piece: "pcs", pieces: "pcs", nos: "pcs", number: "pcs", nag: "pcs",
  bottle: "bottle", bottles: "bottle", botal: "bottle", botel: "bottle",
  packet: "packet", packets: "packet", pkt: "packet", pack: "pack", packs: "pack", paket: "packet",
  box: "box", boxes: "box", dabba: "box", dabbe: "box", dibba: "box", dibbe: "box",
  crate: "crate", crates: "crate", peti: "crate", pethi: "crate", carton: "carton", cartons: "carton", case: "case", cases: "case",
  dozen: "dozen", darjan: "dozen", darzan: "dozen",
  kg: "kg", kilo: "kg", g: "g", l: "l", ml: "ml", litre: "l",
  bori: "bag", bag: "bag", bags: "bag", katta: "bag", thaila: "bag",
  cup: "cup", cups: "cup", plate: "plate", plates: "plate", glass: "glass",
};
const SIZE_UNITS = new Set(["ml", "l", "g", "kg", "gm"]);
const FILLERS = new Set([
  "aaj", "aj", "today", "kal", "yesterday", "abhi", "maine", "mene", "humne", "hamne", "hum", "main", "mai", "me", "mein", "ne", "ka", "ki", "ke", "ko", "se", "par", "pe", "hai", "hain", "he", "ho", "tha", "thi", "the", "gaya", "gayi", "gaye", "gai", "di", "diya", "diye", "de", "do", "dena", "karo", "kar", "kardo", "kiya", "kiye", "ki", "hua", "hui", "hue", "a", "an", "the", "of", "please", "plz", "pls", "bhai", "bhaiya", "ji", "total", "sirf", "bas", "wala", "wali", "wale", "vala", "vali", "vale", "ek", "sab", "saare", "sare", "is", "iss", "us", "to", "toh", "for", "rs", "rupaye", "rupay", "rupees", "rupee", "rupiya", "rupya", "rupiye", "₹", "sold", "sell", "sale", "likh", "likho", "likhdo", "naam", "khate", "khata", "pe", "ab", "fir", "phir", "aur",
]);

const NUMBER_WORDS: Record<string, number> = {
  ek: 1, one: 1, do: 2, two: 2, teen: 3, three: 3, char: 4, chaar: 4, four: 4, paanch: 5, panch: 5, five: 5,
  chhe: 6, chhah: 6, che: 6, six: 6, saat: 7, seven: 7, aath: 8, eight: 8, nau: 9, nine: 9, das: 10, ten: 10,
  gyarah: 11, eleven: 11, barah: 12, baarah: 12, twelve: 12, terah: 13, chaudah: 14, pandrah: 15, fifteen: 15, solah: 16, satrah: 17, atharah: 18, unnis: 19, unnees: 19,
  tin: 3, bees: 20, bis: 20, twenty: 20, pachees: 25, pachchis: 25, tees: 30, thirty: 30, chalees: 40, chalis: 40, forty: 40, pachas: 50, pachaas: 50, fifty: 50,
  sattar: 70, assi: 80, nabbe: 90, dhai: 2.5, dhaai: 2.5, dedh: 1.5, derh: 1.5, aadha: 0.5, adha: 0.5, aadhi: 0.5, half: 0.5,
};
const MULTIPLIERS: Record<string, number> = { sau: 100, hundred: 100, hazaar: 1000, hazar: 1000, hajar: 1000, thousand: 1000, k: 1000, lakh: 100000, lac: 100000 };
/** "do" is also the verb "give" ("likh do", "de do") — only a number before a noun-ish word. */
const VERBISH_BEFORE_DO = new Set(["likh", "de", "bata", "kar", "hata", "bech", "dal", "daal", "rakh", "jod", "bhej", "chhod", "mita"]);

/**
 * Speech engines spell Hindi differently: Whisper writes Devanagari ("बिकी"), which we
 * transliterate to "bikee", while users type "biki". Map any word that differs from a known
 * command word only in long vowels (ee/i, oo/u, aa/a) to that known spelling. Product names
 * are not in this vocabulary, so they pass through unchanged.
 */
const vowelCanon = (w: string) =>
  w
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/aa/g, "a")
    .replace(/ii/g, "i")
    .replace(/uu/g, "u")
    // Hindi drops the inherent "a" mid-word: कितनी → "kitanee" → "kitni", बिजली → "bijli".
    .replace(/([^aeiou])a(?=[^aeiou][aeiou])/g, "$1");
const EXTRA_VOCAB = [
  "aaj", "kal", "ne", "ka", "ki", "ke", "ko", "se", "par", "pe", "rupaye", "rupees", "month", "mahine", "mahina", "hafte", "hafta", "week", "din",
  "sale", "bill", "entry", "purchase", "set", "badha", "badhao", "ghata", "ghatao", "product", "products", "saman", "samaan", "item", "items",
  "cheez", "galla", "collection", "kamaya", "naam", "name", "number", "mobile", "phone", "bik", "beche", "bechi", "becha", "becho", "bechna",
];
/** Phonetic spellings of English words as Hindi speech engines write them (सेल → "sel"). */
const SPELLINGS: Record<string, string> = { sel: "sale", sels: "sales", stok: "stock", profit: "profit", prophit: "profit", rupye: "rupaye", rupaya: "rupaye" };
const VOCAB: ReadonlySet<string> = new Set([
  ...SALE_VERBS, ...PURCHASE_VERBS, ...PAYMENT_VERBS, ...CREDIT_WORDS, ...EXPENSE_WORDS, ...Object.keys(EXPENSE_CATEGORIES), ...DAMAGE_WORDS,
  ...RETURN_WORDS, ...UNDO_WORDS, ...LAST_WORDS, ...QUESTION_WORDS, ...STOCK_WORDS, ...PROFIT_WORDS, ...LOW_WORDS, ...OUTSTANDING_WORDS,
  ...SUMMARY_WORDS, ...SEARCH_WORDS, ...NEW_WORDS, ...CUSTOMER_WORDS, ...SUPPLIER_WORDS, ...UPI_WORDS, ...CARD_WORDS, ...CASH_WORDS,
  ...CONJUNCTIONS, ...Object.keys(UNITS), ...FILLERS, ...Object.keys(NUMBER_WORDS), ...Object.keys(MULTIPLIERS), ...EXTRA_VOCAB,
]);
const CANON_INDEX = new Map<string, string>();
for (const w of VOCAB) if (!CANON_INDEX.has(vowelCanon(w))) CANON_INDEX.set(vowelCanon(w), w);

/** True when a (normalised) token is a command/filler word rather than a possible product word. */
export function isCommandWord(t: string): boolean {
  return VOCAB.has(vocabWord(t));
}

/** Known command word for a token, tolerant of long-vowel spellings; otherwise the token itself. */
export function vocabWord(t: string): string {
  if (SPELLINGS[t]) return SPELLINGS[t];
  if (VOCAB.has(t) || t.length < 3 || /^\d/.test(t)) return t;
  const c = vowelCanon(t);
  return SPELLINGS[c] ?? CANON_INDEX.get(c) ?? t;
}

interface Tok {
  t: string;
  i: number;
}

function detectLanguage(raw: string, tokens: string[]): Lang {
  if (hasDevanagari(raw)) return "hindi";
  const hinglishHits = tokens.filter((t) =>
    ["aaj", "kal", "biki", "bika", "bechi", "kitna", "kitni", "hai", "ka", "ki", "ne", "ko", "se", "diye", "udhaar", "aur", "batao", "bachi", "aayi", "likh", "kharcha", "kya", "hua"].includes(t),
  ).length;
  return hinglishHits > 0 ? "hinglish" : "english";
}

/** Numbers: digits, decimals, Hindi/English words, multipliers ("paanch sau", "2 hazaar", "5k"). */
function readNumber(tokens: Tok[], idx: number): { value: number; next: number } | null {
  const tok = tokens[idx];
  if (!tok) return null;
  let value: number | null = null;
  if (/^\d+(\.\d+)?$/.test(tok.t)) value = Number(tok.t);
  else if (NUMBER_WORDS[tok.t] !== undefined) {
    if (tok.t === "do") {
      const prev = tokens[idx - 1]?.t;
      const next = tokens[idx + 1]?.t;
      if ((prev && VERBISH_BEFORE_DO.has(prev)) || !next || FILLERS.has(next) || PAYMENT_VERBS.has(next)) return null;
    }
    value = NUMBER_WORDS[tok.t]!;
  }
  if (value === null) return null;
  let next = idx + 1;
  while (tokens[next] && MULTIPLIERS[tokens[next]!.t] !== undefined) {
    value *= MULTIPLIERS[tokens[next]!.t]!;
    next++;
  }
  return { value, next };
}

function preprocess(raw: string): string {
  return raw
    .replace(/₹\s*([\d,]+(\.\d+)?)/g, (_, n: string) => `${n.replace(/,/g, "")} rupaye`)
    .replace(/(\d),(\d{2,3})/g, "$1$2")
    .replace(/(\d+)\s*k\b/gi, "$1 hazaar")
    .replace(/\?/g, " ? ");
}

function hasAny(tokens: string[], set: ReadonlySet<string> | Record<string, unknown>): boolean {
  const has = set instanceof Set ? (t: string) => set.has(t) : (t: string) => t in (set as Record<string, unknown>);
  return tokens.some(has);
}

/** Finds a name immediately before a case-marker particle ("Ramesh ne", "Sharma se"). */
function nameBefore(tokens: Tok[], particles: string[], original: string[]): string | null {
  for (let i = 1; i < tokens.length; i++) {
    if (!particles.includes(tokens[i]!.t)) continue;
    const words: string[] = [];
    for (let j = i - 1; j >= 0 && words.length < 3; j--) {
      const t = tokens[j]!.t;
      if (FILLERS.has(t) || /^\d/.test(t) || NUMBER_WORDS[t] !== undefined || isKeyword(t)) break;
      words.unshift(original[tokens[j]!.i] ?? t);
    }
    if (words.length) return titleCase(words.join(" "));
  }
  return null;
}

function isKeyword(t: string): boolean {
  return (
    SALE_VERBS.has(t) || PURCHASE_VERBS.has(t) || PAYMENT_VERBS.has(t) || CREDIT_WORDS.has(t) || EXPENSE_WORDS.has(t) || UNDO_WORDS.has(t) ||
    QUESTION_WORDS.has(t) || STOCK_WORDS.has(t) || PROFIT_WORDS.has(t) || CUSTOMER_WORDS.has(t) || SUPPLIER_WORDS.has(t) || UPI_WORDS.has(t) ||
    CASH_WORDS.has(t) || CARD_WORDS.has(t) || NEW_WORDS.has(t) || DAMAGE_WORDS.has(t) || RETURN_WORDS.has(t) || t === "?"
  );
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Extracts "<qty> [unit] <product words>" items, split on conjunctions and numbers. */
function extractItems(tokens: Tok[], original: string[], skipNames: Set<string>): ItemEntity[] {
  const items: ItemEntity[] = [];
  let cur: { qty: number | null; unit: string | null; words: string[] } | null = null;
  const flush = () => {
    if (cur && (cur.words.length || cur.qty !== null)) {
      items.push({ query: cur.words.length ? cur.words.join(" ") : null, quantity: cur.qty, unit: cur.unit, price_rupees: null });
    }
    cur = null;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!.t;
    const num = readNumber(tokens, i);
    if (num) {
      const after = tokens[num.next]?.t;
      // "Coke 500 ml" — a size that is part of the product name, not a quantity.
      if (after && SIZE_UNITS.has(after) && cur && cur.words.length > 0) {
        cur.words.push(tokens[i]!.t, after);
        i = num.next;
        continue;
      }
      // "20 rupaye" is money, not a quantity.
      if (after && ["rupaye", "rupay", "rupees", "rs", "rupee", "rupiya", "rupya"].includes(after)) {
        i = num.next;
        continue;
      }
      if (cur && cur.qty === null && cur.words.length) {
        // "Coke 20" — number after the product.
        cur.qty = num.value;
      } else {
        flush();
        cur = { qty: num.value, unit: null, words: [] };
      }
      i = num.next - 1;
      const unit = tokens[num.next] ? UNITS[tokens[num.next]!.t] : undefined;
      if (unit && cur) {
        cur.unit = unit;
        i = num.next;
      }
      continue;
    }
    if (CONJUNCTIONS.has(t) || t === "?") {
      flush();
      continue;
    }
    if (UNITS[t] && cur && cur.qty !== null && !cur.unit && !cur.words.length) {
      cur.unit = UNITS[t]!;
      continue;
    }
    if (FILLERS.has(t) || isKeyword(t) || skipNames.has(t)) continue;
    if (!cur) cur = { qty: null, unit: null, words: [] };
    cur.words.push(original[tokens[i]!.i] ?? t);
  }
  flush();
  return items.slice(0, 30);
}

function extractAmount(tokens: Tok[]): number | null {
  // Prefer numbers explicitly marked as money, else the largest standalone number.
  let best: number | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const n = readNumber(tokens, i);
    if (!n) continue;
    const after = tokens[n.next]?.t;
    if (after && ["rupaye", "rupay", "rupees", "rs", "rupee", "rupiya", "rupya"].includes(after)) return n.value;
    if (best === null || n.value > best) best = n.value;
    i = n.next - 1;
  }
  return best;
}

function extractPeriod(tokens: string[]): Period | null {
  const s = ` ${tokens.join(" ")} `;
  if (/ (kal|yesterday) /.test(s) && !/ (aaj|today) /.test(s)) return "yesterday";
  if (/ (is|iss|this) (hafte|hafta|week) /.test(s)) return "this_week";
  if (/ (pichle|pichla|last) (mahine|mahina|month) /.test(s)) return "last_month";
  if (/ (is|iss|this) (mahine|mahina|month) | (month|mahine|mahina) /.test(s)) return "this_month";
  if (/ (7|saat) din | last 7 days | (hafte|week) /.test(s)) return "last_7_days";
  if (/ (30|tees) din /.test(s)) return "last_30_days";
  return null;
}

function paymentMethod(tokens: string[]): "CASH" | "UPI" | "CARD" | "CREDIT" | null {
  if (hasAny(tokens, UPI_WORDS)) return "UPI";
  if (hasAny(tokens, CARD_WORDS)) return "CARD";
  if (hasAny(tokens, CASH_WORDS)) return "CASH";
  if (tokens.some((t) => ["udhaar", "udhar", "udhari", "credit"].includes(t))) return "CREDIT";
  return null;
}

function result(intent: ParsedIntent["intent"], confidence: number, language: Lang, entities: ParsedIntent["entities"], clarification: string | null = null): ParsedIntent {
  const mutating = !["CHECK_STOCK", "CHECK_SALES", "CHECK_PROFIT", "CHECK_OUTSTANDING", "LOW_STOCK_QUERY", "DAILY_SUMMARY", "MONTHLY_SUMMARY", "SEARCH_PRODUCT", "SEARCH_CUSTOMER", "SEARCH_SUPPLIER", "UNKNOWN"].includes(intent);
  return { intent, confidence, language, entities, requires_confirmation: mutating, clarification };
}

export function parseWithRules(input: string): ParsedIntent {
  const raw = input.trim().slice(0, 500);
  const pre = preprocess(raw);
  const norm = normalizeText(pre).replace(/\s+\?\s*/g, " ? ");
  const rawWords = norm.split(" ").filter(Boolean);
  const words = rawWords.map(vocabWord);
  // Original (non-lowercased, transliterated) words — for display of names/products.
  const translit = transliterate(pre);
  const originalWords = rawWords.map((w) => restoreCase(w, translit));
  const tokens: Tok[] = words.map((t, i) => ({ t, i }));
  const ts = words;
  const language = detectLanguage(raw, ts);
  const isQuestion = raw.includes("?") || hasAny(ts, QUESTION_WORDS);
  const date = ts.includes("kal") || ts.includes("yesterday") ? "yesterday" : null;

  if (!ts.length) return result("UNKNOWN", 0, language, {});

  // ── Undo ────────────────────────────────────────────────────────────────
  if (hasAny(ts, UNDO_WORDS) && (hasAny(ts, LAST_WORDS) || ts.some((t) => ["sale", "bill", "entry", "purchase", "kharcha", "expense"].includes(t)))) {
    const target = ts.some((t) => PURCHASE_VERBS.has(t) || t === "purchase") ? "purchase" : ts.some((t) => EXPENSE_WORDS.has(t)) ? "expense" : "sale";
    return result("UNDO_TRANSACTION", 0.9, language, { undo_target: target });
  }

  // ── Read-only questions ─────────────────────────────────────────────────
  if (isQuestion) {
    const period = extractPeriod(ts);
    if (hasAny(ts, PROFIT_WORDS)) return result("CHECK_PROFIT", 0.93, language, { period: period ?? (ts.some((t) => ["month", "mahine", "mahina"].includes(t)) ? "this_month" : "today") });
    if (hasAny(ts, LOW_WORDS) && (hasAny(ts, STOCK_WORDS) || ts.some((t) => ["product", "products", "saman", "samaan", "item", "items", "cheez", "kya"].includes(t)))) {
      return result("LOW_STOCK_QUERY", 0.93, language, {});
    }
    if (ts.some((t) => OUTSTANDING_WORDS.has(t)) && !hasAny(ts, SALE_VERBS)) {
      const customer = nameBefore(tokens, ["ka", "ki", "ke", "par", "pe"], originalWords);
      return result("CHECK_OUTSTANDING", 0.9, language, { customer });
    }
    if (hasAny(ts, SUMMARY_WORDS) && !hasAny(ts, STOCK_WORDS)) {
      const monthly = period === "this_month" || period === "last_month";
      return result(monthly ? "MONTHLY_SUMMARY" : "DAILY_SUMMARY", 0.9, language, { period: period ?? (monthly ? "this_month" : "today") });
    }
    if (ts.some((t) => ["sale", "sales", "bikri", "becha", "bechi", "bika", "biki", "bikri", "kamaya", "galla", "collection"].includes(t))) {
      return result("CHECK_SALES", 0.92, language, { period: period ?? "today" });
    }
    if (hasAny(ts, STOCK_WORDS) || ts.some((t) => ["kitne", "kitni", "kitna"].includes(t))) {
      const items = extractItems(tokens, originalWords, new Set());
      const q = items.find((i) => i.query)?.query ?? null;
      return result("CHECK_STOCK", q ? 0.92 : 0.8, language, { items: q ? [{ query: q, quantity: null, unit: null, price_rupees: null }] : [] });
    }
    if (hasAny(ts, SEARCH_WORDS)) {
      const items = extractItems(tokens, originalWords, new Set());
      return result("SEARCH_PRODUCT", 0.85, language, { search_query: items.find((i) => i.query)?.query ?? null });
    }
  }

  // ── Create customer / supplier ─────────────────────────────────────────
  if (hasAny(ts, NEW_WORDS) && (hasAny(ts, CUSTOMER_WORDS) || hasAny(ts, SUPPLIER_WORDS))) {
    const supplier = hasAny(ts, SUPPLIER_WORDS);
    const phoneMatch = raw.replace(/[\s-]/g, "").match(/(?:\+?91)?([6-9]\d{9})/);
    const nameWords = tokens
      .filter((x) => !FILLERS.has(x.t) && !isKeyword(x.t) && !/^\d/.test(x.t) && !["name", "naam", "number", "mobile", "phone"].includes(x.t))
      .map((x) => originalWords[x.i] ?? x.t);
    const name = nameWords.length ? titleCase(nameWords.slice(0, 4).join(" ")) : null;
    return result(supplier ? "CREATE_SUPPLIER" : "CREATE_CUSTOMER", name ? 0.9 : 0.6, language, {
      [supplier ? "supplier" : "customer"]: name,
      phone: phoneMatch?.[1] ?? null,
    });
  }

  // ── Search ──────────────────────────────────────────────────────────────
  if (hasAny(ts, SEARCH_WORDS) && (hasAny(ts, CUSTOMER_WORDS) || hasAny(ts, SUPPLIER_WORDS))) {
    const q = tokens.filter((x) => !FILLERS.has(x.t) && !isKeyword(x.t)).map((x) => originalWords[x.i] ?? x.t).join(" ") || null;
    return result(hasAny(ts, SUPPLIER_WORDS) ? "SEARCH_SUPPLIER" : "SEARCH_CUSTOMER", 0.85, language, { search_query: q });
  }

  // ── Expenses ────────────────────────────────────────────────────────────
  const categoryToken = ts.find((t) => EXPENSE_CATEGORIES[t] !== undefined);
  const moneyWord = ts.some((t) => ["rupaye", "rupay", "rupees", "rs", "rupee", "rupiya", "rupya"].includes(t));
  // "chai", "paani" alone are as likely to be products ("do paani ki bottle") as expenses.
  const expenseCategory = categoryToken && (EXPENSE_CATEGORIES[categoryToken] !== "Other" || hasAny(ts, EXPENSE_WORDS) || moneyWord);
  if ((hasAny(ts, EXPENSE_WORDS) || expenseCategory) && !hasAny(ts, SALE_VERBS) && !ts.includes("ne")) {
    const amount = extractAmount(tokens);
    const category = categoryToken ? EXPENSE_CATEGORIES[categoryToken]! : null;
    if (amount || category) {
      return result("CREATE_EXPENSE", amount && category ? 0.92 : amount ? 0.8 : 0.6, language, {
        amount_rupees: amount,
        expense_category: category ?? "Other",
        payment_method: paymentMethod(ts) === "CREDIT" ? null : paymentMethod(ts),
        note: category ? null : titleCase(tokens.filter((x) => !FILLERS.has(x.t) && !isKeyword(x.t) && !/^\d/.test(x.t)).map((x) => originalWords[x.i] ?? x.t).join(" ")) || null,
        date,
      });
    }
  }

  // ── Stock adjustment (damage / return / manual) ─────────────────────────
  const damage = hasAny(ts, DAMAGE_WORDS);
  const returned = hasAny(ts, RETURN_WORDS) && !hasAny(ts, SALE_VERBS);
  const manualStock =
    ts.includes("stock") &&
    ts.some((t) => ["kam", "badha", "badhao", "badhado", "ghata", "ghatao", "set", "add", "hatao"].includes(t)) &&
    !ts.some((t) => PURCHASE_VERBS.has(t) && t !== "stock");
  if (damage || returned || manualStock) {
    const items = extractItems(tokens, originalWords, new Set(["stock"]));
    const direction = damage ? "decrease" : returned ? "increase" : ts.some((t) => ["kam", "ghata", "ghatao", "hatao"].includes(t)) ? "decrease" : ts.includes("set") ? "set" : "increase";
    return result("ADJUST_STOCK", items.length && items[0]?.quantity ? 0.9 : 0.7, language, {
      items,
      adjustment_type: damage ? "DAMAGE" : returned ? "RETURN" : "ADJUSTMENT",
      stock_direction: direction,
    });
  }

  const saleVerb = hasAny(ts, SALE_VERBS);
  const purchaseVerb = ts.some((t) => PURCHASE_VERBS.has(t) && t !== "stock");
  const creditWord = ts.some((t) => ["udhaar", "udhar", "udhari", "udhaari", "credit"].includes(t));
  const payVerb = hasAny(ts, PAYMENT_VERBS);
  const money = ts.some((t) => ["rupaye", "rupay", "rupees", "rs", "rupee", "rupiya", "rupya"].includes(t));

  // ── Purchase: "Sharma se 3 crate Coke aayi" ─────────────────────────────
  if (purchaseVerb && !saleVerb) {
    const supplier = nameBefore(tokens, ["se"], originalWords);
    const skip = new Set((supplier ?? "").toLowerCase().split(" "));
    const items = extractItems(tokens, originalWords, skip);
    if (items.length) {
      const complete = items.every((i) => i.query && i.quantity);
      return result("CREATE_PURCHASE", complete ? 0.9 : 0.75, language, {
        items,
        supplier,
        payment_method: creditWord ? "CREDIT" : paymentMethod(ts),
        date,
      });
    }
  }

  // ── Customer payment: "Ramesh ne 500 de diye" / supplier payment: "Sharma ko 2000 diye" ─
  const receivedFrom = nameBefore(tokens, ["ne", "se"], originalWords);
  const paidTo = nameBefore(tokens, ["ko"], originalWords);
  const anyName = nameBefore(tokens, ["ka", "ki", "ke", "ko", "ne", "se", "par", "pe"], originalWords);
  const amountOnly = (() => {
    const names = [receivedFrom, paidTo, anyName].flatMap((n) => (n ?? "").toLowerCase().split(" "));
    return extractItems(tokens, originalWords, new Set(names)).every((i) => !i.query);
  })();
  if (payVerb && !saleVerb && (money || amountOnly) && (receivedFrom || paidTo) && !creditWord) {
    const amount = extractAmount(tokens);
    const received = Boolean(receivedFrom) || ts.some((t) => ["mile", "mila", "mili", "received", "jama"].includes(t));
    return result("CREATE_PAYMENT", amount ? 0.92 : 0.7, language, {
      customer: received ? (receivedFrom ?? paidTo) : null,
      supplier: received ? null : paidTo,
      amount_rupees: amount,
      direction: received ? "received" : "paid",
      payment_method: paymentMethod(ts) === "CREDIT" ? null : paymentMethod(ts),
      date,
    });
  }

  // ── Manual udhaar: "Ramesh ka 850 udhaar likh do" ───────────────────────
  if (creditWord && !saleVerb && amountOnly) {
    const customer = nameBefore(tokens, ["ka", "ki", "ke", "ko", "par", "pe", "ne"], originalWords);
    const amount = extractAmount(tokens);
    return result("CREATE_CREDIT", customer && amount ? 0.92 : 0.7, language, { customer, amount_rupees: amount, date });
  }

  // ── Sale: "Aaj 20 Coke aur 10 Sprite biki" / "Ramesh ko 5 Coke udhaar" ──
  if (saleVerb || (creditWord && !amountOnly) || (paidTo && !amountOnly && payVerb)) {
    const customer = nameBefore(tokens, ["ko", "ke"], originalWords);
    const skip = new Set((customer ?? "").toLowerCase().split(" "));
    const items = extractItems(tokens, originalWords, skip);
    if (items.length) {
      const complete = items.every((i) => i.query && i.quantity);
      const followUp = items.every((i) => !i.query && i.quantity);
      return result("CREATE_SALE", complete ? 0.93 : followUp ? 0.85 : 0.75, language, {
        items,
        customer,
        payment_method: creditWord ? "CREDIT" : paymentMethod(ts),
        date,
      });
    }
  }

  // ── Bare stock question without "?" ("coke stock") ──────────────────────
  if (hasAny(ts, STOCK_WORDS)) {
    const items = extractItems(tokens, originalWords, new Set(["stock"]));
    const q = items.find((i) => i.query)?.query ?? null;
    if (q) return result("CHECK_STOCK", 0.8, language, { items: [{ query: q, quantity: null, unit: null, price_rupees: null }] });
  }

  // ── Implicit sale: "Two water bottle", "3 Maggi" ────────────────────────
  // At a shop counter a bare "quantity + product" means it was sold. Still a proposal.
  if (!hasAny(ts, QUESTION_WORDS) && !ts.includes("?")) {
    const items = extractItems(tokens, originalWords, new Set()).map((i) => {
      // "water bottle" → product "water", unit bottle.
      const words = i.query?.split(" ") ?? [];
      const last = words.at(-1)?.toLowerCase();
      if (!i.unit && words.length > 1 && last && UNITS[vocabWord(last)]) return { ...i, query: words.slice(0, -1).join(" "), unit: UNITS[vocabWord(last)]! };
      return i;
    });
    // Large bare numbers ("Ramesh 500") are more likely money than a quantity.
    if (items.length && items.every((i) => i.query && i.quantity && (i.unit || i.quantity <= 100))) {
      return result("CREATE_SALE", 0.9, language, { items, customer: null, payment_method: creditWord ? "CREDIT" : paymentMethod(ts), date });
    }
  }

  return result("UNKNOWN", 0.2, language, {});
}

/** Recovers the user's capitalisation of a normalised word (for display of names/products). */
function restoreCase(word: string, source: string): string {
  if (!/^[a-z]+$/.test(word)) return word;
  const m = source.match(new RegExp(`(?<![A-Za-z])(${word})(?![A-Za-z])`, "i"));
  return m ? m[1]! : word;
}
