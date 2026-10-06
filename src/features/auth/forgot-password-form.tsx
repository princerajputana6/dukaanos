"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheckIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiPost, errorMessage } from "@/lib/api";
import { forgotPasswordSchema } from "@/schemas/auth";

type In = z.input<typeof forgotPasswordSchema>;

export function ForgotPasswordForm() {
  const [done, setDone] = useState<{ message: string; devResetLink?: string } | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<In>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { identifier: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      setDone(await apiPost("/auth/forgot-password", values));
    } catch (err) {
      setServerError(errorMessage(err));
    }
  });

  if (done) {
    return (
      <div className="space-y-6 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <MailCheckIcon className="size-7" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Check your inbox</h1>
          <p className="text-[15px] text-muted-foreground">{done.message}</p>
        </div>
        {done.devResetLink && (
          <p className="rounded-xl border border-dashed p-3 text-left text-xs break-all text-muted-foreground">
            <strong className="text-foreground">Development only:</strong>{" "}
            <a className="text-primary underline" href={done.devResetLink}>
              open reset link
            </a>
          </p>
        )}
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Back to log in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Forgot password?</h1>
        <p className="text-[15px] text-muted-foreground">Enter your mobile number or email and we&apos;ll help you reset it.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field id="identifier" label="Mobile number or email" error={form.formState.errors.identifier?.message}>
          <Input id="identifier" autoComplete="username" {...form.register("identifier")} />
        </Field>
        {serverError && (
          <p role="alert" className="rounded-xl bg-destructive-soft px-3.5 py-2.5 text-sm font-medium text-destructive">
            {serverError}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          Send reset link
        </Button>
      </form>
      <p className="text-center text-sm">
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
