"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeftIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { Qty } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { matchProducts, useProductCatalog } from "@/features/shared/pickers";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { api, apiGet, errorMessage } from "@/lib/api";
import type { BranchList } from "@/lib/api-types";
import { toMilli } from "@/lib/qty";

interface Line { id: string; name: string; unit: string; available: number; qty: string }

/** Move stock from this branch to a sibling branch. Products match by name across branches. */
export function TransferStockView() {
  const qc = useQueryClient();
  const idem = useIdempotencyKey();
  const catalog = useProductCatalog();
  const branches = useQuery({ queryKey: ["branches"], queryFn: ({ signal }) => apiGet<BranchList>("/branches", signal) });
  const [toRaw, setTo] = React.useState("");
  const [q, setQ] = React.useState("");
  const [lines, setLines] = React.useState<Line[]>([]);
  const [confirm, setConfirm] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const targets = (branches.data?.branches ?? []).filter((b) => !b.isCurrent && b.isMember);
  // Default to the first branch without an effect (avoids a synchronous setState-in-effect).
  const to = toRaw || targets[0]?.id || "";

  const products = (catalog.data?.items ?? []).filter((p) => p.trackStock);
  const picked = new Set(lines.map((l) => l.id));
  const addable = matchProducts(products, q).filter((p) => !picked.has(p.id) && p.currentStockMilli > 0).slice(0, 30);

  const add = (p: (typeof products)[number]) => {
    setLines((ls) => [...ls, { id: p.id, name: p.name, unit: p.unit, available: p.currentStockMilli, qty: "" }]);
    setQ("");
  };
  const setQty = (id: string, v: string) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, qty: v.replace(/[^\d.]/g, "") } : l)));
  const remove = (id: string) => setLines((ls) => ls.filter((l) => l.id !== id));

  const valid = lines.filter((l) => (toMilli(l.qty || "0") ?? 0) > 0);
  const overStock = lines.find((l) => (toMilli(l.qty || "0") ?? 0) > l.available);
  const targetName = targets.find((b) => b.id === to)?.name ?? "";

  const submit = async () => {
    setSaving(true);
    try {
      await api("/inventory/transfers", {
        method: "POST",
        idempotencyKey: idem.get(),
        body: { toBusinessId: to, lines: valid.map((l) => ({ productId: l.id, quantityMilli: toMilli(l.qty)! })) },
      });
      idem.reset();
      toast.success(`Transferred ${valid.length} item${valid.length === 1 ? "" : "s"} to ${targetName}.`);
      setLines([]);
      setConfirm(false);
      await qc.invalidateQueries();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (branches.isSuccess && targets.length === 0) {
    return (
      <div>
        <PageHeader title="Transfer stock" actions={<Button asChild variant="ghost"><Link href="/inventory">Back</Link></Button>} />
        <EmptyState icon={ArrowRightLeftIcon} title="No other branch to transfer to." description="Transfers move stock between branches of your business. Add another branch in Settings → Branches first." />
      </div>
    );
  }

  return (
    <div className="pb-28">
      <PageHeader title="Transfer stock" description="Move stock from this branch to another. Products are matched by name in the other branch." actions={<Button asChild variant="ghost"><Link href="/inventory">Back to inventory</Link></Button>} />

      {branches.isError ? (
        <ErrorState error={branches.error} onRetry={() => branches.refetch()} />
      ) : (
        <>
          <label className="mb-4 block">
            <span className="mb-1.5 block text-[13.5px] font-medium">Transfer to</span>
            <NativeSelect value={to} onChange={(e) => setTo(e.target.value)} aria-label="Destination branch">
              {targets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          </label>

          <div className="relative mb-2">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input className="pl-10" placeholder="Add a product to transfer" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {q && (
            <ul className="mb-4 max-h-[40dvh] divide-y overflow-y-auto rounded-xl border bg-card">
              {addable.length === 0 ? (
                <li className="px-3.5 py-3 text-[13.5px] text-muted-foreground">No in-stock products match.</li>
              ) : (
                addable.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="flex min-h-12 w-full items-center justify-between px-3.5 py-2 text-left hover:bg-accent" onClick={() => add(p)}>
                      <span className="flex items-center gap-2 text-[14.5px] font-medium">
                        <PlusIcon className="size-4 text-primary" /> {p.name}
                      </span>
                      <Qty milli={p.currentStockMilli} unit={p.unit} className="text-[13px] text-muted-foreground" />
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}

          {lines.length === 0 ? (
            <EmptyState icon={ArrowRightLeftIcon} title="No items yet." description="Search above to add products to transfer." />
          ) : (
            <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
              {lines.map((l) => {
                const over = (toMilli(l.qty || "0") ?? 0) > l.available;
                return (
                  <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14.5px] font-semibold">{l.name}</p>
                      <p className={`text-[12px] ${over ? "text-destructive" : "text-muted-foreground"}`}>Available: <Qty milli={l.available} unit={l.unit} /></p>
                    </div>
                    <Input inputMode="decimal" aria-label={`Quantity for ${l.name}`} className="w-24 text-right" placeholder="0" value={l.qty} onChange={(e) => setQty(l.id, e.target.value)} aria-invalid={over} />
                    <button type="button" aria-label={`Remove ${l.name}`} className="rounded-lg p-2 text-muted-foreground hover:bg-accent" onClick={() => remove(l.id)}>
                      <XIcon className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {valid.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-4 py-3 backdrop-blur md:left-[var(--sidebar-w,0)]">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <p className="text-[13px] text-muted-foreground">
              <span className="font-semibold text-foreground">{valid.length}</span> item{valid.length === 1 ? "" : "s"} → {targetName}
            </p>
            <Button onClick={() => setConfirm(true)} disabled={!!overStock || !to}>
              Review transfer
            </Button>
          </div>
        </div>
      )}

      <ResponsiveModal open={confirm} onOpenChange={setConfirm} title={`Transfer to ${targetName}`} description={`${valid.length} item${valid.length === 1 ? "" : "s"} will move out of this branch.`}>
        <div className="space-y-3 pb-2">
          <ul className="max-h-[45dvh] divide-y overflow-y-auto rounded-xl border">
            {valid.map((l) => (
              <li key={l.id} className="flex items-center justify-between px-3.5 py-2 text-[13.5px]">
                <span className="min-w-0 truncate">{l.name}</span>
                <strong className="whitespace-nowrap"><Qty milli={toMilli(l.qty) ?? 0} unit={l.unit} /></strong>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-muted-foreground">If a product doesn’t exist in {targetName}, the transfer is rejected — add it there first (copy catalogue).</p>
          <Button className="w-full" onClick={submit} loading={saving} disabled={!!overStock}>
            <ArrowRightLeftIcon /> Transfer stock
          </Button>
        </div>
      </ResponsiveModal>
    </div>
  );
}
