"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CameraIcon, PencilIcon, SlidersHorizontalIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { Money, Qty } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { ErrorState, ListSkeleton } from "@/components/shared/states";
import { StockBadge } from "@/components/shared/stock-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCan } from "@/features/session/session-context";
import { api, apiGet, errorMessage } from "@/lib/api";
import type { ProductDetail } from "@/lib/api-types";
import { formatDateTime } from "@/lib/dates";
import { formatGstRate } from "@/lib/pricing";
import { formatQty } from "@/lib/qty";
import { AdjustStockSheet } from "./adjust-stock";
import { MovementsList } from "./inventory-view";

export function ProductDetailView({ id }: { id: string }) {
  const can = useCan();
  const qc = useQueryClient();
  const [adjust, setAdjust] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ["products", "detail", id], queryFn: ({ signal }) => apiGet<ProductDetail>(`/products/${id}`, signal) });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <ListSkeleton rows={5} />;
  const { product: p, stats, aliases, units, category, supplier, recentSales } = q.data;
  const money = can("reports.view");

  const upload = async (file: File) => {
    const form = new FormData();
    form.append("image", file);
    try {
      await api(`/products/${id}/image`, { method: "POST", body: form });
      toast.success("Photo updated");
      await qc.invalidateQueries({ queryKey: ["products", "detail", id] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div>
      <PageHeader
        back={{ href: "/inventory", label: "Inventory" }}
        title={
          <span className="flex items-center gap-2">
            {p.name} {!p.isActive && <Badge variant="neutral">Archived</Badge>}
          </span>
        }
        description={[category?.name, p.brand, `${formatQtyUnit(p.unit)}`].filter(Boolean).join(" · ")}
        actions={
          <>
            {can("inventory.adjust") && p.trackStock && (
              <Button variant="outline" onClick={() => setAdjust(true)}>
                <SlidersHorizontalIcon /> Adjust stock
              </Button>
            )}
            {can("inventory.create") && (
              <Button variant="outline" asChild>
                <Link href={`/products/${p.id}`}>
                  <PencilIcon /> Edit
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="mb-5 grid gap-4 md:grid-cols-[200px_1fr]">
        <div className="relative aspect-square overflow-hidden rounded-2xl border bg-muted">
          {p.imageKey ? (
            <img src={`/api/files/${p.imageKey}`} alt={p.name} className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-4xl font-bold text-muted-foreground/40">{p.name.slice(0, 2).toUpperCase()}</div>
          )}
          {can("inventory.create") && (
            <>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="absolute right-2 bottom-2 flex size-10 items-center justify-center rounded-full bg-card/90 shadow-soft"
                aria-label="Change photo"
              >
                <CameraIcon className="size-4" />
              </button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Current stock"
            value={p.trackStock ? <Qty milli={p.currentStockMilli} unit={p.unit} /> : "—"}
            hint={p.trackStock ? <StockBadge milli={p.currentStockMilli} threshold={p.lowStockThresholdMilli} /> : "Stock not tracked"}
          />
          <StatCard label="Sold today" value={<Qty milli={stats.salesTodayMilli} unit={p.unit} />} hint={<Money paise={stats.revenueTodayPaise} compact />} />
          <StatCard label="Sold this month" value={<Qty milli={stats.salesMonthMilli} unit={p.unit} />} hint={<Money paise={stats.revenueMonthPaise} compact />} />
          <StatCard label="Selling price" value={<Money paise={p.sellingPricePaise} />} hint={p.mrpPaise ? <>MRP <Money paise={p.mrpPaise} /></> : undefined} />
          {money && <StatCard label="Purchase price" value={<Money paise={p.purchasePricePaise} />} hint={<>Avg cost <Money paise={p.avgCostPaise} /></>} />}
          {money && <StatCard label="Profit this month" value={<Money paise={stats.profitMonthPaise} compact />} tone="success" hint={<>~<Money paise={stats.unitMarginPaise} /> per {p.unit}</>} />}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Stock movement history</CardTitle>
            </CardHeader>
            <CardContent>
              <MovementsList productId={p.id} />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-[13.5px]">
                <Detail label="GST" value={p.gstRateBp ? formatGstRate(p.gstRateBp) : "None"} />
                <Detail label="HSN" value={p.hsnCode} />
                <Detail label="SKU" value={p.sku} />
                <Detail label="Barcode" value={p.barcode} />
                <Detail label="Low stock alert" value={p.trackStock ? `${formatQty(p.lowStockThresholdMilli)} ${p.unit}` : "—"} />
                <Detail label="Supplier" value={supplier ? <Link className="text-primary hover:underline" href={`/suppliers/${supplier.id}`}>{supplier.name}</Link> : null} />
                <Detail label="Packs" value={units.length ? units.map((u) => `1 ${u.name} = ${formatQty(u.factorMilli)} ${p.unit}`).join(", ") : null} />
                <Detail label="Voice names" value={aliases.length ? aliases.map((a) => a.alias).join(", ") : null} />
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recent sales</CardTitle>
            </CardHeader>
            <CardContent>
              {recentSales.length ? (
                <ul className="divide-y">
                  {recentSales.map((s) => (
                    <li key={s.saleId}>
                      <Link href={`/sales/${s.saleId}`} className="flex justify-between gap-2 py-2 text-[13.5px] hover:text-primary">
                        <span>
                          {s.invoiceNumber} <span className="text-muted-foreground">· {formatDateTime(s.createdAt)}</span>
                          {s.status === "REVERSED" && <span className="text-destructive"> · reversed</span>}
                        </span>
                        <span className="font-medium">×{formatQty(s.quantityMilli)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No sales yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <AdjustStockSheet open={adjust} onOpenChange={setAdjust} product={{ id: p.id, name: p.name, unit: p.unit, currentStockMilli: p.currentStockMilli }} />
    </div>
  );
}

function formatQtyUnit(unit: string) {
  return `Sold by ${unit}`;
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value || "—"}</dd>
    </div>
  );
}
