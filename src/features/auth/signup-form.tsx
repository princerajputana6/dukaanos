"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Field } from "@/components/shared/field";
import { PasswordInput } from "@/components/shared/password-input";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { BUSINESS_TYPES } from "@/lib/domain";
import { signupSchema } from "@/schemas/auth";
import { Turnstile, useTurnstileSiteKey } from "./turnstile";

type In = z.input<typeof signupSchema>;
type Out = z.output<typeof signupSchema>;

export function SignupForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const siteKey = useTurnstileSiteKey();
  const [captcha, setCaptcha] = useState<string | null>(null);
  const onToken = useCallback((t: string | null) => setCaptcha(t), []);
  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", mobile: "", email: "", password: "", businessName: "", businessType: "grocery", city: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await api("/auth/signup", { method: "POST", body: values, headers: captcha ? { "cf-turnstile-token": captcha } : undefined });
      window.location.assign("/onboarding");
    } catch (err) {
      setServerError(errorMessage(err));
    }
  });

  return (
    <div className="space-y-7">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Create your shop</h1>
        <p className="text-[15px] text-muted-foreground">Takes less than a minute. No card needed.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field id="name" label="Your name" error={errors.name?.message}>
          <Input id="name" autoComplete="name" placeholder="Prince Sharma" aria-invalid={!!errors.name} {...form.register("name")} />
        </Field>
        <Field id="mobile" label="Mobile number" error={errors.mobile?.message} hint="You'll log in with this number.">
          <div className="flex">
            <span className="inline-flex items-center rounded-l-xl border border-r-0 border-input bg-muted px-3 text-[15px] text-muted-foreground">+91</span>
            <Input
              id="mobile"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="98765 43210"
              className="rounded-l-none"
              aria-invalid={!!errors.mobile}
              {...form.register("mobile")}
            />
          </div>
        </Field>
        <Field id="email" label="Email" optional error={errors.email?.message} hint="Used for password recovery.">
          <Input id="email" type="email" autoComplete="email" placeholder="you@example.com" aria-invalid={!!errors.email} {...form.register("email")} />
        </Field>
        <Field id="password" label="Password" error={errors.password?.message} hint="At least 8 characters.">
          <PasswordInput id="password" autoComplete="new-password" aria-invalid={!!errors.password} {...form.register("password")} />
        </Field>

        <div className="pt-2">
          <p className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Your business</p>
          <div className="space-y-4">
            <Field id="businessName" label="Business name" error={errors.businessName?.message}>
              <Input id="businessName" placeholder="Sharma General Store" aria-invalid={!!errors.businessName} {...form.register("businessName")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="businessType" label="Type" error={errors.businessType?.message}>
                <NativeSelect id="businessType" {...form.register("businessType")}>
                  {BUSINESS_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="city" label="City" error={errors.city?.message}>
                <Input id="city" autoComplete="address-level2" placeholder="Jaipur" aria-invalid={!!errors.city} {...form.register("city")} />
              </Field>
            </div>
          </div>
        </div>

        {siteKey && <Turnstile siteKey={siteKey} onToken={onToken} />}
        {serverError && (
          <p role="alert" className="rounded-xl bg-destructive-soft px-3.5 py-2.5 text-sm font-medium text-destructive">
            {serverError}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting} disabled={!!siteKey && !captcha}>
          Create account
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
