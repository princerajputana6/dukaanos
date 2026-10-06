import { z } from "zod";
import { AUDIT_SOURCES, PERMISSIONS } from "@/lib/domain";
import { idSchema, isoDateSchema, mobileSchema, trimmed } from "./common";
import { passwordSchema } from "./auth";

export const listAuditSchema = z.object({
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(64).optional(),
  userId: z.string().max(64).optional(),
  source: z.enum(AUDIT_SOURCES).optional(),
  action: z.string().max(60).optional(),
  q: z.string().trim().max(100).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  cursor: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export const addMemberSchema = z.object({
  name: trimmed(80).min(2, "Enter a name"),
  mobile: mobileSchema,
  roleId: idSchema,
  /** Temporary password the owner shares with the staff member (only for new accounts). */
  password: passwordSchema.optional(),
});

export const updateMemberSchema = z.object({ roleId: idSchema.optional(), isActive: z.boolean().optional() });

export const resetMemberPasswordSchema = z.object({ password: passwordSchema });

export const roleSchema = z.object({
  name: trimmed(40).min(2),
  permissions: z.array(z.enum(PERMISSIONS)).min(1, "Choose at least one permission"),
});

export const searchSchema = z.object({ q: z.string().trim().min(1).max(100) });
