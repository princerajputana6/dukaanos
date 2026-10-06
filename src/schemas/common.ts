import { z } from "zod";
import { isValidIsoDate } from "@/lib/dates";
import { normalizeMobile } from "@/lib/text";

export const idSchema = z.string().min(1).max(64);
export const isoDateSchema = z.string().refine(isValidIsoDate, "Invalid date (YYYY-MM-DD)");
/** Money in paise: non-negative integer, ≤ ₹10 crore per value. */
export const paiseSchema = z.number().int().min(0).max(1_000_000_000);
export const signedPaiseSchema = z.number().int().min(-1_000_000_000).max(1_000_000_000);
/** Quantity in milli-units: positive, ≤ 10 lakh units. */
export const qtyMilliSchema = z.number().int().positive().max(1_000_000_000);
export const gstRateBpSchema = z.number().int().min(0).max(4000);
export const trimmed = (max: number) => z.string().trim().max(max);
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullish();
export const mobileSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const m = normalizeMobile(v);
    if (!m) {
      ctx.addIssue({ code: "custom", message: "Enter a valid 10-digit mobile number" });
      return z.NEVER;
    }
    return m;
  });
export const optionalMobileSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    const m = normalizeMobile(v);
    if (!m) {
      ctx.addIssue({ code: "custom", message: "Enter a valid 10-digit mobile number" });
      return z.NEVER;
    }
    return m;
  })
  .nullish();
export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email").max(200);
export const stateCodeSchema = z.string().regex(/^\d{2}$/).nullish();

export const paginationSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const dateRangeSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((r) => r.from <= r.to, "`from` must be on or before `to`");

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
