import { z } from "zod";
import { idSchema, isoDateSchema, optionalText, paiseSchema, qtyMilliSchema } from "./common";

export const createPurchaseOrderSchema = z.object({
  supplierId: idSchema,
  note: optionalText(200),
  expectedDate: isoDateSchema.optional(),
  lines: z
    .array(
      z.object({
        productId: idSchema,
        orderedMilli: qtyMilliSchema,
        unitCostPaise: paiseSchema,
        gstRateBp: z.number().int().min(0).max(4000).optional(),
      }),
    )
    .min(1, "Add at least one product")
    .max(200, "Too many lines"),
});
export type CreatePurchaseOrderInput = z.input<typeof createPurchaseOrderSchema>;

/** Receive some/all of a PO. Omitted or zero quantities are skipped. */
export const receivePurchaseOrderSchema = z.object({
  billNumber: optionalText(40),
  note: optionalText(200),
  lines: z
    .array(z.object({ productId: idSchema, receivedMilli: z.number().int().min(0).max(1_000_000_000) }))
    .min(1, "Nothing to receive")
    .max(200),
});
export type ReceivePurchaseOrderInput = z.input<typeof receivePurchaseOrderSchema>;
