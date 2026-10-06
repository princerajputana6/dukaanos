"use client";
import { useQueryClient } from "@tanstack/react-query";
import { MicIcon, Undo2Icon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { AmountInput } from "@/components/shared/amount-input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field } from "@/components/shared/field";
import { Money } from "@/components/shared/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { Segmented } from "@/components/ui/segmented";
import { useSession } from "@/features/session/session-context";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { LedgerEntry } from "@/lib/api-types";
import { formatDate, formatDateTime, todayIst } from "@/lib/dates";
import { INDIAN_STATES, SETTLEMENT_METHODS, type SettlementMethod } from "@/lib/domain";
import { submitOrQueue } from "@/lib/offline/submit";
import { cn } from "@/lib/utils";

export type PartyKind = "customer" | "supplier";

interface PartyValues {
  name: string;
  phone: string;
  email?: string;
  company?: string;
  gstin?: string;
  address: string;
  stateCode: string;
  notes: string;
}

/** Create / edit a customer or supplier. */
export function PartyFormSheet({
  kind,
  open,
  onOpenChange,
  existing,
  initialName,
  onSaved,
}: {
  kind: PartyKind;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing?: { id: string } & Partial<Record<keyof PartyValues, string | null>>;
  initialName?: string;
  onSaved?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const idem = useIdempotencyKey();
  const blank: PartyValues = { name: initialName ?? "", phone: "", email: "", company: "", gstin: "", address: "", stateCode: "", notes: "" };
  const [v, setV] = React.useState<PartyValues>(blank);
  const [opening, setOpening] = React.useState<number | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [openedFor, setOpenedFor] = React.useState<string | null>(null);
  const key = open ? (existing?.id ?? `new:${initialName ?? ""}`) : null;
  if (key !== openedFor) {
    setOpenedFor(key);
    if (open) {
      setV(existing ? { ...blank, ...Object.fromEntries(Object.entries(existing).map(([k, x]) => [k, x ?? ""])) } : blank);
      setOpening(null);
      setErrors({});
    }
  }
  const set = (k: keyof PartyValues, x: string) => setV((s) => ({ ...s, [k]: x }));
  const label = kind === "customer" ? "customer" : "supplier";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.name.trim()) return setErrors({ name: "Enter a name" });
    setSaving(true);
    const body: Record<string, unknown> = {
      name: v.name.trim(),
      phone: v.phone.trim() || null,
      address: v.address.trim() || null,
      stateCode: v.stateCode || null,
      notes: v.notes.trim() || null,
      ...(kind === "customer" ? { email: v.email?.trim() || null } : { company: v.company?.trim() || null, gstin: v.gstin?.trim() || null }),
      ...(!existing ? { openingBalancePaise: opening ?? 0 } : {}),
    };
    try {
      const path = kind === "customer" ? "/customers" : "/suppliers";
      const r = existing ? await api<{ id: string }>(`${path}/${existing.id}`, { method: "PATCH", body }) : await api<{ id: string }>(path, { method: "POST", body, idempotencyKey: idem.get() });
      idem.reset();
      toast.success(existing ? "Saved" : `${v.name.trim()} added`);
      await qc.invalidateQueries({ queryKey: [kind === "customer" ? "customers" : "suppliers"] });
      onOpenChange(false);
      onSaved?.(r.id);
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) setErrors(Object.fromEntries((err.details as Array<{ path: string; message: string }>).map((d) => [d.path, d.message])));
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} title={existing ? `Edit ${label}` : `New ${label}`}>
      <form onSubmit={save} noValidate className="space-y-3 pb-2">
        <Field id="p-name" label="Name" error={errors.name}>
          <Input id="p-name" autoFocus value={v.name} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} />
        </Field>
        <Field id="p-phone" label="Mobile" optional error={errors.phone}>
          <Input id="p-phone" type="tel" inputMode="numeric" value={v.phone} onChange={(e) => set("phone", e.target.value)} placeholder="98765 43210" />
        </Field>
        {kind === "supplier" && (
          <div className="grid grid-cols-2 gap-3">
            <Field id="p-company" label="Company" optional>
              <Input id="p-company" value={v.company} onChange={(e) => set("company", e.target.value)} />
            </Field>
            <Field id="p-gstin" label="GSTIN" optional error={errors.gstin}>
              <Input id="p-gstin" value={v.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} maxLength={15} />
            </Field>
          </div>
        )}
        <Field id="p-address" label="Address" optional>
          <Input id="p-address" value={v.address} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <Field id="p-state" label="State" optional hint="Used to apply IGST for other states">
          <NativeSelect id="p-state" value={v.stateCode} onChange={(e) => set("stateCode", e.target.value)}>
            <option value="">—</option>
            {INDIAN_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {!existing && (
          <Field id="p-opening" label={kind === "customer" ? "Old udhaar to carry over" : "Amount you already owe"} optional hint="From your paper khata, if any">
            <AmountInput id="p-opening" value={opening} onChange={setOpening} placeholder="0" />
          </Field>
        )}
        <Field id="p-notes" label="Notes" optional>
          <Textarea id="p-notes" rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={saving}>
          {existing ? "Save" : `Add ${label}`}
        </Button>
      </form>
    </ResponsiveModal>
  );
}

