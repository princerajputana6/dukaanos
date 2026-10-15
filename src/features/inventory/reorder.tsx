"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageIcon, TruckIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Qty } from "@/components/shared/money";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCan } from "@/features/session/session-context";
import { api, apiGet } from "@/lib/api";
import { errorMessage } from "@/lib/api";
import { formatQty } from "@/lib/qty";
import { cn } from "@/lib/utils";

interface Suggestion {
  productId: string;
  name: string;
  unit: string;
  currentStockMilli: number;
  incomingMilli: number;
  avgDailyMilli: number;
  salesDays: number;
  method: "demand" | "threshold";
  daysOfCover: number | null;
  stockoutRisk: boolean;
  suggestedMilli: number;
  supplierId: string | null;
  supplierName: string | null;
  purchasePricePaise: number;
}
interface ReorderResponse { items: Suggestion[]; meta: { windowDays: number; leadTimeDays: number; safetyDays: number } }

export function ReorderList() {
  const router = useRouter();
  const qc = useQueryClient();
  const can = useCan();
  const q = useQuery({ queryKey: ["inventory", "reorder"], queryFn: ({ signal }) => apiGet<ReorderResponse>("/inventory/reorder", signal) });
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const canDraft = can("purchase.create");
  const items = q.data?.items ?? [];
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Draft one PO per supplier from the selected, supplier-having suggestions.
  const draft = useMutation({
    mutationFn: async () => {
      const chosen = items.filter((i) => selected.has(i.productId) && i.supplierId && i.suggestedMilli > 0);
      const bySupplier = new Map<string, Suggestion[]>();
      for (const i of chosen) bySupplier.set(i.supplierId!, [...(bySupplier.get(i.supplierId!) ?? []), i]);
      let first = "";
      for (const [supplierId, lines] of bySupplier) {
        const res = await api<{ id: string }>("/purchase-orders", {
          method: "POST",
          body: { supplierId, note: "From reorder suggestions", lines: lines.map((l) => ({ productId: l.productId, orderedMilli: l.suggestedMilli, unitCostPaise: l.purchasePricePaise })) },
        });
        first ||= res.id;
      }
      return { count: bySupplier.size, first };
    },
    onSuccess: async ({ count, first }) => {
      toast.success(`Created ${count} draft purchase order${count === 1 ? "" : "s"}.`);
      setSelected(new Set());
      await qc.invalidateQueries();
      if (count === 1 && first) router.push(`/purchases/orders/${first}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <ListSkeleton rows={4} />;
  if (items.length === 0) return <EmptyState icon={PackageIcon} title="Nothing to reorder." description="Products running low on cover — based on recent sales — will appear here with a suggested quantity." />;

  const meta = q.data.meta;
  const selectable = items.filter((i) => selected.has(i.productId) && i.supplierId && i.suggestedMilli > 0).length;

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted-foreground">
        Based on sales over the last {meta.windowDays} days, targeting {meta.leadTimeDays + meta.safetyDays} days of cover (≈{meta.leadTimeDays}-day lead + {meta.safetyDays}-day safety). Stock already on the way from open POs is subtracted. Suggestions only — nothing is ordered until you confirm.
      </p>
      <div className="overflow-hidden rounded-2xl border bg-card">
        <table className="w-full text-[13.5px]">
          <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
            <tr>
              {canDraft && <th className="w-9 px-3 py-2.5" />}
              <th className="px-3 py-2.5 font-medium">Product</th>
              <th className="hidden px-2 py-2.5 text-right font-medium sm:table-cell">Cover</th>
              <th className="px-2 py-2.5 text-right font-medium">Stock</th>
              <th className="px-3 py-2.5 text-right font-medium">Suggested</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((p) => (
              <tr key={p.productId} className={cn(p.stockoutRisk && "bg-destructive-soft/30")}>
                {canDraft && (
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)] disabled:opacity-40"
                      checked={selected.has(p.productId)}
                      disabled={!p.supplierId || p.suggestedMilli <= 0}
                      onChange={() => toggle(p.productId)}
                      aria-label={`Select ${p.name} for reorder`}
                    />
                  </td>
                )}
                <td className="px-3 py-3">
                  <Link href={`/inventory/${p.productId}`} className="font-medium hover:text-primary">
                    {p.name}
                  </Link>
                  <span className="block text-[11.5px] text-muted-foreground">
                    {p.method === "demand" ? `${formatQty(p.avgDailyMilli)} ${p.unit}/day` : "Low sales history — using alert level"}
                    {p.supplierName ? <> · {p.supplierName}</> : p.supplierId ? null : <span className="text-warning-foreground"> · no supplier</span>}
                  </span>
                </td>
                <td className="hidden px-2 py-3 text-right sm:table-cell">
                  {p.stockoutRisk ? <Badge variant="danger">Stockout risk</Badge> : p.daysOfCover != null ? <span className="text-muted-foreground">{p.daysOfCover}d</span> : "—"}
                </td>
                <td className={cn("px-2 py-3 text-right font-semibold", p.currentStockMilli <= 0 && "text-destructive")}>
                  <Qty milli={Math.max(0, p.currentStockMilli)} />
                  {p.incomingMilli > 0 && <span className="block text-[11px] font-normal text-info">+{formatQty(p.incomingMilli)} incoming</span>}
                </td>
                <td className="px-3 py-3 text-right font-semibold text-primary">
                  <Qty milli={p.suggestedMilli} unit={p.unit} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canDraft && (
        <div className="sticky bottom-3 flex items-center justify-between gap-3 rounded-xl border bg-background/95 px-4 py-2.5 shadow-soft backdrop-blur">
          <span className="text-[13px] text-muted-foreground">{selectable} selected</span>
          <Button size="sm" disabled={selectable === 0 || draft.isPending} loading={draft.isPending} onClick={() => draft.mutate()}>
            <TruckIcon /> Create PO draft
          </Button>
        </div>
      )}
    </div>
  );
}
