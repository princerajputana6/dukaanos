import { businessProfileSchema, businessSettingsSchema, gstSettingsSchema, onboardingStepSchema } from "@/schemas/business";
import * as biz from "@/server/services/business";
import { body, ok } from "../respond";
import { bizRouter, requirePerm } from "../middleware";

export const businessRoutes = bizRouter()
  .get("/", async (c) => ok(c, await biz.getBusinessBundle(c.get("db"), c.env, c.get("ctx").businessId)))
  .patch("/profile", requirePerm("settings.manage"), async (c) => ok(c, await biz.updateBusinessProfile(c.get("ctx"), await body(c, businessProfileSchema))))
  .patch("/settings", requirePerm("settings.manage"), async (c) => ok(c, await biz.updateBusinessSettings(c.get("ctx"), await body(c, businessSettingsSchema))))
  .patch("/gst", requirePerm("settings.manage"), async (c) => ok(c, await biz.updateGstSettings(c.get("ctx"), await body(c, gstSettingsSchema))))
  .post("/onboarding", requirePerm("settings.manage"), async (c) => ok(c, await biz.updateOnboarding(c.get("ctx"), await body(c, onboardingStepSchema))));
