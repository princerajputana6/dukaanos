import { FEATURE_FLAGS, type FeatureFlag, type FeatureFlags } from "@/lib/domain";
import { AppError } from "./errors";

/** Env defaults (FLAG_*), overridden per business by business_settings.feature_flags. */
export function resolveFlags(env: Partial<Env>, overrides?: Partial<Record<string, boolean>> | null): FeatureFlags {
  const out = {} as FeatureFlags;
  for (const flag of FEATURE_FLAGS) {
    const envValue = (env as Record<string, unknown>)[`FLAG_${flag}`];
    const base = envValue === undefined ? true : String(envValue) === "true";
    const override = overrides?.[flag];
    out[flag] = typeof override === "boolean" ? base && override : base;
  }
  return out;
}

export function requireFlag(flags: FeatureFlags, flag: FeatureFlag): void {
  if (!flags[flag]) throw new AppError("FEATURE_DISABLED", "This feature is turned off for your business.");
}
