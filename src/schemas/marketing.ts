import { z } from "zod";
import { BUSINESS_TYPE_VALUES } from "@/lib/domain";
import { emailSchema, mobileSchema, optionalText, trimmed } from "./common";

export const OUTLET_OPTIONS = ["1", "2-5", "6-20", "20+"] as const;
export const LEAD_STATUSES = ["NEW", "CONTACTED", "CONVERTED", "CLOSED"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Public "Request a quote" form. `website` is a honeypot: humans never see or fill it. */
export const quoteRequestSchema = z.object({
  name: trimmed(80).min(2, "Enter your name"),
  businessName: trimmed(100).min(2, "Enter your shop or business name"),
  mobile: mobileSchema,
  email: z.union([emailSchema, z.literal("").transform(() => null)]).nullish(),
  city: optionalText(80),
  businessType: z.enum(BUSINESS_TYPE_VALUES).nullish(),
  outlets: z.enum(OUTLET_OPTIONS).default("1"),
  message: optionalText(1000),
  consent: z.literal(true, { message: "Please agree so we can contact you" }),
  website: z.string().max(200).optional(),
  source: z.string().trim().max(60).optional(),
});
export type QuoteRequestInput = z.input<typeof quoteRequestSchema>;

export const updateLeadSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  adminNotes: optionalText(2000),
});
