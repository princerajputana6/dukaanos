import { z } from "zod";
import { BUSINESS_TYPE_VALUES, LICENSE_PLAN_KEYS, LICENSE_STATUSES } from "@/lib/domain";
import { emailSchema, idSchema, isoDateSchema, mobileSchema, optionalMobileSchema, optionalText, stateCodeSchema, trimmed } from "./common";
import { passwordSchema } from "./auth";

const branchCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{1,12}$/, "Use up to 12 letters, digits or dashes")
  .optional();

/** Owner: add a branch to their own account. */
export const createBranchSchema = z.object({
  name: trimmed(100).min(2, "Enter the branch name"),
  branchCode: branchCodeSchema,
  city: optionalText(80),
  stateCode: stateCodeSchema,
  copyCatalogue: z.boolean().default(true),
});

// ─── Super admin ─────────────────────────────────────────────────────────────

export const agencySchema = z.object({
  name: trimmed(100).min(2, "Enter the agency name"),
  contactName: optionalText(80),
  phone: optionalMobileSchema,
  email: z.union([emailSchema, z.literal("").transform(() => null)]).nullish(),
  city: optionalText(80),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  notes: optionalText(500),
});

export const updateTenantSchema = z.object({
  name: trimmed(100).min(2).optional(),
  agencyId: idSchema.nullish(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  notes: optionalText(1000),
});

export const updateLicenseSchema = z.object({
  plan: z.enum(LICENSE_PLAN_KEYS).optional(),
  status: z.enum(LICENSE_STATUSES).optional(),
  maxBranches: z.number().int().min(1).max(1000).optional(),
  maxUsers: z.number().int().min(1).max(10000).optional(),
  validUntil: isoDateSchema.nullish(),
  note: optionalText(300),
});

export const updateShopSchema = z.object({
  name: trimmed(100).min(2).optional(),
  branchCode: branchCodeSchema,
  status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]).optional(),
});

const openingParty = z.object({
  name: trimmed(80).min(1),
  phone: optionalMobileSchema,
  openingBalancePaise: z.number().int().min(0).max(1_000_000_000).default(0),
});

/** Super admin: create a shop (new or existing tenant) and load its initial data. */
export const createShopSchema = z
  .object({
    tenant: z.discriminatedUnion("mode", [
      z.object({
        mode: z.literal("new"),
        name: trimmed(100).min(2, "Enter the account / company name"),
        agencyId: idSchema.nullish(),
        plan: z.enum(LICENSE_PLAN_KEYS).default("TRIAL"),
        validUntil: isoDateSchema.nullish(),
        maxBranches: z.number().int().min(1).max(1000).optional(),
        maxUsers: z.number().int().min(1).max(10000).optional(),
      }),
      z.object({ mode: z.literal("existing"), tenantId: idSchema }),
    ]),
    owner: z
      .discriminatedUnion("mode", [
        z.object({ mode: z.literal("new"), name: trimmed(80).min(2, "Enter the owner's name"), mobile: mobileSchema, email: z.union([emailSchema, z.literal("").transform(() => null)]).nullish(), password: passwordSchema }),
        z.object({ mode: z.literal("existing"), mobile: mobileSchema }),
      ])
      .optional(),
    shop: z.object({
      name: trimmed(100).min(2, "Enter the shop name"),
      type: z.enum(BUSINESS_TYPE_VALUES).default("grocery"),
      city: optionalText(80),
      stateCode: stateCodeSchema,
      address: optionalText(300),
      branchCode: branchCodeSchema,
      gstin: z
        .string()
        .trim()
        .toUpperCase()
        .transform((v) => (v === "" ? null : v))
        .refine((v) => v === null || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v), "Enter a valid GSTIN")
        .nullish(),
    }),
    initialData: z
      .object({
        sampleProducts: z.boolean().default(true),
        copyCatalogueFromShopId: idSchema.nullish(),
        productsCsv: z.string().max(1_000_000).nullish(),
        customers: z.array(openingParty).max(200).default([]),
        suppliers: z.array(openingParty).max(100).default([]),
      })
      .default({ sampleProducts: true, customers: [], suppliers: [] }),
  })
  .refine((v) => v.tenant.mode === "existing" || !!v.owner, { message: "Owner details are required for a new account", path: ["owner"] });
export type CreateShopInput = z.input<typeof createShopSchema>;

export const adminListSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.string().max(20).optional(),
  agencyId: z.string().max(64).optional(),
  tenantId: z.string().max(64).optional(),
  cursor: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const adminUserUpdateSchema = z.object({
  isActive: z.boolean().optional(),
  platformRole: z.enum(["SUPER_ADMIN"]).nullable().optional(),
});

export const adminResetPasswordSchema = z.object({ password: passwordSchema });

/** Super-admin: set a shop's AI budget. Rupees/percent on the wire; service stores micros/bp. */
export const aiBudgetSchema = z.object({
  monthlyCapRupees: z.number().min(0).max(10_000_000).nullable(),
  killSwitch: z.boolean().default(false),
  alertPct: z.number().int().min(1).max(100).default(80),
});
