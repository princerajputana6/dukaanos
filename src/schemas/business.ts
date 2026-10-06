import { z } from "zod";
import { BUSINESS_TYPE_VALUES, FEATURE_FLAGS, GST_REGISTRATION } from "@/lib/domain";
import { optionalMobileSchema, optionalText, stateCodeSchema, trimmed } from "./common";

export const businessProfileSchema = z
  .object({
    name: trimmed(100).min(2),
    type: z.enum(BUSINESS_TYPE_VALUES),
    city: optionalText(80),
    stateCode: stateCodeSchema,
    phone: optionalMobileSchema,
    address: optionalText(300),
  })
  .partial();

export const businessSettingsSchema = z
  .object({
    pricesIncludeGst: z.boolean(),
    allowNegativeStock: z.boolean(),
    defaultLowStockMilli: z.number().int().min(0).max(1_000_000_000),
    invoicePrefix: z.string().trim().regex(/^[A-Z0-9]{1,8}$/, "Use 1–8 capital letters or digits"),
    language: z.enum(["hinglish", "english", "hindi"]),
    voiceProvider: z.enum(["auto", "browser", "server"]),
    aiEnabled: z.boolean(),
    lowStockNotifications: z.boolean(),
    dailySummaryNotifications: z.boolean(),
    outstandingReminders: z.boolean(),
    featureFlags: z.record(z.enum(FEATURE_FLAGS), z.boolean()),
  })
  .partial();

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const gstSettingsSchema = z
  .object({
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .transform((v) => (v === "" ? null : v))
      .refine((v) => v === null || GSTIN_RE.test(v), "Enter a valid 15-character GSTIN")
      .nullish(),
    legalName: optionalText(150),
    stateCode: stateCodeSchema,
    registrationStatus: z.enum(GST_REGISTRATION),
  })
  .partial()
  .refine((v) => !v.gstin || !v.stateCode || v.gstin.slice(0, 2) === v.stateCode, {
    message: "GSTIN state code does not match the selected state",
    path: ["gstin"],
  });

export const onboardingStepSchema = z.object({
  step: z.number().int().min(1).max(5),
  name: trimmed(100).min(2).optional(),
  type: z.enum(BUSINESS_TYPE_VALUES).optional(),
  city: optionalText(80),
  complete: z.boolean().optional(),
});
