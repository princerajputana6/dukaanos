"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, StoreIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Field } from "@/components/shared/field";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, ListSkeleton } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { Switch } from "@/components/ui/switch";
import { LicenseBadge, ValidUntil } from "@/features/admin/badges";
import { api, apiGet, apiPost, errorMessage } from "@/lib/api";
import type { BranchList } from "@/lib/api-types";
import { INDIAN_STATES } from "@/lib/domain";

interface BranchBilling {
  subscriptions: { id: string; status: string; amountPaise: number; currentPeriodEnd: number | null; branchBusinessId: string | null; createdAt: number }[];
  billingEnabled: boolean;
  pricePaise: number;
}

const PAID_ACTIVE = (s: { status: string }) => s.status === "ACTIVE" || s.status === "AUTHENTICATED";
const rupees = (paise: number) => Math.round(paise / 100);

export function BranchesSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["branches"], queryFn: ({ signal }) => apiGet<BranchList>("/branches", signal) });
  const billing = useQuery({ queryKey: ["branch-billing"], queryFn: ({ signal }) => apiGet<BranchBilling>("/billing/subscriptions", signal) });
  const [adding, setAdding] = React.useState(false);
  const [buying, setBuying] = React.useState(false);
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <ListSkeleton rows={3} />;
  const d = q.data;
  const activePaid = (billing.data?.subscriptions ?? []).filter(PAID_ACTIVE).length;
  const baseMax = d.license?.maxBranches ?? 0;
  const effectiveMax = baseMax + activePaid;
  const atLimit = !!d.license && d.usedBranches >= effectiveMax;
  const billingEnabled = billing.data?.billingEnabled ?? false;
  const pricePaise = billing.data?.pricePaise ?? 0;

  async function buyBranch() {
    setBuying(true);
    const t = toast.loading("Opening secure payment…");
    try {
      const r = await apiPost<{ subscriptionId: string; keyId: string; amountPaise: number }>("/billing/branch/subscribe", {});
      const Razorpay = await loadRazorpay();
      await new Promise<void>((resolve, reject) => {
        const rzp = new Razorpay({
          key: r.keyId,
          subscription_id: r.subscriptionId,
          name: "Suvakta",
          description: "Extra branch — monthly subscription",
          theme: { color: "#2f54d9" },
          handler: () => resolve(),
          modal: { ondismiss: () => reject(new Error("Payment was cancelled.")) },
        });
        rzp.open();
      });
      toast.loading("Confirming payment…", { id: t });
      let unlocked = false;
      for (let i = 0; i < 20 && !unlocked; i++) {
        await new Promise((res) => setTimeout(res, 1500));
        const b = await apiGet<BranchBilling>("/billing/subscriptions");
        unlocked = b.subscriptions.some(PAID_ACTIVE) && b.subscriptions.filter(PAID_ACTIVE).length > activePaid;
      }
      await qc.invalidateQueries();
      toast.success(unlocked ? "Branch unlocked — add its details." : "Payment received. Unlocking may take a moment.", { id: t });
      if (unlocked) setAdding(true);
    } catch (err) {
      toast.error(errorMessage(err), { id: t });
    } finally {
      setBuying(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Branches"
        description="Each branch has its own stock, sales, khata and staff."
        back={{ href: "/settings", label: "Settings" }}
        actions={
          d.tenant.isOwner &&
          (atLimit ? (
            <Button onClick={() => void buyBranch()} loading={buying} disabled={!billingEnabled}>
              <PlusIcon /> Add a branch{pricePaise ? ` · ₹${rupees(pricePaise)}/mo` : ""}
            </Button>
          ) : (
            <Button onClick={() => setAdding(true)}>
              <PlusIcon /> Add branch
            </Button>
          ))
        }
      />
      {d.license && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Your plan</CardTitle>
            <span className="flex gap-1.5">
              <Badge variant="outline">{d.license.planLabel}</Badge>
              <LicenseBadge status={d.license.status} />
            </span>
          </CardHeader>
          <CardContent className="space-y-1 text-[14px]">
            <p>
              Branches: <strong>{d.usedBranches}</strong> of {effectiveMax}
              {activePaid > 0 ? ` (${baseMax} on plan + ${activePaid} paid)` : ""} · Users: up to {d.license.maxUsers}
            </p>
            <p className="text-muted-foreground">
              <ValidUntil date={d.license.validUntil} />
            </p>
            {atLimit &&
              (billingEnabled ? (
                <p className="text-[13px] text-muted-foreground">
                  Add another branch for <strong>₹{rupees(pricePaise)}/month</strong>, billed automatically by UPI AutoPay or card. If a payment fails, that branch becomes read-only until it resumes — your data is never deleted.
                </p>
              ) : (
                <p className="text-[13px] text-warning-foreground">You&apos;ve used all branches on your plan. Contact Suvakta support to add more.</p>
              ))}
          </CardContent>
        </Card>
      )}
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        {d.branches.map((b) => (
          <li key={b.id} className="flex items-center gap-3 px-4 py-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <StoreIcon className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5 text-[14.5px] font-semibold">
                {b.name} {b.isCurrent && <Badge>Current</Badge>} {b.status !== "ACTIVE" && <Badge variant="danger">{b.status.toLowerCase()}</Badge>}
              </span>
              <span className="block text-[12.5px] text-muted-foreground">
                {b.branchCode ?? "MAIN"} · {b.city ?? "—"} · {b.products} products · today <Money paise={b.salesTodayPaise} compact />
              </span>
            </span>
            {!b.isCurrent && b.isMember && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await apiPost("/auth/switch-business", { businessId: b.id });
                  window.location.assign("/dashboard");
                }}
              >
                Open
              </Button>
            )}
          </li>
        ))}
      </ul>
      <AddBranch
        open={adding}
        onOpenChange={setAdding}
        onDone={async () => {
          await qc.invalidateQueries();
          toast.success("Branch added");
        }}
      />
    </div>
  );
}

