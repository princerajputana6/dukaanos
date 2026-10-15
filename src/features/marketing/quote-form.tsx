"use client";
import { CheckCircle2Icon, SendIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { apiPost, errorMessage } from "@/lib/api";
import { BUSINESS_TYPES } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { OUTLET_OPTIONS, quoteRequestSchema } from "@/schemas/marketing";

type Errors = Partial<Record<string, string>>;

/** "Request a quote" — validated with the same schema the server uses. */
export function QuoteForm({ source = "website", className }: { source?: string; className?: string }) {
  const [outlets, setOutlets] = React.useState<(typeof OUTLET_OPTIONS)[number]>("1");
  const [errors, setErrors] = React.useState<Errors>({});
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const raw = {
      name: String(f.get("name") ?? ""),
      businessName: String(f.get("businessName") ?? ""),
      mobile: String(f.get("mobile") ?? ""),
      email: String(f.get("email") ?? ""),
      city: String(f.get("city") ?? ""),
      businessType: (String(f.get("businessType") ?? "") || null) as never,
      outlets,
      message: String(f.get("message") ?? ""),
      consent: f.get("consent") === "on",
      website: String(f.get("website") ?? ""),
      source,
    };
    const parsed = quoteRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setServerError(null);
    setBusy(true);
    try {
      await apiPost("/public/quote", raw);
      setDone(true);
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div role="status" className={cn("flex flex-col items-center gap-3 rounded-3xl border bg-card p-8 text-center shadow-lift", className)}>
        <CheckCircle2Icon className="size-12 text-success" aria-hidden="true" />
        <h3 className="text-xl font-semibold">Dhanyavaad! We’ve got your request.</h3>
        <p className="max-w-sm text-[14.5px] text-muted-foreground">Our team will call you within one working day to understand your shop and share a quote.</p>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={onSubmit} className={cn("space-y-4 rounded-3xl border bg-card p-5 shadow-lift sm:p-7", className)} aria-label="Request a quote">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="q-name" label="Your name" error={errors.name}>
          <Input id="q-name" name="name" autoComplete="name" placeholder="Ramesh Kumar" aria-invalid={!!errors.name} />
        </Field>
        <Field id="q-business" label="Shop / business name" error={errors.businessName}>
          <Input id="q-business" name="businessName" autoComplete="organization" placeholder="Kumar Kirana Store" aria-invalid={!!errors.businessName} />
        </Field>
        <Field id="q-mobile" label="Mobile number" error={errors.mobile}>
          <Input id="q-mobile" name="mobile" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" aria-invalid={!!errors.mobile} />
        </Field>
        <Field id="q-email" label="Email" optional error={errors.email}>
          <Input id="q-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" aria-invalid={!!errors.email} />
        </Field>
        <Field id="q-city" label="City" optional error={errors.city}>
          <Input id="q-city" name="city" autoComplete="address-level2" placeholder="Jaipur" />
        </Field>
        <Field id="q-type" label="Type of business" optional>
          <NativeSelect id="q-type" name="businessType" defaultValue="">
            <option value="">Select…</option>
            {BUSINESS_TYPES.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[13.5px] font-medium">How many shops / branches?</legend>
        <div className="grid grid-cols-4 gap-2" role="radiogroup">
          {OUTLET_OPTIONS.map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={outlets === o}
              onClick={() => setOutlets(o)}
              className={cn("h-11 rounded-xl border text-[14px] font-semibold transition-colors", outlets === o ? "border-primary bg-primary-soft text-primary-soft-foreground" : "bg-background hover:bg-accent")}
            >
              {o}
            </button>
          ))}
        </div>
      </fieldset>
      <Field id="q-message" label="Anything we should know?" optional>
        <Textarea id="q-message" name="message" rows={3} placeholder="e.g. I run a kirana with 2 staff and want udhaar tracking…" />
      </Field>
      {/* Honeypot for bots — hidden from people and screen readers. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="q-website">Website</label>
        <input id="q-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div>
        <label className="flex items-start gap-2.5 text-[13.5px] leading-snug text-muted-foreground">
          <input type="checkbox" name="consent" className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" aria-invalid={!!errors.consent} />
          <span>
            I agree to be contacted by Suvakta about my request by call, WhatsApp or email, and I accept the{" "}
            <Link href="/privacy" className="font-medium text-primary hover:underline">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        {errors.consent && <p className="mt-1 text-[12.5px] text-destructive">{errors.consent}</p>}
      </div>
      {serverError && (
        <p role="alert" className="rounded-xl bg-destructive-soft px-3 py-2 text-[13.5px] text-destructive">
          {serverError}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        <SendIcon /> Request my quote
      </Button>
      <p className="text-center text-[12.5px] text-muted-foreground">No payment needed. We usually reply within one working day.</p>
    </form>
  );
}
