"use client";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, FileUpIcon, PackageIcon, PlusIcon, SearchIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { LoadMore } from "@/components/shared/load-more";
import { Money, Qty } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { useUrlState } from "@/components/shared/url-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { useCan } from "@/features/session/session-context";
import { useDebounced } from "@/hooks/use-debounced";
import { api, apiGet, errorMessage, qs } from "@/lib/api";
import type { Category, ImportReport, ProductList } from "@/lib/api-types";
import { formatGstRate } from "@/lib/pricing";

export function ProductsView() {
  const url = useUrlState();
  const can = useCan();
  const [q, setQ] = React.useState("");
  const dq = useDebounced(q, 250);
  const status = url.get("status") ?? "active";
  const categoryId = url.get("category") ?? "";
  const [importOpen, setImportOpen] = React.useState(false);
  const cats = useQuery({ queryKey: ["products", "categories"], queryFn: ({ signal }) => apiGet<Category[]>("/products/categories", signal) });
  const list = useInfiniteQuery({
    queryKey: ["products", "catalogue", status, categoryId, dq],
    queryFn: ({ pageParam, signal }) => apiGet<ProductList>(`/products${qs({ status, categoryId: categoryId || undefined, q: dq || undefined, cursor: pageParam })}`, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div>
      <PageHeader
        title="Products"
        description="Your catalogue: prices, GST, codes and voice names."
        actions={
          <>
            <Button variant="outline" asChild>
              <a href="/api/products/export" download>
                <DownloadIcon /> <span className="hidden sm:inline">Export</span>
              </a>
            </Button>
            {can("inventory.create") && (
              <>
                <Button variant="outline" onClick={() => setImportOpen(true)}>
                  <FileUpIcon /> <span className="hidden sm:inline">Import CSV</span>
                </Button>
                <Button asChild>
                  <Link href="/products/new">
                    <PlusIcon /> Add
                  </Link>
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input className="pl-10" placeholder="Search name, barcode, SKU…" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:w-80">
          <NativeSelect aria-label="Category" value={categoryId} onChange={(e) => url.set({ category: e.target.value || null })}>
            <option value="">All categories</option>
            {cats.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.productCount})
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Status" value={status} onChange={(e) => url.set({ status: e.target.value === "active" ? null : e.target.value })}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </NativeSelect>
        </div>
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={PackageIcon}
          title={dq || categoryId || status !== "active" ? "No products match." : "Your inventory is empty."}
          action={
            can("inventory.create") && !dq ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild>
                  <Link href="/products/new">Add Product</Link>
                </Button>
                <SampleButton />
              </div>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border bg-card">
            <table className="w-full text-[14px]">
              <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Product</th>
                  <th className="px-2 py-2.5 text-right font-medium">Price</th>
                  <th className="hidden px-2 py-2.5 text-right font-medium md:table-cell">GST</th>
                  <th className="hidden px-2 py-2.5 text-right font-medium sm:table-cell">Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((p) => (
                  <tr key={p.id} className="hover:bg-accent/50">
                    <td className="px-4 py-3">
                      <Link href={`/products/${p.id}`} className="font-semibold hover:text-primary">
                        {p.name}
                      </Link>
                      <span className="block text-[12px] text-muted-foreground">
                        {[p.categoryName, p.brand, p.barcode].filter(Boolean).join(" · ") || "—"}
                        {!p.isActive && (
                          <Badge variant="neutral" className="ml-1.5">
                            Archived
                          </Badge>
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-right font-semibold">
                      <Money paise={p.sellingPricePaise} />
                    </td>
                    <td className="hidden px-2 py-3 text-right text-muted-foreground md:table-cell">{p.gstRateBp ? formatGstRate(p.gstRateBp) : "—"}</td>
                    <td className="hidden px-2 py-3 text-right sm:table-cell">{p.trackStock ? <Qty milli={p.currentStockMilli} unit={p.unit} /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />
        </>
      )}
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

export function SampleButton({ onDone }: { onDone?: (n: number) => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      variant="outline"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await api<{ created: number }>("/products/samples", { method: "POST" });
          toast.success(r.created ? `Added ${r.created} sample products` : "Sample products are already added");
          await qc.invalidateQueries({ queryKey: ["products"] });
          onDone?.(r.created);
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <SparklesIcon /> Add sample products
    </Button>
  );
}

/** CSV import with a dry run first: shows what will be created and every row error. */
export function ImportDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone?: (n: number) => void }) {
  const qc = useQueryClient();
  const [csv, setCsv] = React.useState<string | null>(null);
  const [fileName, setFileName] = React.useState("");
  const [report, setReport] = React.useState<ImportReport | null>(null);
  const [busy, setBusy] = React.useState(false);
  const reset = () => {
    setCsv(null);
    setFileName("");
    setReport(null);
  };
  const run = async (dryRun: boolean) => {
    if (!csv) return;
    setBusy(true);
    try {
      const r = await api<ImportReport>("/products/import", { method: "POST", body: { csv, dryRun } });
      setReport(r);
      if (!dryRun) {
        toast.success(`Imported ${r.created} products`);
        await qc.invalidateQueries({ queryKey: ["products"] });
        onDone?.(r.created);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ResponsiveModal open={open} onOpenChange={(o) => (onOpenChange(o), !o && reset())} title="Import products from CSV" description="Upload a spreadsheet saved as CSV. We check every row before saving anything.">
      <div className="space-y-4 pb-2">
        <a href="/api/products/import/template" download className="inline-flex text-[13.5px] font-semibold text-primary hover:underline">
          Download the template
        </a>
        <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed bg-muted/40 px-4 py-6 text-center hover:bg-muted">
          <FileUpIcon className="size-6 text-muted-foreground" aria-hidden="true" />
          <span className="text-[14px] font-medium">{fileName || "Choose CSV file"}</span>
          <span className="text-[12px] text-muted-foreground">Max 500 products per file</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 1_000_000) return toast.error("File is too large (max 1 MB).");
              setFileName(f.name);
              setReport(null);
              setCsv(await f.text());
            }}
          />
        </label>
        {report && (
          <div className="space-y-2 rounded-xl bg-muted/60 p-3 text-[13.5px]">
            <p>
              <strong>{report.created}</strong> {report.dryRun ? "will be added" : "added"} · <strong>{report.skipped}</strong> skipped (already exist) · <strong>{report.errors.length}</strong> with errors
            </p>
            {report.errors.length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-y-auto text-[12.5px] text-destructive">
                {report.errors.map((e, i) => (
                  <li key={i}>
                    {e.row ? `Row ${e.row}` : e.name}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={!csv} loading={busy && !report} onClick={() => run(true)}>
            Check file
          </Button>
          <Button disabled={!csv || !report?.dryRun || report.created === 0} loading={busy && !!report} onClick={() => run(false)}>
            Import {report?.dryRun ? report.created : ""}
          </Button>
        </div>
      </div>
    </ResponsiveModal>
  );
}
