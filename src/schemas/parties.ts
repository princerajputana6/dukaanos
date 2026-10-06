import { z } from "zod";
import { SETTLEMENT_METHODS } from "@/lib/domain";
import { emailSchema, isoDateSchema, optionalMobileSchema, optionalText, stateCodeSchema, trimmed } from "./common";

export const createCustomerSchema = z.object({
  name: trimmed(80).min(1, "Enter a name"),
  phone: optionalMobileSchema,
  email: z.union([emailSchema, z.literal("").transform(() => null)]).nullish(),
  address: optionalText(300),
  stateCode: stateCodeSchema,
  notes: optionalText(500),
  /** Existing udhaar to carry over when moving from a paper khata. */
  openingBalancePaise: z.number().int().min(0).max(1_000_000_000).default(0),
});
export const updateCustomerSchema = createCustomerSchema.omit({ openingBalancePaise: true }).partial().extend({ isActive: z.boolean().optional() });

export const createSupplierSchema = z.object({
  name: trimmed(80).min(1, "Enter a name"),
  phone: optionalMobileSchema,
  company: optionalText(120),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => (v === "" ? null : v))
    .refine((v) => v === null || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v), "Enter a valid GSTIN")
    .nullish(),
  address: optionalText(300),
  stateCode: stateCodeSchema,
  notes: optionalText(500),
  openingBalancePaise: z.number().int().min(0).max(1_000_000_000).default(0),
});
export const updateSupplierSchema = createSupplierSchema.omit({ openingBalancePaise: true }).partial().extend({ isActive: z.boolean().optional() });

export const listPartiesSchema = z.object({
  q: z.string().trim().max(100).optional(),
  filter: z.enum(["all", "outstanding"]).default("all"),
  sort: z.enum(["name", "balance", "recent"]).default("recent"),
  status: z.enum(["active", "archived"]).default("active"),
  cursor: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Money received from a customer / paid to a supplier. */
export const partyPaymentSchema = z.object({
  amountPaise: z.number().int().positive("Amount must be more than zero").max(1_000_000_000),
  method: z.enum(SETTLEMENT_METHODS).default("CASH"),
  note: optionalText(200),
  txnDate: isoDateSchema.optional(),
});

/** Manual udhaar ("Ramesh ka 850 udhaar likh do"). */
export const customerCreditSchema = z.object({
  amountPaise: z.number().int().positive("Amount must be more than zero").max(1_000_000_000),
  note: optionalText(200),
  txnDate: isoDateSchema.optional(),
});

export const ledgerAdjustmentSchema = z.object({
  /** Signed: positive increases what is owed, negative decreases it. */
  amountPaise: z
    .number()
    .int()
    .min(-1_000_000_000)
    .max(1_000_000_000)
    .refine((v) => v !== 0, "Amount cannot be zero"),
  note: trimmed(200).min(3, "Please add a reason for the adjustment"),
  txnDate: isoDateSchema.optional(),
});

export const reverseSchema = z.object({ reason: trimmed(200).min(3, "Please add a reason").optional() });
