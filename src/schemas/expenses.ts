import { z } from "zod";
import { SETTLEMENT_METHODS } from "@/lib/domain";
import { idSchema, isoDateSchema, optionalText, trimmed } from "./common";

export const createExpenseSchema = z
  .object({
    amountPaise: z.number().int().positive("Amount must be more than zero").max(1_000_000_000),
    categoryId: idSchema.optional(),
    categoryName: trimmed(60).min(1).optional(),
    txnDate: isoDateSchema.optional(),
    paymentMethod: z.enum(SETTLEMENT_METHODS).default("CASH"),
    notes: optionalText(300),
  })
  .refine((v) => v.categoryId || v.categoryName, { message: "Choose a category", path: ["categoryId"] });
export type CreateExpenseInput = z.input<typeof createExpenseSchema>;

export const listExpensesSchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  categoryId: z.string().max(64).optional(),
  status: z.enum(["COMPLETED", "REVERSED", "all"]).default("COMPLETED"),
  cursor: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const createExpenseCategorySchema = z.object({ name: trimmed(60).min(1) });
