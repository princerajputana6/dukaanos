import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "@/server/db/client";
import { businesses, businessSettings, gstSettings } from "@/server/db/schema";
import { resolveFlags } from "@/server/lib/flags";
import { notFound } from "@/server/lib/errors";
import type { businessProfileSchema, businessSettingsSchema, gstSettingsSchema, onboardingStepSchema } from "@/schemas/business";
import { requirePermission, type ServiceContext } from "./context";
import { auditStmt, commit } from "./engine";

export async function getBusinessBundle(db: Db, env: Env, businessId: string) {
  const [business, settings, gst] = await Promise.all([
    db.select().from(businesses).where(eq(businesses.id, businessId)).get(),
    db.select().from(businessSettings).where(eq(businessSettings.businessId, businessId)).get(),
    db.select().from(gstSettings).where(eq(gstSettings.businessId, businessId)).get(),
  ]);
  if (!business || !settings || !gst) throw notFound("Business");
  return {
    business: {
      id: business.id,
      name: business.name,
      type: business.type,
      city: business.city,
      stateCode: business.stateCode,
      phone: business.phone,
      address: business.address,
      onboardingStep: business.onboardingStep,
      onboardedAt: business.onboardedAt,
    },
    settings: {
      pricesIncludeGst: settings.pricesIncludeGst,
      allowNegativeStock: settings.allowNegativeStock,
      defaultLowStockMilli: settings.defaultLowStockMilli,
      invoicePrefix: settings.invoicePrefix,
      language: settings.language,
      voiceProvider: settings.voiceProvider,
      aiEnabled: settings.aiEnabled,
      lowStockNotifications: settings.lowStockNotifications,
      dailySummaryNotifications: settings.dailySummaryNotifications,
      outstandingReminders: settings.outstandingReminders,
    },
    gst: {
      gstin: gst.gstin,
      legalName: gst.legalName,
      stateCode: gst.stateCode,
      registrationStatus: gst.registrationStatus,
    },
    flags: resolveFlags(env, settings.featureFlags),
  };
}
export type BusinessBundle = Awaited<ReturnType<typeof getBusinessBundle>>;

export async function getSettings(ctx: ServiceContext) {
  const row = await ctx.db.select().from(businessSettings).where(eq(businessSettings.businessId, ctx.businessId)).get();
  if (!row) throw notFound("Business settings");
  return row;
}

export async function getGst(ctx: ServiceContext) {
  const row = await ctx.db.select().from(gstSettings).where(eq(gstSettings.businessId, ctx.businessId)).get();
  if (!row) throw notFound("GST settings");
  return row;
}

export async function updateBusinessProfile(ctx: ServiceContext, input: z.output<typeof businessProfileSchema>) {
  requirePermission(ctx, "settings.manage");
  const before = await ctx.db.select().from(businesses).where(eq(businesses.id, ctx.businessId)).get();
  if (!before) throw notFound("Business");
  const patch = { ...input, updatedAt: ctx.now };
  await commit(ctx, [
    ctx.db.update(businesses).set(patch).where(eq(businesses.id, ctx.businessId)),
    auditStmt(ctx, {
      action: "BUSINESS_UPDATED",
      entityType: "business",
      entityId: ctx.businessId,
      summary: "Updated business profile",
      before: pick(before, Object.keys(input)),
      after: input,
    }),
  ], null);
  return { updated: true };
}

export async function updateBusinessSettings(ctx: ServiceContext, input: z.output<typeof businessSettingsSchema>) {
  requirePermission(ctx, "settings.manage");
  const before = await getSettings(ctx);
  await commit(ctx, [
    ctx.db.update(businessSettings).set({ ...input, updatedAt: ctx.now }).where(eq(businessSettings.businessId, ctx.businessId)),
    auditStmt(ctx, {
      action: "SETTINGS_UPDATED",
      entityType: "business_settings",
      entityId: ctx.businessId,
      summary: "Updated business settings",
      before: pick(before, Object.keys(input)),
      after: input,
    }),
  ], null);
  return { updated: true };
}

export async function updateGstSettings(ctx: ServiceContext, input: z.output<typeof gstSettingsSchema>) {
  requirePermission(ctx, "settings.manage");
  const before = await getGst(ctx);
  await commit(ctx, [
    ctx.db.update(gstSettings).set({ ...input, updatedAt: ctx.now }).where(eq(gstSettings.businessId, ctx.businessId)),
    auditStmt(ctx, {
      action: "GST_SETTINGS_UPDATED",
      entityType: "gst_settings",
      entityId: ctx.businessId,
      summary: "Updated GST settings",
      before: pick(before, Object.keys(input)),
      after: input,
    }),
  ], null);
  return { updated: true };
}

/** Onboarding progress. Completing the wizard stamps `onboarded_at`. */
export async function updateOnboarding(ctx: ServiceContext, input: z.output<typeof onboardingStepSchema>) {
  requirePermission(ctx, "settings.manage");
  const patch: Partial<typeof businesses.$inferInsert> = { onboardingStep: input.step, updatedAt: ctx.now };
  if (input.name) patch.name = input.name;
  if (input.type) patch.type = input.type;
  if (input.city !== undefined) patch.city = input.city;
  if (input.complete) patch.onboardedAt = ctx.now;
  await commit(ctx, [
    ctx.db.update(businesses).set(patch).where(eq(businesses.id, ctx.businessId)),
    ...(input.complete
      ? [auditStmt(ctx, { action: "ONBOARDING_COMPLETED", entityType: "business", entityId: ctx.businessId, summary: "Completed onboarding" })]
      : []),
  ], null);
  return { step: input.step, complete: Boolean(input.complete) };
}

function pick(obj: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}
