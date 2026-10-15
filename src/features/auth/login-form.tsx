"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Field } from "@/components/shared/field";
import { PasswordInput } from "@/components/shared/password-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiPost, errorMessage } from "@/lib/api";
import { loginSchema, type LoginInput } from "@/schemas/auth";

export function LoginForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { identifier: "", password: "" } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const res = await apiPost<{ businessId: string | null; platformRole: string | null }>("/auth/login", values);
      const next = new URLSearchParams(window.location.search).get("next");
      const home = res.platformRole === "SUPER_ADMIN" && !res.businessId ? "/admin" : res.businessId ? "/dashboard" : "/onboarding";
      window.location.assign(next && next.startsWith("/") && !next.startsWith("//") ? next : home);
    } catch (err) {
      setServerError(errorMessage(err));
    }
  });

  return (
    <div className="space-y-7">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-[15px] text-muted-foreground">Log in to your shop.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field id="identifier" label="Mobile number or email" error={errors.identifier?.message}>
          <Input
            id="identifier"
            inputMode="email"
            autoComplete="username"
            placeholder="98765 43210"
            aria-invalid={!!errors.identifier}
            {...form.register("identifier")}
          />
        </Field>
        <Field id="password" label="Password" error={errors.password?.message}>
          <PasswordInput id="password" autoComplete="current-password" aria-invalid={!!errors.password} {...form.register("password")} />
        </Field>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-[13px] font-medium text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        {serverError && (
          <p role="alert" className="rounded-xl bg-destructive-soft px-3.5 py-2.5 text-sm font-medium text-destructive">
            {serverError}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Log in
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        New to Suvakta?{" "}
        <Link href="/signup" className="font-semibold text-primary hover:underline">
          Create your shop
        </Link>
      </p>
    </div>
  );
}
