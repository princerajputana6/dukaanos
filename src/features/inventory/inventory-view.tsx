"use client";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, BoxesIcon, IndianRupeeIcon, PackageIcon, PackageXIcon, PlusIcon, SearchIcon, SlidersHorizontalIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { LoadMore } from "@/components/shared/load-more";
import { Money, Qty } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { CardsSkeleton, EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { StockBadge } from "@/components/shared/stock-badge";
import { useUrlState } from "@/components/shared/url-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCan } from "@/features/session/session-context";
import { useDebounced } from "@/hooks/use-debounced";
import { apiGet, qs } from "@/lib/api";
import type { InventorySummary, LowStockItem, MovementList, ProductList } from "@/lib/api-types";
import { formatDateTime } from "@/lib/dates";
import { MOVEMENT_LABELS, type MovementType } from "@/lib/domain";
import { formatQty } from "@/lib/qty";
import { cn } from "@/lib/utils";
import { AdjustStockSheet } from "./adjust-stock";

const STOCK_FILTERS = [
  { id: "all", label: "All" },
  { id: "low", label: "Low stock" },
  { id: "out", label: "Out of stock" },
  { id: "in", label: "In stock" },
] as const;

export function InventoryView() {
  const url = useUrlState();
  const can = useCan();
  const stock = url.get("stock") ?? "all";
  const tab = url.get("tab") ?? "products";
  const [q, setQ] = React.useState("");
  const dq = useDebounced(q, 250);
  const [adjustOpen, setAdjustOpen] = React.useState(url.get("adjust") === "1");

  const summary = useQuery({ queryKey: ["inventory", "summary"], queryFn: ({ signal }) => apiGet<InventorySummary>("/inventory", signal) });
  const list = useInfiniteQuery({
    queryKey: ["products", "inventory", stock, dq],
    queryFn: ({ pageParam, signal }) => apiGet<ProductList>(`/products${qs({ stock, q: dq || undefined, sort: stock === "low" || stock === "out" ? "stock" : "name", cursor: pageParam, limit: 50 })}`, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const s = summary.data;

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Stock levels, alerts and every stock movement."
        actions={
          <>
            {can("inventory.adjust") && (
              <Button variant="outline" onClick={() => setAdjustOpen(true)}>
                <SlidersHorizontalIcon /> Adjust stock
              </Button>
            )}
            {can("inventory.create") && (
              <Button asChild>
                <Link href="/products/new">
                  <PlusIcon /> Add product
                </Link>
              </Button>
            )}
          </>
        }
      />
      {summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} className="mb-4" />
      ) : !s ? (
        <CardsSkeleton className="mb-5" />
      ) : (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Total products" value={s.totalProducts} icon={BoxesIcon} />
          <StatCard label="Low stock" value={s.lowStock} icon={AlertTriangleIcon} tone={s.lowStock ? "warning" : "default"} href="/inventory?stock=low" />
          <StatCard label="Out of stock" value={s.outOfStock} icon={PackageXIcon} tone={s.outOfStock ? "danger" : "default"} href="/inventory?stock=out" />
          <StatCard
            label="Inventory value"
            value={can("reports.view") ? <Money paise={s.costValuePaise} compact /> : "—"}
            icon={IndianRupeeIcon}
            hint={`Today: +${formatQty(s.todayMovements.inMilli)} in · −${formatQty(s.todayMovements.outMilli)} out`}
          />
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => url.set({ tab: v === "products" ? null : v })}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="reorder">Reorder</TabsTrigger>
          <TabsTrigger value="movements">Movements</TabsTrigger>
        </TabsList>

        <TabsContent value="products">
          <div className="mb-3 space-y-3">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input className="pl-10" placeholder="Search products (coke, कोक…)" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0" role="group" aria-label="Stock filter">
              {STOCK_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={stock === f.id}
                  onClick={() => url.set({ stock: f.id === "all" ? null : f.id })}
                  className={cn("h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-medium", stock === f.id ? "border-primary bg-primary-soft text-primary-soft-foreground" : "bg-card hover:bg-accent")}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.isLoading ? (
            <ListSkeleton />
          ) : items.length === 0 ? (
            stock === "all" && !dq ? (
              <EmptyState icon={PackageIcon} title="Your inventory is empty." description="Add products one by one, import a CSV, or start with sample products." action={<Button asChild><Link href="/products/new">Add Product</Link></Button>} />
            ) : (
              <EmptyState icon={PackageIcon} title={stock === "low" ? "Nothing is running low." : stock === "out" ? "Nothing is out of stock." : "No products match."} />
            )
          ) : (
            <>
              <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
                {items.map((p) => (
                  <li key={p.id}>
                    <Link href={`/inventory/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/60">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                        <PackageIcon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14.5px] font-semibold">{p.name}</span>
                        <span className="block truncate text-[12.5px] text-muted-foreground">
                          <Money paise={p.sellingPricePaise} compact />
                          {p.categoryName ? ` · ${p.categoryName}` : ""}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        {p.trackStock && <Qty milli={p.currentStockMilli} unit={p.unit} className="text-[14px] font-semibold" />}
                        <StockBadge milli={p.currentStockMilli} threshold={p.lowStockThresholdMilli} trackStock={p.trackStock} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />
            </>
          )}
        </TabsContent>

        <TabsContent value="reorder">
          <ReorderList />
        </TabsContent>
        <TabsContent value="movements">
          <MovementsList />
        </TabsContent>
      </Tabs>

      <AdjustStockSheet open={adjustOpen} onOpenChange={(o) => (setAdjustOpen(o), !o && url.get("adjust") && url.set({ adjust: null }))} />
    </div>
  );
}

function ReorderList() {
  const q = useQuery({ queryKey: ["inventory", "low-stock"], queryFn: ({ signal }) => apiGet<LowStockItem[]>("/inventory/low-stock", signal) });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <ListSkeleton rows={4} />;
  if (!q.data.length) return <EmptyState icon={PackageIcon} title="All products are well stocked." description="Products at or below their alert level will appear here with a reorder suggestion." />;
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <table className="w-full text-[14px]">
        <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 font-medium">Product</th>
            <th className="px-2 py-2.5 text-right font-medium">Stock</th>
            <th className="hidden px-2 py-2.5 text-right font-medium sm:table-cell">Alert at</th>
            <th className="px-4 py-2.5 text-right font-medium">Reorder</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {q.data.map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-3">
                <Link href={`/inventory/${p.id}`} className="font-medium hover:text-primary">
                  {p.name}
                </Link>
                <span className="block text-[12px] text-muted-foreground">Sold {formatQty(p.soldLast14DaysMilli)} in 14 days</span>
              </td>
              <td className={cn("px-2 py-3 text-right font-semibold", p.currentStockMilli <= 0 && "text-destructive")}>
                <Qty milli={Math.max(0, p.currentStockMilli)} />
              </td>
              <td className="hidden px-2 py-3 text-right text-muted-foreground sm:table-cell">
                <Qty milli={p.lowStockThresholdMilli} />
              </td>
              <td className="px-4 py-3 text-right font-semibold text-primary">
                ~<Qty milli={p.suggestedReorderMilli} unit={p.unit} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MovementsList({ productId }: { productId?: string }) {
  const q = useInfiniteQuery({
    queryKey: ["inventory", "movements", productId ?? "all"],
    queryFn: ({ pageParam, signal }) => apiGet<MovementList>(`/inventory/movements${qs({ productId, cursor: pageParam })}`, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (q.isLoading) return <ListSkeleton rows={5} />;
  if (!items.length) return <EmptyState icon={BoxesIcon} title="No stock movements yet." />;
  return (
    <>
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        {items.map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-4 py-3">
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold", m.quantityMilli >= 0 ? "bg-success-soft text-success" : "bg-destructive-soft text-destructive")}>
              {m.quantityMilli >= 0 ? "+" : "−"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium">
                {productId ? (MOVEMENT_LABELS[m.type as MovementType] ?? m.type) : m.productName}
              </span>
              <span className="block truncate text-[12px] text-muted-foreground">
                {!productId && `${MOVEMENT_LABELS[m.type as MovementType] ?? m.type} · `}
                {formatDateTime(m.createdAt)}
                {m.createdByName ? ` · ${m.createdByName}` : ""}
                {m.reason ? ` · ${m.reason}` : ""}
              </span>
            </span>
            <span className="text-right text-[13px]">
              <span className={cn("block font-semibold", m.quantityMilli >= 0 ? "text-success" : "text-destructive")}>
                {m.quantityMilli > 0 ? "+" : ""}
                {formatQty(m.quantityMilli)} {m.unit}
              </span>
              <span className="text-muted-foreground">
                {formatQty(m.beforeMilli)} → {formatQty(m.afterMilli)}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <LoadMore hasMore={!!q.hasNextPage} loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()} />
    </>
  );
}
