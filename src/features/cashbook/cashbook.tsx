"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BanknoteIcon, LockIcon, WalletIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { AmountInput } from "@/components/shared/amount-input";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { CardsSkeleton, EmptyState, ErrorState } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, apiGet, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";

interface Shift {
  id: string;
  status: string;
  openingCashPaise: number;
  openedAt: number;
  openedBy: string | null;
  cashSalesPaise: number;
  cashInPaise: number;
  cashOutPaise: number;
  cashExpensePaise: number;
  expectedCashPaise: number;
  countedCashPaise: number | null;
  differencePaise: number | null;
  note: string | null;
  closedAt: number | null;
}
interface HistoryRow { id: string; status: string; openingCashPaise: number; expectedCashPaise: number | null; countedCashPaise: number | null; differencePaise: number | null; openedAt: number; closedAt: number | null; openedBy: string | null }

export function CashbookView() {
  const qc = useQueryClient();
  const cur = useQuery({ queryKey: ["shift", "current"], queryFn: ({ signal }) => apiGet<Shift | null>("/shifts/current", signal) });
  const history = useQuery({ queryKey: ["shift", "history"], queryFn: ({ signal }) => apiGet<HistoryRow[]>("/shifts", signal) });
  const [opening, setOpening] = React.useState<number | null>(0);
  const [counted, setCounted] = React.useState<number | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const shift = cur.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ["shift"] });

  const open = async () => {
    setBusy(true);
    try {
      await api("/shifts/open", { method: "POST", body: { openingCashPaise: opening ?? 0 } });
      toast.success("Shift opened.");
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const close = async () => {
    if (counted == null) return toast.error("Enter the counted cash.");
    setBusy(true);
    try {
      await api("/shifts/close", { method: "POST", body: { countedCashPaise: counted, note: note.trim() || null } });
      toast.success("Shift closed.");
      setCounted(null);
      setNote("");
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const diff = shift && counted != null ? counted - shift.expectedCashPaise : null;

  return (
    <div>
      <PageHeader title="Cashbook" description="Open a cash drawer, track cash through the day, and close with a count." />

      {cur.isError ? (
        <ErrorState error={cur.error} onRetry={() => cur.refetch()} />
      ) : cur.isLoading ? (
        <CardsSkeleton count={3} />
      ) : !shift ? (
        <section className="mx-auto max-w-md rounded-2xl border bg-card p-6 text-center shadow-soft">
          <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <WalletIcon className="size-6" />
          </span>
          <h2 className="text-[18px] font-semibold">No shift open</h2>
          <p className="mt-1 mb-4 text-[14px] text-muted-foreground">Start a shift with the cash already in the drawer.</p>
          <label className="mb-3 block text-left">
            <span className="mb-1.5 block text-[13.5px] font-medium">Opening cash (float)</span>
            <AmountInput value={opening} onChange={setOpening} />
          </label>
          <Button className="w-full" onClick={open} loading={busy}>
            Open shift
          </Button>
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <section className="rounded-2xl border bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Current shift</h2>
              <Badge variant="success">Open</Badge>
            </div>
            <p className="mb-4 text-[12.5px] text-muted-foreground">Opened {formatDateTime(shift.openedAt)}{shift.openedBy ? ` by ${shift.openedBy}` : ""}</p>
            <dl className="space-y-2 text-[14px]">
              <Row label="Opening float" value={shift.openingCashPaise} />
              <Row label="Cash sales" value={shift.cashSalesPaise} sign="+" />
              <Row label="Other cash received" value={shift.cashInPaise} sign="+" />
              <Row label="Cash paid out" value={shift.cashOutPaise} sign="−" />
              <Row label="Cash expenses" value={shift.cashExpensePaise} sign="−" />
              <div className="flex items-center justify-between border-t pt-2.5 text-[16px] font-bold">
                <dt>Expected in drawer</dt>
                <dd><Money paise={shift.expectedCashPaise} /></dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border bg-card p-5">
            <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
              <LockIcon className="size-4" /> Close shift
            </h2>
            <label className="mb-3 block">
              <span className="mb-1.5 block text-[13.5px] font-medium">Counted cash in drawer</span>
              <AmountInput value={counted} onChange={setCounted} autoFocus />
            </label>
            {diff != null && (
              <p className={`mb-3 rounded-xl px-3.5 py-2.5 text-[14px] ${diff === 0 ? "bg-success-soft text-success" : "bg-warning-soft text-warning-foreground"}`}>
                {diff === 0 ? "Matches exactly ✓" : <>Off by <strong><Money paise={Math.abs(diff)} /></strong> ({diff < 0 ? "short" : "over"})</>}
              </p>
            )}
            <Input className="mb-3" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (required if cash is off)" aria-label="Note" />
            <Button className="w-full" onClick={close} loading={busy} disabled={counted == null}>
              <BanknoteIcon /> Close &amp; record
            </Button>
          </section>
        </div>
      )}

      {history.data?.length ? (
        <section className="mt-8">
          <h2 className="mb-2 text-[13px] font-semibold tracking-wide text-muted-foreground uppercase">Past shifts</h2>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {history.data.filter((h) => h.status === "CLOSED").map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-3 text-[13.5px]">
                <span className="min-w-0">
                  <span className="block font-medium">{h.closedAt ? formatDateTime(h.closedAt) : "—"}</span>
                  <span className="text-[12px] text-muted-foreground">{h.openedBy ?? ""} · counted <Money paise={h.countedCashPaise ?? 0} /></span>
                </span>
                {h.differencePaise != null && (
                  <Badge variant={h.differencePaise === 0 ? "success" : "warning"}>
                    {h.differencePaise === 0 ? "Matched" : <>{h.differencePaise < 0 ? "Short" : "Over"} <Money paise={Math.abs(h.differencePaise)} /></>}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : history.isSuccess ? (
        <EmptyState className="mt-8" icon={WalletIcon} title="No closed shifts yet." />
      ) : null}
    </div>
  );
}

function Row({ label, value, sign }: { label: string; value: number; sign?: "+" | "−" }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        {sign && value > 0 ? <span className="text-muted-foreground">{sign} </span> : null}
        <Money paise={value} />
      </dd>
    </div>
  );
}
