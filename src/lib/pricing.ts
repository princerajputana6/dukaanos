/**
 * Pricing & GST engine — pure integer math, shared by the POS UI (live preview) and the
 * server (authoritative). See ARCHITECTURE.md §5.
 *
 * Per line:
 *   gross      = round(unitPrice × qty)
 *   discount   = line discount + allocated share of the bill discount
 *   net        = gross − discount
 *   GST-inclusive prices: taxable = round(net × 10000 / (10000 + rate)), tax = net − taxable
 *   GST-exclusive prices: taxable = net, tax = round(taxable × rate / 10000)
 *   intra-state: CGST = floor(tax / 2), SGST = tax − CGST · inter-state: IGST = tax
 */
import { allocateProportionally, roundDiv } from "./money";
import { lineAmount } from "./qty";

export interface PriceLineInput {
  unitPricePaise: number;
  quantityMilli: number;
  discountPaise?: number;
  gstRateBp: number;
}

export interface PricedLine {
  grossPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  totalPaise: number;
}

export interface PricedDocument {
  lines: PricedLine[];
  subtotalPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  totalPaise: number;
}

export class PricingError extends Error {}

export function priceDocument(opts: {
  lines: readonly PriceLineInput[];
  billDiscountPaise?: number;
  pricesIncludeGst: boolean;
  interstate: boolean;
}): PricedDocument {
  const grosses = opts.lines.map((l) => {
    if (!Number.isInteger(l.unitPricePaise) || l.unitPricePaise < 0) throw new PricingError("Price must be a non-negative amount.");
    if (!Number.isInteger(l.quantityMilli) || l.quantityMilli <= 0) throw new PricingError("Quantity must be more than zero.");
    return lineAmount(l.unitPricePaise, l.quantityMilli);
  });
  const lineDiscounts = opts.lines.map((l, i) => {
    const d = l.discountPaise ?? 0;
    if (!Number.isInteger(d) || d < 0) throw new PricingError("Discount must be a non-negative amount.");
    if (d > (grosses[i] ?? 0)) throw new PricingError("Discount cannot be more than the item amount.");
    return d;
  });
  const afterLine = grosses.map((g, i) => g - (lineDiscounts[i] ?? 0));
  const billDiscount = opts.billDiscountPaise ?? 0;
  if (!Number.isInteger(billDiscount) || billDiscount < 0) throw new PricingError("Discount must be a non-negative amount.");
  const afterLineTotal = afterLine.reduce((a, b) => a + b, 0);
  if (billDiscount > afterLineTotal) throw new PricingError("Discount cannot be more than the bill amount.");
  const allocated = allocateProportionally(billDiscount, afterLine);

  const lines: PricedLine[] = opts.lines.map((l, i) => {
    const gross = grosses[i] ?? 0;
    const discount = (lineDiscounts[i] ?? 0) + (allocated[i] ?? 0);
    const net = gross - discount;
    const rate = l.gstRateBp;
    let taxable: number;
    let tax: number;
    if (rate <= 0) {
      taxable = net;
      tax = 0;
    } else if (opts.pricesIncludeGst) {
      taxable = roundDiv(net * 10000, 10000 + rate);
      tax = net - taxable;
    } else {
      taxable = net;
      tax = roundDiv(taxable * rate, 10000);
    }
    const cgst = opts.interstate ? 0 : Math.floor(tax / 2);
    const sgst = opts.interstate ? 0 : tax - cgst;
    const igst = opts.interstate ? tax : 0;
    return { grossPaise: gross, discountPaise: discount, taxablePaise: taxable, cgstPaise: cgst, sgstPaise: sgst, igstPaise: igst, taxPaise: tax, totalPaise: taxable + tax };
  });

  const sum = (k: keyof PricedLine) => lines.reduce((a, l) => a + l[k], 0);
  return {
    lines,
    subtotalPaise: sum("grossPaise"),
    discountPaise: sum("discountPaise"),
    taxablePaise: sum("taxablePaise"),
    cgstPaise: sum("cgstPaise"),
    sgstPaise: sum("sgstPaise"),
    igstPaise: sum("igstPaise"),
    taxPaise: sum("taxPaise"),
    totalPaise: sum("totalPaise"),
  };
}

/** GST rate display: 1800 → "18%", 25 → "0.25%". */
export function formatGstRate(bp: number): string {
  return `${(bp / 100).toString()}%`;
}

/** Interstate when both state codes are known and differ. */
export function isInterstate(businessState: string | null | undefined, partyState: string | null | undefined): boolean {
  return Boolean(businessState && partyState && businessState !== partyState);
}
