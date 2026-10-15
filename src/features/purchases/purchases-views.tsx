"use client";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardListIcon, DownloadIcon, PlusIcon, ShoppingBagIcon, Undo2Icon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DateRangePicker, presetRange } from "@/components/shared/date-range";
import { LoadMore } from "@/components/shared/load-more";
import { Money, Qty } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { useUrlState } from "@/components/shared/url-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCan } from "@/features/session/session-context";
import { api, apiGet, errorMessage, qs } from "@/lib/api";
import type { PurchaseDetail, PurchaseList } from "@/lib/api-types";
import { formatDate, formatDateTime, formatShortDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

const STATUS_BADGE = { PAID: ["success", "Paid"], PARTIAL: ["warning", "Part paid"], UNPAID: ["danger", "Unpaid"] } as const;

export function PurchasesList() {
  const url = useUrlState();
  const def = presetRange("30d");
  const range = { from: url.get("from") ?? def.from, to: url.get("to") ?? def.to };
  const q = useInfiniteQuery({
    queryKey: ["purchases", range.from, range.to],
    queryFn: ({ pageParam, signal }) => apiGet<PurchaseList>(`/purchases${qs({ ...range, cursor: pageParam })}`, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const totals = q.data?.pages[0]?.totals;
  return (
    <div>
      <PageHeader
        title="Purchases"
        description={totals ? <>{totals.count} purchases · <Money paise={totals.totalPaise} /></> : " "}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/purchases/orders">
                <ClipboardListIcon /> <span className="hidden sm:inline">Orders</span>
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <a href={`/api/purchases/export${qs(range)}`} download>
                <DownloadIcon /> <span className="hidden sm:inline">Export</span>
              </a>
            </Button>
            <Button asChild>
              <Link href="/purchases/new">
                <PlusIcon /> New purchase
              </Link>
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
        <EmptyState icon={ShoppingBagIcon} title="No purchases in this period." description="Record stock you buy — or say “Sharma se 3 crate Coke aayi”." action={<Button asChild><Link href="/purchases/new">New Purchase</Link></Button>} />
      ) : (
        <>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {items.map((p) => {
              const [variant, label] = STATUS_BADGE[p.paymentStatus as keyof typeof STATUS_BADGE] ?? ["neutral", p.paymentStatus];
              return (
                <li key={p.id}>
                  <Link href={`/purchases/${p.id}`} className={cn("flex items-center gap-3 px-4 py-3 hover:bg-accent/60", p.status === "REVERSED" && "opacity-60")}>
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                      <ShoppingBagIcon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-[14.5px] font-semibold">
                        {p.purchaseNumber}
                        {p.status === "REVERSED" ? <Badge variant="danger">Reversed</Badge> : <Badge variant={variant}>{label}</Badge>}
                      </span>
                      <span className="block truncate text-[12.5px] text-muted-foreground">
                        {formatShortDate(p.txnDate)} · {p.supplierName ?? "No supplier"} · {p.itemCount} item{p.itemCount === 1 ? "" : "s"}
                        {p.billNumber ? ` · bill ${p.billNumber}` : ""}
                      </span>
                    </span>
                    <Money paise={p.totalPaise} className={cn("text-[15px] font-semibold", p.status === "REVERSED" && "line-through")} />
                  </Link>
                </li>
              );
            })}
          </ul>
          <LoadMore hasMore={!!q.hasNextPage} loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()} />
        </>
      )}
    </div>
  );
}

export function PurchaseDetailView({ id }: { id: string }) {
  const can = useCan();
  const qc = useQueryClient();
  const [undo, setUndo] = React.useState(false);
  const q = useQuery({ queryKey: ["purchases", "detail", id], queryFn: ({ signal }) => apiGet<PurchaseDetail>(`/purchases/${id}`, signal) });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <ListSkeleton rows={4} />;
  const { purchase: p, items, supplier, createdByName } = q.data;
  const reversed = p.status === "REVERSED";
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        back={{ href: "/purchases", label: "Purchases" }}
        title={<span className="flex items-center gap-2">{p.purchaseNumber}{reversed && <Badge variant="danger">Reversed</Badge>}</span>}
        description={`${formatDate(p.txnDate)} · ${formatDateTime(p.createdAt)}${createdByName ? ` · by ${createdByName}` : ""}`}
        actions={
          can("sales.delete") && !reversed && (
            <Button variant="outline" className="text-destructive" onClick={() => setUndo(true)}>
              <Undo2Icon /> Undo purchase
            </Button>
          )
        }
      />
      {reversed && <p className="mb-4 rounded-xl bg-destructive-soft px-4 py-3 text-[13.5px] text-destructive">Reversed{p.reversalReason ? ` — “${p.reversalReason}”` : ""}. Stock was removed again and the supplier balance corrected.</p>}
      <Card>
        <CardContent className="pt-4">
          <p className="mb-3 text-[14px]">
            {supplier ? (
              <Link href={`/suppliers/${supplier.id}`} className="font-semibold text-primary hover:underline">
                {supplier.name}
              </Link>
            ) : (
              "No supplier (cash purchase)"
            )}
            {p.billNumber && <span className="text-muted-foreground"> · Bill {p.billNumber}</span>}
          </p>
          <ul className="divide-y">
            {items.map((i) => (
              <li key={i.id} className="flex justify-between gap-3 py-2.5 text-[14px]">
                <span>
                  <Link href={`/inventory/${i.productId}`} className="font-medium hover:text-primary">
                    {i.productName}
                  </Link>
                  <span className="block text-[12px] text-muted-foreground">
                    <Qty milli={i.quantityMilli} unit={i.unit} /> @ <Money paise={i.unitCostPaise} />
                  </span>
                </span>
                <Money paise={i.totalPaise} className="font-semibold" />
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 border-t pt-3 text-[13.5px]">
            <Row label="Taxable" v={p.taxablePaise} />
            <Row label="GST (input)" v={p.taxPaise} />
            <div className="flex justify-between text-[18px] font-bold">
              <dt>Total</dt>
              <dd><Money paise={p.totalPaise} /></dd>
            </div>
            <Row label="Paid" v={p.paidPaise} />
            {p.creditPaise > 0 && <Row label="On credit (payable)" v={p.creditPaise} />}
          </dl>
          {p.notes && <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-[13px]">{p.notes}</p>}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={undo}
        onOpenChange={setUndo}
        title={`Undo ${p.purchaseNumber}?`}
        description="Stock added by this purchase is removed again and any amount owed to the supplier is cancelled. The record stays, marked reversed."
        confirmLabel="Undo purchase"
        destructive
        askReason
        onConfirm={async (reason) => {
          try {
            await api(`/purchases/${id}/reverse`, { method: "POST", body: { reason }, idempotencyKey: `reverse-purchase-${id}` });
            toast.success("Purchase reversed");
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

function Row({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <dt>{label}</dt>
      <dd><Money paise={v} /></dd>
    </div>
  );
}
