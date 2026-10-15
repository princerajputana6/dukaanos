"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Qty } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, ListSkeleton } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { formatQty } from "@/lib/qty";

interface Detail {
  count: { id: string; note: string | null; linesCount: number; diffCount: number; netDeltaMilli: number; createdAt: number };
  lines: { productId: string; productName: string | null; unit: string | null; expectedMilli: number; countedMilli: number; diffMilli: number }[];
}

export function StockCountDetail({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["inventory", "counts", id], queryFn: ({ signal }) => apiGet<Detail>(`/inventory/counts/${id}`, signal) });
  const d = q.data;
  return (
    <div>
      <PageHeader title="Stock count" description={d ? formatDateTime(d.count.createdAt) : undefined} actions={<Button asChild variant="ghost"><Link href="/inventory/count">Back</Link></Button>} />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? (
        <ListSkeleton />
      ) : (
        <>
          <p className="mb-3 text-[14px] text-muted-foreground">
            {d.count.linesCount} item{d.count.linesCount === 1 ? "" : "s"} counted · <span className="font-semibold text-foreground">{d.count.diffCount} corrected</span>
            {d.count.note ? ` · ${d.count.note}` : ""}
          </p>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {d.lines.map((l) => (
              <li key={l.productId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13.5px]">
                <span className="min-w-0 truncate">{l.productName ?? "—"}</span>
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <Qty milli={l.expectedMilli} /> → <strong><Qty milli={l.countedMilli} unit={l.unit ?? ""} /></strong>
                  {l.diffMilli !== 0 && <span className={l.diffMilli < 0 ? "font-semibold text-destructive" : "font-semibold text-success"}>({l.diffMilli > 0 ? "+" : ""}{formatQty(l.diffMilli)})</span>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