export type MoneyEntryKind = "payment" | "credit" | "adjust";

/** Payment received/made, manual udhaar, or an adjustment — with offline queueing where safe. */
export function MoneyEntrySheet({
  kind,
  entry,
  party,
  open,
  onOpenChange,
}: {
  kind: PartyKind;
  entry: MoneyEntryKind;
  party: { id: string; name: string; balancePaise: number };
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const me = useSession();
  const qc = useQueryClient();
  const idem = useIdempotencyKey();
  const [amount, setAmount] = React.useState<number | null>(null);
  const [method, setMethod] = React.useState<SettlementMethod>("CASH");
  const [direction, setDirection] = React.useState<"increase" | "decrease">("decrease");
  const [note, setNote] = React.useState("");
  const [date, setDate] = React.useState(todayIst());
  const [saving, setSaving] = React.useState(false);
  const title =
    entry === "payment" ? (kind === "customer" ? `Payment from ${party.name}` : `Pay ${party.name}`) : entry === "credit" ? `Add udhaar for ${party.name}` : `Adjust ${party.name}'s balance`;
  const signed = entry === "adjust" ? (direction === "increase" ? 1 : -1) * (amount ?? 0) : entry === "payment" ? -(amount ?? 0) : amount ?? 0;
  const after = party.balancePaise + signed;

  const reset = () => {
    setAmount(null);
    setNote("");
    setMethod("CASH");
    setDate(todayIst());
  };

  const save = async () => {
    if (!amount || amount <= 0) return toast.error("Enter an amount.");
    if (entry === "adjust" && note.trim().length < 3) return toast.error("Please add a reason for the adjustment.");
    setSaving(true);
    const base = kind === "customer" ? `/customers/${party.id}` : `/suppliers/${party.id}`;
    const txnDate = date !== todayIst() ? date : undefined;
    try {
      if (entry === "adjust") {
        await api(`${base}/adjust`, { method: "POST", idempotencyKey: idem.get(), body: { amountPaise: signed, note: note.trim(), txnDate } });
        toast.success("Balance adjusted");
      } else {
        const path = entry === "payment" ? `${base}/payment` : `${base}/credit`;
        const payload = entry === "payment" ? { amountPaise: amount, method, note: note.trim() || null, txnDate } : { amountPaise: amount, note: note.trim() || null, txnDate };
        const r = await submitOrQueue({
          type: entry === "payment" ? "CUSTOMER_PAYMENT" : "CUSTOMER_CREDIT",
          label: `${entry === "payment" ? "Payment" : "Udhaar"} · ${party.name}`,
          path,
          payload,
          idempotencyKey: idem.get(),
          businessId: me.business.id,
          offlineEnabled: me.flags.OFFLINE_ENABLED && kind === "customer",
        });
        toast.success(r.queued ? "Saved offline — will sync when you're online" : entry === "payment" ? "Payment recorded" : "Udhaar added");
      }
      idem.reset();
      reset();
      onOpenChange(false);
      await qc.invalidateQueries();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveModal open={open} onOpenChange={(o) => (onOpenChange(o), !o && reset())} title={title} description={<>Current balance <Money paise={party.balancePaise} /></>}>
      <div className="space-y-4 pb-2">
        {entry === "adjust" && (
          <Segmented
            label="Direction"
            value={direction}
            onChange={setDirection}
            options={[
              { value: "decrease", label: "Reduce balance" },
              { value: "increase", label: "Increase balance" },
            ]}
          />
        )}
        <Field id="m-amount" label="Amount">
          <AmountInput id="m-amount" autoFocus value={amount} onChange={setAmount} className="[&_input]:h-14 [&_input]:text-xl" />
        </Field>
        {entry === "payment" && (
          <div className="space-y-1.5">
            <span className="text-[13px] font-medium">Paid by</span>
            <Segmented label="Payment method" value={method} onChange={setMethod} options={SETTLEMENT_METHODS.map((m) => ({ value: m, label: m === "OTHER" ? "Other" : m === "CASH" ? "Cash" : m === "CARD" ? "Card" : "UPI" }))} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field id="m-note" label={entry === "adjust" ? "Reason" : "Note"} optional={entry !== "adjust"}>
            <Input id="m-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Field id="m-date" label="Date">
            <Input id="m-date" type="date" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value || todayIst())} />
          </Field>
        </div>
        <p className="rounded-xl bg-muted px-3.5 py-2.5 text-[14px]">
          {kind === "customer" ? "Outstanding" : "Payable"} after: <strong className={after > 0 ? "text-warning-foreground" : after < 0 ? "text-success" : ""}><Money paise={after} /></strong>
          {after < 0 && <span className="text-muted-foreground"> (advance)</span>}
        </p>
        <Button size="lg" className="w-full" loading={saving} onClick={save} disabled={!amount}>
          {entry === "payment" ? "Save payment" : entry === "credit" ? "Add udhaar" : "Save adjustment"}
        </Button>
      </div>
    </ResponsiveModal>
  );
}

const TYPE_LABEL: Record<string, string> = {
  SALE_CREDIT: "Sale on udhaar",
  PURCHASE_CREDIT: "Purchase on credit",
  CREDIT: "Udhaar",
  PAYMENT: "Payment",
  ADJUSTMENT: "Adjustment",
  REVERSAL: "Reversal",
};

/** Khata ledger: running balance, sources, reversible manual entries. */
export function LedgerList({ kind, partyId, entries, canReverse }: { kind: PartyKind; partyId: string; entries: LedgerEntry[]; canReverse: boolean }) {
  const qc = useQueryClient();
  const [target, setTarget] = React.useState<LedgerEntry | null>(null);
  if (!entries.length) return <p className="py-8 text-center text-sm text-muted-foreground">No entries yet.</p>;
  return (
    <>
      <ul className="divide-y">
        {entries.map((e) => {
          const reversible = canReverse && e.status !== "REVERSED" && ["PAYMENT", "CREDIT", "ADJUSTMENT"].includes(e.type) && !(kind === "supplier" && e.type === "CREDIT");
          const link = e.referenceType === "sale" ? `/sales/${e.referenceId}` : e.referenceType === "purchase" ? `/purchases/${e.referenceId}` : null;
          return (
            <li key={e.id} className={cn("flex items-start gap-3 py-3", e.status === "REVERSED" && "opacity-55")}>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-[14px] font-medium">
                  {TYPE_LABEL[e.type] ?? e.type}
                  {e.method && <span className="text-muted-foreground">· {e.method}</span>}
                  {e.source === "VOICE" && (
                    <Badge variant="info">
                      <MicIcon /> Voice
                    </Badge>
                  )}
                  {e.status === "REVERSED" && <Badge variant="danger">Reversed</Badge>}
                </p>
                <p className="text-[12.5px] text-muted-foreground">
                  {formatDate(e.txnDate)} · {formatDateTime(e.createdAt)}
                  {e.createdByName ? ` · ${e.createdByName}` : ""}
                </p>
                {e.note &&
                  (link ? (
                    <a href={link} className="text-[12.5px] text-primary hover:underline">
                      {e.note}
                    </a>
                  ) : (
                    <p className="text-[12.5px]">{e.note}</p>
                  ))}
              </div>
              <div className="text-right">
                <Money paise={e.amountPaise} signed className={cn("block text-[15px] font-semibold", e.amountPaise > 0 ? "text-warning-foreground" : "text-success")} />
                <span className="text-[12px] text-muted-foreground">
                  Bal <Money paise={e.balanceAfterPaise} />
                </span>
                {reversible && (
                  <button type="button" onClick={() => setTarget(e)} className="mt-1 flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-destructive">
                    <Undo2Icon className="size-3" /> Reverse
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Reverse this entry?"
        description="A reversal entry is added; the original stays in the khata, marked reversed."
        confirmLabel="Reverse"
        destructive
        askReason
        onConfirm={async (reason) => {
          if (!target) return;
          try {
            await api(`/${kind === "customer" ? "customers" : "suppliers"}/${partyId}/entries/${target.id}/reverse`, { method: "POST", body: { reason }, idempotencyKey: `reverse-entry-${target.id}` });
            toast.success("Entry reversed");
            await qc.invalidateQueries();
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
    </>
  );
}
