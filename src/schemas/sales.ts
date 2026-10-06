import { z } from "zod";
import { PAYMENT_METHODS, SETTLEMENT_METHODS } from "@/lib/domain";
import { idSchema, isoDateSchema, optionalText, paiseSchema, qtyMilliSchema } from "./common";

export const saleItemSchema = z.object({
  productId: idSchema,
  quantityMilli: qtyMilliSchema,
  /** Override the product's selling price for this sale (e.g. bargaining). */
  unitPricePaise: paiseSchema.optional(),
  discountPaise: paiseSchema.default(0),
});

export const createSaleSchema = z
  .object({
    items: z.array(saleItemSchema).min(1, "Add at least one item").max(100, "A bill can have at most 100 items"),
    customerId: idSchema.nullish(),
    billDiscountPaise: paiseSchema.default(0),
    payment: z.object({
      method: z.enum(PAYMENT_METHODS),
      /** Amount collected now. Defaults to the full total (or 0 for CREDIT). */
      paidPaise: paiseSchema.optional(),
    }),
    txnDate: isoDateSchema.optional(),
    notes: optionalText(300),
  })
  .refine((v) => v.payment.method !== "CREDIT" || !!v.customerId, { message: "Choose a customer for a credit (udhaar) sale", path: ["customerId"] });
export type CreateSaleInput = z.input<typeof createSaleSchema>;

export const listSalesSchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  q: z.string().trim().max(100).optional(),
  status: z.enum(["COMPLETED", "REVERSED", "all"]).default("all"),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  customerId: z.string().max(64).optional(),
  cursor: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const purchaseItemSchema = z.object({
  productId: idSchema,
  quantityMilli: qtyMilliSchema,
  unitCostPaise: paiseSchema,
  discountPaise: paiseSchema.default(0),
  gstRateBp: z.number().int().min(0).max(4000).optional(),
});

export const createPurchaseSchema = z
  .object({
    supplierId: idSchema.nullish(),
    billNumber: optionalText(40),
    items: z.array(purchaseItemSchema).min(1, "Add at least one item").max(100),
    billDiscountPaise: paiseSchema.default(0),
    /** Supplier bills usually show cost before GST. */
    pricesIncludeGst: z.boolean().default(false),
    payment: z.object({
      status: z.enum(["PAID", "PARTIAL", "UNPAID"]),
      method: z.enum(SETTLEMENT_METHODS).default("CASH"),
      paidPaise: paiseSchema.optional(),
    }),
    txnDate: isoDateSchema.optional(),
    notes: optionalText(300),
  })
  .refine((v) => v.payment.status === "PAID" || !!v.supplierId, { message: "Choose a supplier for an unpaid or partly paid purchase", path: ["supplierId"] });
export type CreatePurchaseInput = z.input<typeof createPurchaseSchema>;

export const listPurchasesSchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  q: z.string().trim().max(100).optional(),
  status: z.enum(["COMPLETED", "REVERSED", "all"]).default("all"),
  supplierId: z.string().max(64).optional(),
  cursor: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
