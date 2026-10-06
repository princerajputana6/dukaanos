import { z } from "zod";
import { gstRateBpSchema, idSchema, optionalText, paiseSchema, trimmed } from "./common";

const unitNameSchema = z.string().trim().toLowerCase().min(1).max(20);

export const productUnitSchema = z.object({
  name: unitNameSchema,
  /** Base units per 1 of this unit, ×1000 (crate of 24 → 24000). */
  factorMilli: z.number().int().min(1).max(1_000_000_000),
});

const productBase = z.object({
  name: trimmed(120).min(1, "Enter a product name"),
  sku: optionalText(40),
  barcode: optionalText(40),
  categoryId: idSchema.nullish(),
  categoryName: optionalText(60),
  brand: optionalText(60),
  unit: unitNameSchema.default("pcs"),
  purchasePricePaise: paiseSchema.default(0),
  sellingPricePaise: paiseSchema,
  mrpPaise: paiseSchema.nullish(),
  gstRateBp: gstRateBpSchema.default(0),
  hsnCode: z
    .string()
    .trim()
    .regex(/^(\d{4}|\d{6}|\d{8})?$/, "HSN must be 4, 6 or 8 digits")
    .transform((v) => (v === "" ? null : v))
    .nullish(),
  lowStockThresholdMilli: z.number().int().min(0).max(1_000_000_000).nullish(),
  trackStock: z.boolean().default(true),
  supplierId: idSchema.nullish(),
  aliases: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  units: z.array(productUnitSchema).max(10).default([]),
});

export const createProductSchema = productBase
  .extend({ openingStockMilli: z.number().int().min(0).max(1_000_000_000).default(0) })
  .refine((p) => p.mrpPaise == null || p.mrpPaise === 0 || p.sellingPricePaise <= p.mrpPaise, {
    message: "Selling price cannot be more than MRP",
    path: ["sellingPricePaise"],
  });
export type CreateProductInput = z.input<typeof createProductSchema>;

export const updateProductSchema = productBase.partial().extend({ isActive: z.boolean().optional() });
export type UpdateProductInput = z.input<typeof updateProductSchema>;

export const listProductsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: z.string().max(64).optional(),
  stock: z.enum(["all", "in", "low", "out"]).default("all"),
  status: z.enum(["active", "archived", "all"]).default("active"),
  sort: z.enum(["name", "stock", "recent", "price"]).default("name"),
  cursor: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const createCategorySchema = z.object({ name: trimmed(60).min(1) });

export const importProductsSchema = z.object({
  /** Raw CSV text (header row required). */
  csv: z.string().min(1).max(1_000_000),
  dryRun: z.boolean().default(false),
});

export const sampleProductsSchema = z.object({ businessType: z.string().max(40).optional() });
