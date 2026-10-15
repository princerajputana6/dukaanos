"use client";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, ClipboardCheckIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { Qty } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { matchProducts, useProductCatalog } from "@/features/shared/pickers";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { api, apiGet, errorMessage } from "@/lib/api";
import { formatQty, toMilli } from "@/lib/qty";

interface CountRow { id: string; note: string | null; linesCount: number; diffCount: number; netDeltaMilli: number; createdAt: number; by: string | null }

/** Physical stock count: enter counted quantities, preview differences, confirm to apply. */
export function StockCountView() {
  const qc = useQueryClient();
  const idem = useIdempotencyKey();
  const catalog = useProductCatalog();
  const [q, setQ] = React.useState("");
  const [counted, setCounted] = React.useState<Map<string, string>>(new Map());
  const [review, setReview] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const history = useInfiniteQuery({
    queryKey: ["inventory", "counts"],
    queryFn: ({ signal }) => apiGet<CountRow[]>("/inventory/counts", signal),
    initialPageParam: undefined,
    getNextPageParam: () => undefined,
  });

  const products = (catalog.data?.items ?? []).filter((p) => p.trackStock);
  const shown = matchProducts(products, q).slice(0, 60);

  const setVal = (id: string, v: string) => {
    const next = new Map(counted);
    const clean = v.replace(/[^\d.]/g, "");
    if (clean === "") next.delete(id);
    else next.set(id, clean);
    setCounted(next);
  };

  // Lines the user actually entered, with their computed difference.
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = [...counted.entries()]
    .map(([id, v]) => {
      const p = byId.get(id);
      const countedMilli = toMilli(v || "0") ?? 0;
      return p ? { id, name: p.name, unit: p.unit, expected: p.currentStockMilli, countedMilli, diff: countedMilli - p.currentStockMilli } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const diffs = lines.filter((l) => l.diff !== 0);

  const apply = async () => {
    setSaving(true);
    try {
      const res = await api<{ linesCount: number; diffCount: number }>("/inventory/counts", {
        method: "POST",
        idempotencyKey: idem.get(),
        body: { lines: lines.map((l) => ({ productId: l.id, countedMilli: l.countedMilli })) },
      });
      idem.reset();
      toast.success(`Count applied — ${res.diffCount} of ${res.linesCount} item${res.linesCount === 1 ? "" : "s"} corrected.`);
      setCounted(new Map());
      setReview(false);
      await qc.invalidateQueries();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-28">
      <PageHeader
        title="Stock count"
        description="Enter what you physically counted. Suvakta shows the difference and corrects stock when you confirm."
        actions={
          <Button asChild variant="ghost">
            <Link href="/inventory">Back to inventory</Link>
          </Button>
        }
      />

      <div className="relative mb-3">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input className="pl-10" placeholder="Search products to count (coke, कोक…)" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {catalog.isError ? (
        <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} />
      ) : catalog.isLoading ? (
        <ListSkeleton />
      ) : shown.length === 0 ? (
        <EmptyState icon={ClipboardCheckIcon} title="No products match." />
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {shown.map((p) => {
            const v = counted.get(p.id);
            const countedMilli = v === undefined ? null : toMilli(v || "0") ?? 0;
            const diff = countedMilli === null ? null : countedMilli - p.currentStockMilli;
            return (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-semibold">{p.name}</p>
                  <p className="text-[12px] text-muted-foreground">
                    System: <Qty milli={p.currentStockMilli} unit={p.unit} />
                    {diff != null && diff !== 0 && <span className={diff < 0 ? "text-destructive" : "text-success"}> · {diff > 0 ? "+" : ""}{formatQty(diff)}</span>}
                  </p>
                </div>
                <Input
                  inputMode="decimal"
                  aria-label={`Counted quantity for ${p.name}`}
                  className="w-24 text-right"
                  placeholder={formatQty(p.currentStockMilli)}
                  value={v ?? ""}
                  onChange={(e) => setVal(p.id, e.target.value)}
                />
              </li>
            );
          })}
        </ul>
      )}

      {history.data?.pages[0]?.length ? (
        <section className="mt-8">
          <h2 className="mb-2 text-[13px] font-semibold tracking-wide text-muted-foreground uppercase">Recent counts</h2>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {history.data.pages[0].map((c) => (
              <li key={c.id}>
                <Link href={`/inventory/count/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent/50">
                  <span className="text-[13.5px]">
                    {c.linesCount} item{c.linesCount === 1 ? "" : "s"} · <span className="font-semibold">{c.diffCount} changed</span>
                    {c.by ? <span className="text-muted-foreground"> · {c.by}</span> : null}
                  </span>
                  <span className="text-[12px] text-muted-foreground">{new Date(c.createdAt).toLocaleDateString("en-IN")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-4 py-3 backdrop-blur md:left-[var(--sidebar-w,0)]">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <p className="text-[13px] text-muted-foreground">
              <span className="font-semibold text-foreground">{lines.length}</span> counted · <span className="font-semibold text-foreground">{diffs.length}</span> to correct
            </p>
            <Button onClick={() => setReview(true)} disabled={lines.length === 0}>
              Review &amp; apply
            </Button>
          </div>
        </div>
      )}

      <ResponsiveModal open={review} onOpenChange={setReview} title="Confirm stock count" description={`${lines.length} item${lines.length === 1 ? "" : "s"} counted · ${diffs.length} will change`}>
        <div className="space-y-3 pb-2">
          {diffs.length === 0 ? (
            <p className="rounded-xl bg-muted px-3.5 py-3 text-[14px]">No differences — everything matches the system. Nothing will change.</p>
          ) : (
            <ul className="max-h-[45dvh] divide-y overflow-y-auto rounded-xl border">
              {diffs.map((l) => (
                <li key={l.id} className="flex items-center justify-between px-3.5 py-2 text-[13.5px]">
                  <span className="min-w-0 truncate">{l.name}</span>
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    <Qty milli={l.expected} /> → <strong><Qty milli={l.countedMilli} unit={l.unit} /></strong>
                    <span className={l.diff < 0 ? "font-semibold text-destructive" : "font-semibold text-success"}>({l.diff > 0 ? "+" : ""}{formatQty(l.diff)})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Button className="w-full" onClick={apply} loading={saving}>
            <CheckCircle2Icon /> Apply count
          </Button>
        </div>
      </ResponsiveModal>
    </div>
  );
}
