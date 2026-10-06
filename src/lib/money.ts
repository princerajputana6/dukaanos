/**
 * Money is ALWAYS an integer number of paise. Never do arithmetic on rupee floats.
 *   ₹100.50  →  10050
 */
export type Paise = number;

/** Integer division rounded half away from zero. Both args must be integers, d > 0. */
export function roundDiv(n: number, d: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(d) || d <= 0) {
    throw new RangeError(`roundDiv expects integers with d > 0 (got ${n}/${d})`);
  }
  const q = Math.trunc(n / d);
  const r = n - q * d;
  if (Math.abs(r) * 2 >= d) return n < 0 ? q - 1 : q + 1;
  return q;
}

/** Ensures the value is a safe integer amount of paise. */
export function assertPaise(value: number, label = "amount"): Paise {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be an integer number of paise`);
  return value;
}

/**
 * Parses user input like "100", "100.5", "1,250.75", "₹ 99" into paise.
 * Returns null for anything that is not a clean non-negative amount with ≤ 2 decimals.
 */
export function parseRupees(input: string | number): Paise | null {
  const raw = typeof input === "number" ? String(input) : input;
  const cleaned = raw.replace(/[₹,\s]/g, "").replace(/^rs\.?/i, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole = "0", frac = ""] = cleaned.split(".");
  const paise = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return Number.isSafeInteger(paise) ? paise : null;
}

/** Converts paise to a rupee string with 2 decimals, no symbol: 10050 → "100.50". */
export function paiseToRupeeString(paise: Paise): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const inrWholeFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Formats paise as Indian currency: 1234550 → "₹12,345.50".
 * `compact` drops ".00" for whole-rupee amounts (good for dashboards).
 */
export function formatMoney(paise: Paise, opts: { compact?: boolean } = {}): string {
  // Formatting is display-only, so converting to a float here is safe.
  if (opts.compact && paise % 100 === 0) return inrWholeFormatter.format(paise / 100);
  return inrFormatter.format(paise / 100);
}

/** Short form for charts: 150000000 → "₹15L", 250000 → "₹2.5K". */
export function formatMoneyShort(paise: Paise): string {
  const rupees = paise / 100;
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)}Cr`;
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)}L`;
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3)}K`;
  return `${sign}₹${trim(abs)}`;
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

/** Sums integer paise values. */
export function sumPaise(values: readonly Paise[]): Paise {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/**
 * Splits `total` across `weights` proportionally using the largest-remainder method so
 * the parts always add up exactly to `total`. Used for allocating bill-level discounts.
 */
export function allocateProportionally(total: Paise, weights: readonly number[]): Paise[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (weightSum <= 0) {
    const parts = weights.map(() => 0);
    parts[0] = total;
    return parts;
  }
  // BigInt keeps total × weight exact even for large bills.
  const T = BigInt(total);
  const S = BigInt(weightSum);
  const parts = weights.map((w) => {
    const num = T * BigInt(w);
    let q = num / S;
    let r = num % S;
    if (r < 0n) {
      q -= 1n;
      r += S;
    }
    return { q, r };
  });
  const floored = parts.map((p) => Number(p.q));
  let remainder = total - floored.reduce((a, b) => a + b, 0);
  const order = parts
    .map((p, i) => ({ i, r: p.r }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of order) {
    if (remainder <= 0) break;
    floored[i] = (floored[i] ?? 0) + 1;
    remainder -= 1;
  }
  return floored;
}
