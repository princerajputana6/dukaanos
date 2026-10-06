"use client";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, MicIcon, PlusIcon, Undo2Icon, WalletIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { RankedBars } from "@/components/charts/charts";
import { AmountInput } from "@/components/shared/amount-input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DateRangePicker, presetRange } from "@/components/shared/date-range";
import { Field } from "@/components/shared/field";
import { LoadMore } from "@/components/shared/load-more";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { useUrlState } from "@/components/shared/url-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { Segmented } from "@/components/ui/segmented";
import { useSession } from "@/features/session/session-context";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { api, apiGet, errorMessage, qs } from "@/lib/api";
import type { ExpenseCategory, ExpenseList } from "@/lib/api-types";
import { formatShortDate, todayIst } from "@/lib/dates";
import { SETTLEMENT_METHODS, type SettlementMethod } from "@/lib/domain";
import { formatMoney } from "@/lib/money";
import { submitOrQueue } from "@/lib/offline/submit";
import { cn } from "@/lib/utils";

export function ExpensesView() {
  const url = useUrlState();
  const qc = useQueryClient();
  const def = presetRange("month");
  const range = { from: url.get("from") ?? def.from, to: url.get("to") ?? def.to };
  const [adding, setAdding] = React.useState(url.get("new") !== null);
  const [reverse, setReverse] = React.useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: ["expenses", range.from, range.to],
    queryFn: ({ pageParam, signal }) => apiGet<ExpenseList>(`/expenses${qs({ ...range, status: "all", cursor: pageParam })}`, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const totals = q.data?.pages[0]?.totals;

  return (
    <div>
      <PageHeader
        title="Expenses"
        description={totals ? <>Total <Money paise={totals.totalPaise} /> in this period</> : " "}
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`/api/expenses/export${qs(range)}`} download>
                <DownloadIcon /> <span className="hidden sm:inline">Export</span>
              </a>
            </Button>
            <Button onClick={() => setAdding(true)}>
              <PlusIcon /> Add expense
            </Button>
          </>
        }
      />
      <DateRangePicker className="mb-4" value={range} onChange={(r) => url.set({ from: r.from, to: r.to })} />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState icon={WalletIcon} title="No expenses recorded." description="Track rent, bijli, salary and more — or say “Bijli ka bill 1200 diya”." action={<Button onClick={() => setAdding(true)}>Add Expense</Button>} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
              {items.map((e) => (
                <li key={e.id} className={cn("flex items-center gap-3 px-4 py-3", e.status === "REVERSED" && "opacity-55")}>
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning-foreground">
                    {e.source === "VOICE" ? <MicIcon className="size-4" aria-label="Voice" /> : <WalletIcon className="size-4" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[14.5px] font-semibold">
                      {e.categoryName}
                      {e.status === "REVERSED" && <Badge variant="danger">Reversed</Badge>}
                    </span>
                    <span className="block truncate text-[12.5px] text-muted-foreground">
                      {formatShortDate(e.txnDate)} · {e.paymentMethod}
                      {e.notes ? ` · ${e.notes}` : ""}
                      {e.createdByName ? ` · ${e.createdByName}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Money paise={e.amountPaise} className={cn("text-[15px] font-semibold", e.status === "REVERSED" && "line-through")} />
                    {e.status !== "REVERSED" && (
                      <Button variant="ghost" size="icon-sm" aria-label="Reverse expense" onClick={() => setReverse(e.id)}>
                        <Undo2Icon className="text-muted-foreground" />
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <LoadMore hasMore={!!q.hasNextPage} loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()} />
          </div>
          {totals && totals.byCategory.length > 0 && (
            <Card className="h-fit">
              <CardHeader>
                <CardTitle>By category</CardTitle>
              </CardHeader>
              <CardContent>
                <RankedBars items={totals.byCategory.map((c) => ({ label: c.categoryName, value: c.totalPaise }))} formatValue={(v) => formatMoney(v, { compact: true })} />
              </CardContent>
            </Card>
          )}
        </div>
      )}
      <ExpenseSheet open={adding} onOpenChange={(o) => (setAdding(o), !o && url.get("new") !== null && url.set({ new: null }))} />
      <ConfirmDialog
        open={!!reverse}
        onOpenChange={(o) => !o && setReverse(null)}
        title="Reverse this expense?"
        description="It stays in your records, marked reversed, and no longer counts in reports."
        confirmLabel="Reverse"
        destructive
        askReason
        onConfirm={async (reason) => {
          try {
            await api(`/expenses/${reverse}/reverse`, { method: "POST", body: { reason }, idempotencyKey: `reverse-expense-${reverse}` });
            toast.success("Expense reversed");
            await qc.invalidateQueries();
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
      />
    </div>
  );
}

function ExpenseSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const me = useSession();
  const qc = useQueryClient();
  const idem = useIdempotencyKey();
  const cats = useQuery({ queryKey: ["expenses", "categories"], queryFn: ({ signal }) => apiGet<ExpenseCategory[]>("/expenses/categories", signal), enabled: open });
  const [amount, setAmount] = React.useState<number | null>(null);
  const [categoryId, setCategoryId] = React.useState<string | null>(null);
  const [newCat, setNewCat] = React.useState("");
  const [method, setMethod] = React.useState<SettlementMethod>("CASH");
  const [date, setDate] = React.useState(todayIst());
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const reset = () => {
    setAmount(null);
    setCategoryId(null);
    setNewCat("");
    setNotes("");
    setDate(todayIst());
  };
  const save = async () => {
    if (!amount) return toast.error("Enter the amount.");
    if (!categoryId && !newCat.trim()) return toast.error("Choose a category.");
    setSaving(true);
    try {
      const r = await submitOrQueue({
        type: "CREATE_EXPENSE",
        label: `Expense · ${formatMoney(amount, { compact: true })}`,
        path: "/expenses",
        payload: { amountPaise: amount, ...(categoryId ? { categoryId } : { categoryName: newCat.trim() }), paymentMethod: method, notes: notes.trim() || null, txnDate: date !== todayIst() ? date : undefined },
        idempotencyKey: idem.get(),
        businessId: me.business.id,
        offlineEnabled: me.flags.OFFLINE_ENABLED && !!categoryId,
      });
      idem.reset();
      toast.success(r.queued ? "Saved offline — will sync when you're online" : "Expense saved");
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
    <ResponsiveModal open={open} onOpenChange={(o) => (onOpenChange(o), !o && reset())} title="Add expense">
      <div className="space-y-4 pb-2">
        <Field id="e-amount" label="Amount">
          <AmountInput id="e-amount" autoFocus value={amount} onChange={setAmount} className="[&_input]:h-14 [&_input]:text-xl" />
        </Field>
        <div className="space-y-1.5">
          <span className="text-[13px] font-medium">Category</span>
          <div className="flex flex-wrap gap-2">
            {cats.data?.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={categoryId === c.id}
                onClick={() => (setCategoryId(c.id), setNewCat(""))}
                className={cn("h-10 rounded-xl border px-3.5 text-[13.5px] font-medium", categoryId === c.id ? "border-primary bg-primary-soft text-primary-soft-foreground" : "bg-card hover:bg-accent")}
              >
                {c.name}
              </button>
            ))}
          </div>
          <Input aria-label="New category" placeholder="…or type a new category" value={newCat} onChange={(e) => (setNewCat(e.target.value), setCategoryId(null))} />
        </div>
        <Segmented label="Paid by" value={method} onChange={setMethod} options={SETTLEMENT_METHODS.map((m) => ({ value: m, label: m === "CASH" ? "Cash" : m === "OTHER" ? "Other" : m === "CARD" ? "Card" : "UPI" }))} />
        <div className="grid grid-cols-2 gap-3">
          <Field id="e-notes" label="Note" optional>
            <Input id="e-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field id="e-date" label="Date">
            <Input id="e-date" type="date" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value || todayIst())} />
          </Field>
        </div>
        <Button size="lg" className="w-full" onClick={save} loading={saving}>
          Save expense
        </Button>
      </div>
    </ResponsiveModal>
  );
}
