"use client";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, FileUpIcon, MicIcon, PackagePlusIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { Logo } from "@/components/brand/logo";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { ImportDialog, SampleButton } from "@/features/products/products-view";
import { useSession } from "@/features/session/session-context";
import { api, apiGet, errorMessage } from "@/lib/api";
import type { ProductList } from "@/lib/api-types";
import { BUSINESS_TYPES, INDIAN_STATES, type BusinessType } from "@/lib/domain";
import { cn } from "@/lib/utils";

const STEPS = ["Your business", "How you work", "First products", "Your AI assistant"];

export function OnboardingWizard() {
  const me = useSession();
  const [step, setStep] = React.useState(Math.min(Math.max(me.business.onboardingStep, 1), 4));
  const [name, setName] = React.useState(me.business.name);
  const [city, setCity] = React.useState(me.business.city ?? "");
  const [stateCode, setStateCode] = React.useState(me.business.stateCode ?? "");
  const [type, setType] = React.useState<BusinessType>((me.business.type as BusinessType) ?? "grocery");
  const [busy, setBusy] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const products = useQuery({ queryKey: ["products", "onboarding"], queryFn: ({ signal }) => apiGet<ProductList>("/products?limit=5", signal), enabled: step === 3 });

  const go = async (next: number, patch: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      if (Object.keys(patch).length || next > step) await api("/business/onboarding", { method: "POST", body: { step: Math.min(next, 5), ...patch } });
      setStep(next);
      window.scrollTo({ top: 0 });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      await api("/business/onboarding", { method: "POST", body: { step: 5, complete: true } });
      window.location.assign("/dashboard");
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  };

  const productCount = products.data?.items.length ?? 0;

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 py-6 sm:py-10">
      <div className="mb-8 flex items-center justify-between">
        <Logo />
        <span className="text-[13px] font-medium text-muted-foreground">
          Step {step} of 4
        </span>
      </div>
      <ol className="mb-8 grid grid-cols-4 gap-1.5" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={step === i + 1 ? "step" : undefined} className={cn("h-1.5 rounded-full", i + 1 <= step ? "bg-primary" : "bg-muted")}>
            <span className="sr-only">{s}</span>
          </li>
        ))}
      </ol>

      <div className="flex-1 animate-rise" key={step}>
        {step === 1 && (
          <section className="space-y-6">
            <div>
              <h1 className="text-[26px] leading-tight font-semibold tracking-tight">Tell us about your business</h1>
              <p className="mt-1 text-muted-foreground">This appears on your bills.</p>
            </div>
            <Field id="o-name" label="Business name">
              <Input id="o-name" value={name} onChange={(e) => setName(e.target.value)} className="h-12 text-[16px]" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="o-city" label="City">
                <Input id="o-city" value={city} onChange={(e) => setCity(e.target.value)} />
              </Field>
              <Field id="o-state" label="State" hint="For GST">
                <NativeSelect id="o-state" value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
                  <option value="">—</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Button
              size="xl"
              className="w-full"
              loading={busy}
              disabled={name.trim().length < 2}
              onClick={async () => {
                if (stateCode) await api("/business/profile", { method: "PATCH", body: { stateCode } }).catch(() => undefined);
                await go(2, { name: name.trim(), city: city.trim() || null });
              }}
            >
              Continue <ArrowRightIcon />
            </Button>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-6">
            <div>
              <h1 className="text-[26px] leading-tight font-semibold tracking-tight">How do you run your business?</h1>
              <p className="mt-1 text-muted-foreground">We&apos;ll suggest the right starter products.</p>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3" role="radiogroup" aria-label="Business type">
              {BUSINESS_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={type === t.value}
                  onClick={() => setType(t.value)}
                  className={cn(
                    "flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border bg-card p-3 text-center transition-colors",
                    type === t.value ? "border-primary bg-primary-soft ring-2 ring-primary/20" : "hover:bg-accent",
                  )}
                >
                  <span className="text-2xl" aria-hidden="true">
                    {t.emoji}
                  </span>
                  <span className="text-[13.5px] font-semibold">{t.label}</span>
                </button>
              ))}
            </div>
            <Nav onBack={() => setStep(1)} onNext={() => go(3, { type })} busy={busy} />
          </section>
        )}

        {step === 3 && (
          <section className="space-y-6">
            <div>
              <h1 className="text-[26px] leading-tight font-semibold tracking-tight">Add your first products</h1>
              <p className="mt-1 text-muted-foreground">Start with a few — you can add more any time, even by voice.</p>
            </div>
            <div className="grid gap-3">
              <div className="rounded-2xl border bg-card p-4">
                <p className="flex items-center gap-2 font-semibold">
                  <SparklesIcon className="size-4 text-primary" aria-hidden="true" /> Quickest: sample products
                </p>
                <p className="mb-3 text-[13.5px] text-muted-foreground">Common items for your type of shop, with typical prices you can edit.</p>
                <SampleButton onDone={() => void products.refetch()} />
              </div>
              <div className="rounded-2xl border bg-card p-4">
                <p className="flex items-center gap-2 font-semibold">
                  <FileUpIcon className="size-4 text-primary" aria-hidden="true" /> Bulk upload from Excel (CSV)
                </p>
                <p className="mb-3 text-[13.5px] text-muted-foreground">Have a product list? Upload up to 500 at once.</p>
                <Button variant="outline" onClick={() => setImportOpen(true)}>
                  Upload CSV
                </Button>
              </div>
              <div className="rounded-2xl border bg-card p-4">
                <p className="flex items-center gap-2 font-semibold">
                  <PackagePlusIcon className="size-4 text-primary" aria-hidden="true" /> Add one by one
                </p>
                <p className="mb-3 text-[13.5px] text-muted-foreground">Opens in a new tab so you can come back here.</p>
                <Button variant="outline" asChild>
                  <Link href="/products/new" target="_blank">
                    Add a product
                  </Link>
                </Button>
              </div>
            </div>
            <p role="status" className="text-center text-[14px]">
              {productCount > 0 ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-success">
                  <CheckIcon className="size-4" /> You have products — great!
                </span>
              ) : (
                <span className="text-muted-foreground">No products yet. You can also skip this step.</span>
              )}
            </p>
            <Nav onBack={() => setStep(2)} onNext={() => go(4)} busy={busy} nextLabel={productCount ? "Continue" : "Skip for now"} />
            <ImportDialog open={importOpen} onOpenChange={setImportOpen} onDone={() => void products.refetch()} />
          </section>
        )}

        {step === 4 && (
          <section className="space-y-6 text-center">
            <div className="mx-auto flex size-24 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lift">
              <MicIcon className="size-11" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-[26px] leading-tight font-semibold tracking-tight">Meet your AI assistant</h1>
              <p className="mx-auto mt-2 max-w-sm text-[15.5px] text-muted-foreground">You can simply speak to DukaanOS — in Hindi, English or Hinglish. It shows you exactly what it understood, and saves only after you confirm.</p>
            </div>
            <ul className="mx-auto max-w-sm space-y-2 text-left">
              {["Aaj 10 Coke biki", "Ramesh ka ₹500 payment aaya", "Coke kitni bachi hai?", "Kaunsa product low hai?"].map((x) => (
                <li key={x} className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-[15px]">
                  <MicIcon className="size-4 text-primary" aria-hidden="true" /> “{x}”
                </li>
              ))}
            </ul>
            <p className="text-[13px] text-muted-foreground">Tap the green mic button on any screen to start.</p>
            <Button size="xl" className="w-full" onClick={finish} loading={busy}>
              Start using DukaanOS <ArrowRightIcon />
            </Button>
            <button type="button" className="text-[13px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => setStep(3)}>
              Back
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

function Nav({ onBack, onNext, busy, nextLabel = "Continue" }: { onBack: () => void; onNext: () => void; busy: boolean; nextLabel?: string }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-2">
      <Button variant="outline" size="xl" onClick={onBack} aria-label="Back">
        <ArrowLeftIcon />
      </Button>
      <Button size="xl" onClick={onNext} loading={busy}>
        {nextLabel} <ArrowRightIcon />
      </Button>
    </div>
  );
}
