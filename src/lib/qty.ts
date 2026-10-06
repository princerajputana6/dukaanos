/**
 * Quantities are integer MILLI-units (1 unit = 1000) so shops can sell 0.5 kg or 1.25 L
 * without floating-point drift.
 */
import { roundDiv } from "./money";

export type Milli = number;

export const QTY_SCALE = 1000;

/** 2 → 2000, 0.5 → 500. Rejects more than 3 decimals. */
export function toMilli(value: number | string): Milli | null {
  const s = typeof value === "number" ? String(value) : value.trim();
  if (!/^-?\d+(\.\d{0,3})?$/.test(s)) return null;
  const negative = s.startsWith("-");
  const [whole = "0", frac = ""] = s.replace("-", "").split(".");
  const milli = Number(whole) * QTY_SCALE + Number((frac + "000").slice(0, 3));
  if (!Number.isSafeInteger(milli)) return null;
  return negative ? -milli : milli;
}

/** 2500 → 2.5 (for display & inputs only, never for arithmetic). */
export function fromMilli(milli: Milli): number {
  return milli / QTY_SCALE;
}

/** 2500 → "2.5", 2000 → "2", 1234 → "1.234". */
export function formatQty(milli: Milli): string {
  const sign = milli < 0 ? "-" : "";
  const abs = Math.abs(milli);
  const whole = Math.trunc(abs / QTY_SCALE);
  const frac = abs % QTY_SCALE;
  if (frac === 0) return `${sign}${whole.toLocaleString("en-IN")}`;
  return `${sign}${whole.toLocaleString("en-IN")}.${String(frac).padStart(3, "0").replace(/0+$/, "")}`;
}

/** "2.5 kg", "20 pcs". */
export function formatQtyWithUnit(milli: Milli, unit: string): string {
  return `${formatQty(milli)} ${unit}`;
}

/** Line amount in paise for `qtyMilli` units at `unitPricePaise`, rounded half-up. */
export function lineAmount(unitPricePaise: number, qtyMilli: Milli): number {
  const n = unitPricePaise * qtyMilli;
  if (!Number.isSafeInteger(n)) {
    return Number((BigInt(unitPricePaise) * BigInt(qtyMilli) + 500n) / 1000n);
  }
  return roundDiv(n, QTY_SCALE);
}
