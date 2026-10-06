import { z } from "zod";
import { ADJUSTMENT_TYPES, MOVEMENT_TYPES } from "@/lib/domain";
import { idSchema, isoDateSchema, optionalText } from "./common";

export const adjustStockSchema = z
  .object({
    productId: idSchema,
    type: z.enum(ADJUSTMENT_TYPES).default("ADJUSTMENT"),
    /** "delta": add/remove `quantityMilli`; "set": physical count sets stock to `quantityMilli`. */
    mode: z.enum(["delta", "set"]).default("delta"),
    direction: z.enum(["increase", "decrease"]).default("increase"),
    quantityMilli: z.number().int().min(0).max(1_000_000_000),
    reason: optionalText(200),
  })
  .refine((v) => v.mode === "set" || v.quantityMilli > 0, { message: "Quantity must be more than zero", path: ["quantityMilli"] })
  .refine((v) => v.mode === "delta" || v.type === "ADJUSTMENT", { message: "Stock count only applies to adjustments", path: ["mode"] });
export type AdjustStockInput = z.input<typeof adjustStockSchema>;

export const listMovementsSchema = z.object({
  productId: z.string().max(64).optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  before: z.coerce.number().int().optional(),
  cursor: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
