import { z } from "zod";
import { BUSINESS_TYPE_VALUES } from "@/lib/domain";
import { emailSchema, mobileSchema, trimmed } from "./common";

export const passwordSchema = z.string().min(8, "Use at least 8 characters").max(128);

export const signupSchema = z.object({
  name: trimmed(80).min(2, "Enter your name"),
  mobile: mobileSchema,
  email: z.union([emailSchema, z.literal("").transform(() => null)]).nullish(),
  password: passwordSchema,
  businessName: trimmed(100).min(2, "Enter your business name"),
  businessType: z.enum(BUSINESS_TYPE_VALUES),
  city: trimmed(80).min(2, "Enter your city"),
});
export type SignupInput = z.input<typeof signupSchema>;

export const loginSchema = z.object({
  identifier: trimmed(200).min(3, "Enter your mobile number or email"),
  password: z.string().min(1, "Enter your password").max(128),
});
export type LoginInput = z.input<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  identifier: trimmed(200).min(3, "Enter your mobile number or email"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(100),
  password: passwordSchema,
});

export const switchBusinessSchema = z.object({ businessId: z.string().min(1).max(64) });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
