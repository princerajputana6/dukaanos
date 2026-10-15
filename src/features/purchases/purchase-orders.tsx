"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, ClipboardListIcon, PackageCheckIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { AmountInput } from "@/components/shared/amount-input";
import { Money, Qty } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { QtyStepper } from "@/components/shared/qty-stepper";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { matchProducts, PartyPicker, useProductCatalog } from "@/features/shared/pickers";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { api, apiGet, errorMessage } from "@/lib/api";
import { fromMilli } from "@/lib/qty";

const STATUS: Record<string, { label: string; variant: "neutral" | "info" | "warning" | "success" | "danger" }> = {
  DRAFT: { label: "Draft", variant: "neutral" },
  SUBMITTED: { label: "Submitted", variant: "info" },
  APPROVED: { label: "Approved", variant: "warning" },
  PARTIALLY_RECEIVED: { label: "Partly received", variant: "warning" },
  RECEIVED: { label: "Received", variant: "success" },
  CANCELLED: { label: "Cancelled", variant: "danger" },
};
function POStatus({ s }: { s: string }) {
  const m = STATUS[s] ?? { label: s, variant: "neutral" as const };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

interface POListRow { id: string; poNumber: string; supplierName: string | null; status: string; itemCount: number; subtotalPaise: number; createdAt: number }

export function PurchaseOrdersView() {
  const [status, setStatus] = React.useState("");
  const q = useQuery({ queryKey: ["purchase-orders", status], queryFn: ({ signal }) => apiGet<POListRow[]>(`/purchase-orders${status ? `?status=${status}` : ""}`, signal) });
  const items = q.data ?? [];
  return (
    <div>
      <PageHeader
        title="Purchase orders"
        description="Plan what to buy, approve it, and receive goods. Stock changes only when you receive."
        actions={
          <Button asChild>
            <Link href="/purchases/orders/new">
              <PlusIcon /> New PO
            </Link>
          </Button>
        }
      />
      <div className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0" role="group" aria-label="Status filter">
        {[{ id: "", label: "All" }, ...Object.keys(STATUS).map((s) => ({ id: s, label: STATUS[s]!.label }))].map((f) => (
          <button key={f.id} type="button" aria-pressed={status === f.id} onClick={() => setStatus(f.id)} className={`h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-medium ${status === f.id ? "border-primary bg-primary-soft text-primary-soft-foreground" : "bg-card hover:bg-accent"}`}>
            {f.label}
          </button>
        ))}
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState icon={ClipboardListIcon} title="No purchase orders." description="Create a PO to plan a purchase and receive it in parts." action={<Button asChild><Link href="/purchases/orders/new">New PO</Link></Button>} />
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {items.map((p) => (
            <li key={p.id}>
              <Link href={`/purchases/orders/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/60">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[14.5px] font-semibold">
                    {p.poNumber} <POStatus s={p.status} />
                  </p>
                  <p className="text-[12.5px] text-muted-foreground">{p.supplierName ?? "—"} · {p.itemCount} item{p.itemCount === 1 ? "" : "s"}</p>
                </div>
                <Money paise={p.subtotalPaise} className="text-[14px] font-medium" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Create ──────────────────────────────────────────────────────────────────

interface DraftLine { id: string; name: string; unit: string; qtyMilli: number; costPaise: number | null }

export function NewPurchaseOrderView() {
  const router = useRouter();
  const catalog = useProductCatalog();
  const [supplier, setSupplier] = React.useState<{ id: string; name: string } | null>(null);
  const [pickSupplier, setPickSupplier] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [lines, setLines] = React.useState<DraftLine[]>([]);
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const picked = new Set(lines.map((l) => l.id));
  const addable = matchProducts((catalog.data?.items ?? []).filter((p) => p.trackStock), q).filter((p) => !picked.has(p.id)).slice(0, 25);
  const add = (p: { id: string; name: string; unit: string; purchasePricePaise: number }) => {
    setLines((ls) => [...ls, { id: p.id, name: p.name, unit: p.unit, qtyMilli: 1000, costPaise: p.purchasePricePaise || null }]);
    setQ("");
  };
  const total = lines.reduce((a, l) => a + Math.round(((l.costPaise ?? 0) * l.qtyMilli) / 1000), 0);
  const ready = supplier && lines.length > 0 && lines.every((l) => l.qtyMilli > 0 && (l.costPaise ?? 0) > 0);

  const save = async () => {
    if (!ready) return;
    setSaving(true);
    try {
      const res = await api<{ id: string }>("/purchase-orders", {
        method: "POST",
        body: { supplierId: supplier!.id, note: note.trim() || null, lines: lines.map((l) => ({ productId: l.id, orderedMilli: l.qtyMilli, unitCostPaise: l.costPaise! })) },
      });
      toast.success("Purchase order created (draft).");
      router.push(`/purchases/orders/${res.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <div className="pb-28">
      <PageHeader title="New purchase order" actions={<Button asChild variant="ghost"><Link href="/purchases/orders">Cancel</Link></Button>} />
      <div className="space-y-4">
        <button type="button" onClick={() => setPickSupplier(true)} className="flex w-full items-center justify-between rounded-xl border bg-card px-4 py-3 text-left hover:bg-accent">
          <span className="text-[14.5px]">{supplier ? <strong>{supplier.name}</strong> : <span className="text-muted-foreground">Choose supplier</span>}</span>
          <span className="text-[13px] text-primary">Change</span>
        </button>

        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input className="pl-10" placeholder="Add a product to order" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {q && (
          <ul className="max-h-[36dvh] divide-y overflow-y-auto rounded-xl border bg-card">
            {addable.map((p) => (
              <li key={p.id}>
                <button type="button" className="flex min-h-11 w-full items-center gap-2 px-3.5 py-2 text-left text-[14.5px] hover:bg-accent" onClick={() => add(p)}>
                  <PlusIcon className="size-4 text-primary" /> {p.name}
                </button>
              </li>
            ))}
          </ul>
        )}

        {lines.length > 0 && (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {lines.map((l, i) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{l.name}</span>
                <QtyStepper size="sm" label={`${l.name} quantity`} value={l.qtyMilli} min={1} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, qtyMilli: Math.max(1, v) } : x)))} />
                <AmountInput className="w-28" aria-label={`${l.name} cost per ${l.unit}`} value={l.costPaise} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, costPaise: v } : x)))} />
                <button type="button" aria-label={`Remove ${l.name}`} className="rounded-lg p-2 text-muted-foreground hover:bg-accent" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                  <XIcon className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 px-4 py-3 backdrop-blur md:left-[var(--sidebar-w,0)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <span className="text-[14px]">Order total: <Money paise={total} className="font-semibold" /></span>
          <Button onClick={save} loading={saving} disabled={!ready}>
            Create PO
          </Button>
        </div>
      </div>
      <PartyPicker kind="supplier" open={pickSupplier} onOpenChange={setPickSupplier} selectedId={supplier?.id} onSelect={(p) => setSupplier(p)} />
    </div>
  );
}

// ─── Detail + receive ────────────────────────────────────────────────────────

interface PODetail {
  po: { id: string; poNumber: string; supplierName: string | null; status: string; note: string | null; subtotalPaise: number; createdAt: number; createdBy: string | null };
  lines: { id: string; productId: string; productName: string; unit: string; orderedMilli: number; receivedMilli: number; unitCostPaise: number }[];
}

export function PurchaseOrderDetailView({ id }: { id: string }) {
  const qc = useQueryClient();
  const idem = useIdempotencyKey();
  const q = useQuery({ queryKey: ["purchase-orders", "detail", id], queryFn: ({ signal }) => apiGet<PODetail>(`/purchase-orders/${id}`, signal) });
  const [receiving, setReceiving] = React.useState(false);
  const [recv, setRecv] = React.useState<Map<string, number>>(new Map());
  const [busy, setBusy] = React.useState<string | null>(null);
  const d = q.data;

  const act = async (path: string, label: string) => {
    setBusy(path);
    try {
      await api(`/purchase-orders/${id}/${path}`, { method: "POST" });
      toast.success(label);
      await qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const openReceive = () => {
    const m = new Map<string, number>();
    d?.lines.forEach((l) => m.set(l.productId, Math.max(0, l.orderedMilli - l.receivedMilli)));
    setRecv(m);
    setReceiving(true);
  };
  const submitReceive = async () => {
    setBusy("receive");
    try {
      await api(`/purchase-orders/${id}/receive`, { method: "POST", idempotencyKey: idem.get(), body: { lines: [...recv.entries()].map(([productId, receivedMilli]) => ({ productId, receivedMilli })) } });
      idem.reset();
      toast.success("Goods received — stock and supplier balance updated.");
      setReceiving(false);
      await qc.invalidateQueries();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? (
        <ListSkeleton />
      ) : (
        <>
          <PageHeader
            title={<span className="flex items-center gap-2">{d.po.poNumber} <POStatus s={d.po.status} /></span>}
            description={`${d.po.supplierName ?? "—"}${d.po.createdBy ? ` · by ${d.po.createdBy}` : ""}`}
            actions={<Button asChild variant="ghost"><Link href="/purchases/orders">Back</Link></Button>}
          />
          <ul className="mb-4 divide-y overflow-hidden rounded-2xl border bg-card">
            {d.lines.map((l) => {
              const remaining = l.orderedMilli - l.receivedMilli;
              return (
                <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3 text-[13.5px]">
                  <span className="min-w-0 flex-1 truncate font-medium">{l.productName}</span>
                  <span className="text-muted-foreground">
                    Ordered <Qty milli={l.orderedMilli} unit={l.unit} /> · Received <strong className="text-foreground"><Qty milli={l.receivedMilli} /></strong>
                    {remaining > 0 && <span className="text-warning-foreground"> · {fromMilli(remaining)} left</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {d.po.note && <p className="mb-4 rounded-xl bg-muted px-3.5 py-2.5 text-[13.5px]">{d.po.note}</p>}

          <div className="flex flex-wrap gap-2">
            {d.po.status === "DRAFT" && <Button onClick={() => act("submit", "Submitted for approval.")} loading={busy === "submit"}>Submit for approval</Button>}
            {d.po.status === "SUBMITTED" && <Button onClick={() => act("approve", "Approved.")} loading={busy === "approve"}><CheckCircle2Icon /> Approve</Button>}
            {(d.po.status === "APPROVED" || d.po.status === "PARTIALLY_RECEIVED") && <Button onClick={openReceive}><PackageCheckIcon /> Receive goods</Button>}
            {["DRAFT", "SUBMITTED", "APPROVED"].includes(d.po.status) && (
              <Button variant="ghost" className="text-destructive" onClick={() => act("cancel", "Purchase order cancelled.")} loading={busy === "cancel"}>Cancel PO</Button>
            )}
          </div>

          <ResponsiveModal open={receiving} onOpenChange={setReceiving} title="Receive goods" description="Enter what arrived. Stock and the supplier balance update on confirm.">
            <div className="space-y-3 pb-2">
              <ul className="max-h-[45dvh] divide-y overflow-y-auto rounded-xl border">
                {d.lines.map((l) => {
                  const remaining = l.orderedMilli - l.receivedMilli;
                  return (
                    <li key={l.id} className="flex items-center justify-between gap-3 px-3.5 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">{l.productName}</span>
                        <span className="text-[12px] text-muted-foreground">{fromMilli(remaining)} {l.unit} remaining</span>
                      </span>
                      <QtyStepper size="sm" label={`Receive ${l.productName}`} value={recv.get(l.productId) ?? 0} min={0} onChange={(v) => setRecv((m) => new Map(m).set(l.productId, Math.min(Math.max(0, v), remaining)))} />
                    </li>
                  );
                })}
              </ul>
              <Button className="w-full" onClick={submitReceive} loading={busy === "receive"} disabled={[...recv.values()].every((v) => v <= 0)}>
                <PackageCheckIcon /> Confirm receipt
              </Button>
            </div>
          </ResponsiveModal>
        </>
      )}
    </div>
  );
}
