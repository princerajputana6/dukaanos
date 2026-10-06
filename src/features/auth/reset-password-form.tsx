"use client";
import { CheckCircle2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Field } from "@/components/shared/field";
import { PasswordInput } from "@/components/shared/password-input";
import { Button } from "@/components/ui/button";
import { apiPost, errorMessage } from "@/lib/api";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Invalid link</h1>
        <p className="text-muted-foreground">This reset link is missing its token.</p>
        <Button asChild className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-6 text-center">
        <CheckCircle2Icon className="mx-auto size-12 text-success" />
        <h1 className="text-2xl font-semibold tracking-tight">Password updated</h1>
        <p className="text-muted-foreground">You can now log in with your new password.</p>
        <Button asChild size="lg" className="w-full">
          <Link href="/login">Log in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (password.length < 8) return setError("Use at least 8 characters.");
        if (password !== confirm) return setError("Passwords don't match.");
        setBusy(true);
        try {
          await apiPost("/auth/reset-password", { token, password });
          setDone(true);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
        <p className="text-[15px] text-muted-foreground">You&apos;ll be logged out of all devices.</p>
      </div>
      <Field id="password" label="New password">
        <PasswordInput id="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field id="confirm" label="Confirm password">
        <PasswordInput id="confirm" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      {error && (
        <p role="alert" className="rounded-xl bg-destructive-soft px-3.5 py-2.5 text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        Update password
      </Button>
    </form>
  );
}
