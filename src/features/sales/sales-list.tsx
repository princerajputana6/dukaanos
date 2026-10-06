"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { DownloadIcon, MicIcon, PlusIcon, ReceiptIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { DateRangePicker, presetRange } from "@/components/shared/date-range";
import { LoadMore } from "@/components/shared/load-more";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { useUrlState } from "@/components/shared/url-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCan } from "@/features/session/session-context";
import { useDebounced } from "@/hooks/use-debounced";
import { apiGet, qs } from "@/lib/api";
import type { SaleList } from "@/lib/api-types";
import { formatShortDate, formatTime, todayIst } from "@/lib/dates";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/domain";
import { cn } from "@/lib/utils";

export function SalesList() {
  const url = useUrlState();
  const can = useCan();
  const def = presetRange("today");
  const range = { from: url.get("from") ?? def.from, to: url.get("to") ?? def.to };
  const status = url.get("status") ?? "all";
  const [q, setQ] = React.useState(url.get("q") ?? "");
  const dq = useDebounced(q, 300);

  const query = useInfiniteQuery({
    queryKey: ["sales", range.from, range.to, status, dq],
    queryFn: ({ pageParam, signal }) => apiGet<SaleList>(`/sales${qs({ from: range.from, to: range.to, status, q: dq || undefined, cursor: pageParam })}`, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const totals = query.data?.pages[0]?.totals;
  const today = todayIst();

  return (
    <div>
      <PageHeader
        title="Sales"
        description={totals ? <>{totals.count} bill{totals.count === 1 ? "" : "s"} · <Money paise={totals.totalPaise} />{totals.creditPaise > 0 && <> · udhaar <Money paise={totals.creditPaise} /></>}</> : " "}
        actions={
          <>
            {can("reports.view") && (
              <Button variant="outline" asChild>
                <a href={`/api/sales/export${qs(range)}`} download>
                  <DownloadIcon /> <span className="hidden sm:inline">Export</span>
                </a>
              </Button>
            )}
            {can("sales.create") && (
              <Button asChild>
                <Link href="/sales/new">
                  <PlusIcon /> New sale
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 space-y-3">
        <DateRangePicker value={range} onChange={(r) => url.set({ from: r.from, to: r.to })} />
        <div className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input className="pl-10" placeholder="Bill no., customer or product" aria-label="Search sales" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select
            aria-label="Status"
            className="h-11 rounded-xl border bg-card px-3 text-[14px]"
            value={status}
            onChange={(e) => url.set({ status: e.target.value === "all" ? null : e.target.value })}
          >
            <option value="all">All</option>
            <option value="COMPLETED">Completed</option>
            <option value="REVERSED">Reversed</option>
          </select>
        </div>
      </div>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.isLoading ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={ReceiptIcon}
          title={range.from === today && range.to === today && !dq ? "Your first sale will appear here." : "No sales in this period."}
          description="Create a sale from the POS, or just say it: “Aaj 20 Coke biki”."
          action={
            can("sales.create") ? (
              <div className="flex gap-2">
                <Button asChild>
                  <Link href="/sales/new">Create Sale</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/ai">
                    <MicIcon /> Speak
                  </Link>
                </Button>
              </div>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {items.map((s) => (
              <li key={s.id}>
                <Link href={`/sales/${s.id}`} className={cn("flex items-center gap-3 px-4 py-3 hover:bg-accent/60", s.status === "REVERSED" && "opacity-60")}>
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    {s.source === "VOICE" ? <MicIcon className="size-4" aria-label="Voice" /> : <ReceiptIcon className="size-4" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[14.5px] font-semibold">{s.invoiceNumber}</span>
                      {s.status === "REVERSED" && <Badge variant="danger">Reversed</Badge>}
                      {s.creditPaise > 0 && s.status !== "REVERSED" && <Badge variant="warning">Udhaar</Badge>}
                    </span>
                    <span className="block truncate text-[12.5px] text-muted-foreground">
                      {s.txnDate === today ? formatTime(s.createdAt) : formatShortDate(s.txnDate)} · {s.customerName ?? "Walk-in"} · {s.itemsPreview}
                    </span>
                  </span>
                  <span className="text-right">
                    <Money paise={s.totalPaise} className={cn("block text-[15px] font-semibold", s.status === "REVERSED" && "line-through")} />
                    <span className="text-[12px] text-muted-foreground">{PAYMENT_METHOD_LABELS[s.paymentMethod as PaymentMethod] ?? s.paymentMethod}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <LoadMore hasMore={!!query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()} />
        </>
      )}
    </div>
  );
}
