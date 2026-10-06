/**
 * Text normalisation for search & entity resolution across English, Hindi (Devanagari)
 * and Hinglish. Pure functions — used by the server resolver and client-side search.
 */

const CONSONANTS: Record<string, string> = {
  क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n",
  च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "n",
  ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n",
  त: "t", थ: "th", द: "d", ध: "dh", न: "n",
  प: "p", फ: "ph", ब: "b", भ: "bh", म: "m",
  य: "y", र: "r", ल: "l", व: "v", ळ: "l",
  श: "sh", ष: "sh", स: "s", ह: "h",
  क़: "q", ख़: "kh", ग़: "g", ज़: "z", ड़: "r", ढ़: "rh", फ़: "f", य़: "y",
};
const VOWELS: Record<string, string> = {
  अ: "a", आ: "aa", इ: "i", ई: "ee", उ: "u", ऊ: "oo", ऋ: "ri",
  ए: "e", ऐ: "ai", ओ: "o", औ: "au", ऑ: "o",
};
const MATRAS: Record<string, string> = {
  "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri",
  "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o",
};
const MODIFIERS: Record<string, string> = { "ं": "n", "ँ": "n", "ः": "h" };
const VIRAMA = "्";
const NUKTA = "़";
const DEVANAGARI_DIGITS = "०१२३४५६७८९";

export function hasDevanagari(s: string): boolean {
  return /[ऀ-ॿ]/.test(s);
}

/** Lossy Devanagari → Latin transliteration good enough for matching ("कोक" → "kok"). */
export function transliterate(input: string): string {
  if (!hasDevanagari(input)) return input;
  const chars = Array.from(input.normalize("NFC"));
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i] ?? "";
    if (chars[i + 1] === NUKTA) {
      ch = ch + NUKTA;
      i++;
    }
    const digit = DEVANAGARI_DIGITS.indexOf(ch);
    if (digit >= 0) {
      out += String(digit);
      continue;
    }
    const cons = CONSONANTS[ch] ?? CONSONANTS[ch.replace(NUKTA, "")];
    if (cons !== undefined) {
      out += cons;
      const next = chars[i + 1];
      if (next === VIRAMA) {
        i++;
      } else if (next !== undefined && MATRAS[next] !== undefined) {
        out += MATRAS[next];
        i++;
      } else if (next !== undefined && /[ऀ-ॿ]/.test(next) && !MODIFIERS[next]) {
        out += "a"; // inherent vowel mid-word
      } else if (next !== undefined && MODIFIERS[next]) {
        out += "a";
      }
      // word-final inherent 'a' is dropped (schwa deletion)
      continue;
    }
    if (VOWELS[ch] !== undefined) {
      out += VOWELS[ch];
      continue;
    }
    if (MODIFIERS[ch] !== undefined) {
      out += MODIFIERS[ch];
      continue;
    }
    if (MATRAS[ch] !== undefined) {
      out += MATRAS[ch];
      continue;
    }
    if (ch === VIRAMA || ch === NUKTA) continue;
    out += ch;
  }
  return out;
}

const UNIT_ALIASES: Record<string, string> = {
  ltr: "l", litre: "l", liter: "l", litres: "l", liters: "l", lt: "l", ltrs: "l",
  gm: "g", gms: "g", gram: "g", grams: "g", gr: "g",
  kgs: "kg", kilo: "kg", kilos: "kg",
  mls: "ml",
};

/**
 * Lowercases, transliterates Devanagari, splits number/letter boundaries ("500ml" → "500 ml"),
 * canonicalises units, strips punctuation and collapses whitespace.
 */
export function normalizeText(input: string): string {
  const s = transliterate(input)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/[^a-z0-9.\s]/g, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s
    .split(" ")
    .map((t) => UNIT_ALIASES[t] ?? t)
    .join(" ");
}

export function tokenize(input: string): string[] {
  const n = normalizeText(input);
  return n ? n.split(" ") : [];
}

/**
 * Phonetic key that makes Hinglish spellings and transliterations collide:
 *   coke/kok/कोक → "kak", pepsi/पेप्सी → "paps", biscuit/बिस्किट → "baskat".
 */
export function phoneticKey(word: string): string {
  let s = normalizeText(word).replace(/[^a-z]/g, "");
  if (!s) return "";
  s = s
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/ch/g, "c")
    .replace(/sh/g, "s")
    .replace(/([kgtdbj])h/g, "$1")
    .replace(/c/g, "k")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/w/g, "v")
    .replace(/z/g, "j");
  s = s.replace(/[aeiouy]+/g, "a");
  s = s.replace(/([^a])\1+/g, "$1");
  if (s.length > 1 && s.endsWith("a")) s = s.slice(0, -1);
  return s;
}

/** Phonetic keys for each alphabetic token; numbers are kept verbatim. */
export function phoneticTokens(input: string): string[] {
  return tokenize(input).map((t) => (/^\d/.test(t) ? t : phoneticKey(t)));
}

/** Text stored in `search_text` columns: normalised text + phonetic keys. */
export function buildSearchText(...parts: Array<string | null | undefined>): string {
  const text = parts.filter(Boolean).join(" ");
  const norm = normalizeText(text);
  const phon = phoneticTokens(text).join(" ");
  return `${norm} | ${phon}`.slice(0, 1000);
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Dice coefficient over character trigrams, 0..1. */
export function trigramSimilarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = trigrams(na);
  const tb = trigrams(nb);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/** Optimal-string-alignment distance: Levenshtein + adjacent transpositions ("spirte" → 1). */
export function osaDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

/** Escapes a user string for use inside a SQL LIKE pattern with ESCAPE '\'. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Normalises an Indian mobile number to 10 digits, or null. */
export function normalizeMobile(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const ten = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase() || "?";
}