type RazorpayCtor = new (opts: Record<string, unknown>) => { open: () => void };

/** Loads Razorpay Checkout on demand (external script; allowed by our CSP). */
function loadRazorpay(): Promise<RazorpayCtor> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { Razorpay?: RazorpayCtor };
    if (w.Razorpay) return resolve(w.Razorpay);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error("Payment window failed to load.")));
    s.onerror = () => reject(new Error("Couldn't load the payment window. Check your internet."));
    document.body.appendChild(s);
  });
}

function AddBranch({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => Promise<void> }) {
  const [v, setV] = React.useState({ name: "", branchCode: "", city: "", stateCode: "", copyCatalogue: true });
  const [busy, setBusy] = React.useState(false);
  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} title="Add branch" description="You'll be the owner of the new branch. Add its staff from Settings → Users after switching to it.">
      <div className="space-y-3 pb-2">
        <Field id="br-name" label="Branch name">
          <Input id="br-name" autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Sharma Store — Malviya Nagar" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="br-code" label="Branch code" optional>
            <Input id="br-code" value={v.branchCode} onChange={(e) => setV({ ...v, branchCode: e.target.value.toUpperCase() })} placeholder="BR-2" />
          </Field>
          <Field id="br-city" label="City" optional>
            <Input id="br-city" value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} />
          </Field>
        </div>
        <Field id="br-state" label="State" optional hint="Leave empty if it's in the same state">
          <NativeSelect id="br-state" value={v.stateCode} onChange={(e) => setV({ ...v, stateCode: e.target.value })}>
            <option value="">Same state</option>
            {INDIAN_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <label className="flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3">
          <span>
            <span className="block text-[14.5px] font-medium">Copy my products</span>
            <span className="block text-[12.5px] text-muted-foreground">Prices, GST and voice names — stock starts at zero</span>
          </span>
          <Switch checked={v.copyCatalogue} onCheckedChange={(c) => setV({ ...v, copyCatalogue: c })} aria-label="Copy products" />
        </label>
        <Button
          className="w-full"
          loading={busy}
          disabled={v.name.trim().length < 2}
          onClick={async () => {
            setBusy(true);
            try {
              await api<{ businessId: string }>("/branches", { method: "POST", body: { name: v.name, branchCode: v.branchCode || undefined, city: v.city || null, stateCode: v.stateCode || null, copyCatalogue: v.copyCatalogue } });
              onOpenChange(false);
              setV({ name: "", branchCode: "", city: "", stateCode: "", copyCatalogue: true });
              await onDone();
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Add branch
        </Button>
      </div>
    </ResponsiveModal>
  );
}
