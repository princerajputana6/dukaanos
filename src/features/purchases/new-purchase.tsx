"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, SearchIcon, Trash2Icon, TruckIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { AmountInput } from "@/components/shared/amount-input";
import { Field } from "@/components/shared/field";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { QtyStepper } from "@/components/shared/qty-stepper";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { matchProducts, PartyPicker, useProductCatalog } from "@/features/shared/pickers";
import { PURCHASE_DRAFT_KEY, useVoiceDraft } from "@/features/voice/use-assistant";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { api, apiGet, errorMessage } from "@/lib/api";
import type { ProductListItem, PurchaseResult, SupplierDetail } from "@/lib/api-types";
import { todayIst } from "@/lib/dates";
import { SETTLEMENT_METHODS, type SettlementMethod } from "@/lib/domain";
import { priceDocument, PricingError } from "@/lib/pricing";
import { formatMoney } from "@/lib/money";
import { formatQty } from "@/lib/qty";

interface PurchaseDraft {
  supplierId?: string | null;
  items: Array<{ productId: string; quantityMilli: number; unitCostPaise: number }>;
  payment?: { status?: "PAID" | "UNPAID" };
}

interface Line {
  product: ProductListItem;
  quantityMilli: number;
  unitCostPaise: number | null;
}

export function NewPurchase() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const idem = useIdempotencyKey();
  const catalog = useProductCatalog();
  const [supplier, setSupplier] = React.useState<{ id: string; name: string; balancePaise: number } | null>(null);
  const [pickSupplier, setPickSupplier] = React.useState(false);
  const [lines, setLines] = React.useState<Line[]>([]);
  const [q, setQ] = React.useState("");
  const [billNumber, setBillNumber] = React.useState("");
  const [inclusive, setInclusive] = React.useState(false);
  const [status, setStatus] = React.useState<"PAID" | "PARTIAL" | "UNPAID">("PAID");
  const [method, setMethod] = React.useState<SettlementMethod>("CASH");
  const [paid, setPaid] = React.useState<number | null>(null);
  const [date, setDate] = React.useState(todayIst());
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [done, setDone] = React.useState<PurchaseResult | null>(null);

  // Prefill from a voice proposal ("Edit").
  const draft = useVoiceDraft<PurchaseDraft>(PURCHASE_DRAFT_KEY, params.get("draft") === "1");
  const [draftApplied, setDraftApplied] = React.useState(false);
  if (draft && catalog.data && !draftApplied) {
    setDraftApplied(true);
    setLines(
      draft.items
        .map((i) => {
          const product = catalog.data.items.find((p) => p.id === i.productId);
          return product ? ({ product, quantityMilli: i.quantityMilli, unitCostPaise: i.unitCostPaise } as Line) : null;
        })
        .filter((l): l is Line => !!l),
    );
    if (draft.payment?.status) setStatus(draft.payment.status);
  }
  const draftSupplier = useQuery({
    queryKey: ["suppliers", "detail", draft?.supplierId],
    queryFn: ({ signal }) => apiGet<SupplierDetail>(`/suppliers/${draft!.supplierId}`, signal),
    enabled: !!draft?.supplierId,
  });
  const [supplierApplied, setSupplierApplied] = React.useState(false);
  if (draftSupplier.data && !supplierApplied) {
    setSupplierApplied(true);
    const sup = draftSupplier.data.supplier;
    setSupplier({ id: sup.id, name: sup.name, balancePaise: sup.balancePaise });
  }

  const results = React.useMemo(() => (q ? matchProducts(catalog.data?.items ?? [], q).slice(0, 8) : []), [catalog.data, q]);
  const add = (p: ProductListItem) => {
    setLines((ls) => (ls.some((l) => l.product.id === p.id) ? ls : [...ls, { product: p, quantityMilli: 1000, unitCostPaise: p.purchasePricePaise || null }]));
    setQ("");
  };

  const pricing = React.useMemo(() => {
    if (!lines.length || lines.some((l) => l.unitCostPaise === null)) return null;
    try {
      return priceDocument({ lines: lines.map((l) => ({ unitPricePaise: l.unitCostPaise!, quantityMilli: l.quantityMilli, gstRateBp: l.product.gstRateBp })), pricesIncludeGst: inclusive, interstate: false });
    } catch (e) {
      if (e instanceof PricingError) return null;
      throw e;
    }
  }, [lines, inclusive]);

  const save = async () => {
    if (!lines.length) return toast.error("Add at least one product.");
    if (lines.some((l) => l.unitCostPaise === null)) return toast.error("Enter the purchase rate for every product.");
    if (status !== "PAID" && !supplier) {
      setPickSupplier(true);
      return toast.error("Choose the supplier for an unpaid purchase.");
    }
    setSaving(true);
    try {
      const r = await api<PurchaseResult>("/purchases", {
        method: "POST",
        idempotencyKey: idem.get(),
        body: {
          supplierId: supplier?.id ?? null,
          billNumber: billNumber.trim() || null,
          items: lines.map((l) => ({ productId: l.product.id, quantityMilli: l.quantityMilli, unitCostPaise: l.unitCostPaise })),
          pricesIncludeGst: inclusive,
          payment: { status, method, ...(status === "PARTIAL" ? { paidPaise: paid ?? 0 } : {}) },
          txnDate: date !== todayIst() ? date : undefined,
          notes: notes.trim() || null,
        },
      });
      idem.reset();
      setDone(r);
      await qc.invalidateQueries();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-md py-8 text-center">
        <CheckCircle2Icon className="mx-auto size-16 text-success" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-semibold">Purchase saved ✓</h1>
        <p className="mt-1 text-muted-foreground">
          {done.purchaseNumber} · <Money paise={done.totalPaise} /> · stock added
          {done.creditPaise > 0 && (
            <>
              {" "}
              · owe <Money paise={done.creditPaise} />
            </>
          )}
        </p>
        <div className="mt-8 grid grid-cols-2 gap-2">
          <Button variant="outline" asChild>
            <Link href={`/purchases/${done.id}`}>View purchase</Link>
          </Button>
          <Button
            onClick={() => {
              setDone(null);
              setLines([]);
              setSupplier(null);
              setBillNumber("");
              setPaid(null);
              setNotes("");
              setStatus("PAID");
            }}
          >
            New purchase
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-28 md:pb-0">
      <PageHeader title="New purchase" description="Stock in from a supplier." back={{ href: "/purchases", label: "Purchases" }} />
      <div className="space-y-4">
        <Card>
          <CardContent className="grid gap-3 pt-4 sm:grid-cols-3">
            <button type="button" onClick={() => setPickSupplier(true)} className="flex min-h-12 items-center gap-3 rounded-xl border bg-card px-3.5 text-left hover:bg-accent sm:col-span-3">
              <TruckIcon className="size-5 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1">
                <span className="block text-[14px] font-semibold">{supplier ? supplier.name : "Choose supplier"}</span>
                <span className="block text-[12px] text-muted-foreground">{supplier ? (supplier.balancePaise > 0 ? `You owe ${formatMoney(supplier.balancePaise, { compact: true })}` : "Tap to change") : "Optional for cash purchases"}</span>
              </span>
              {supplier && (
                <span role="button" tabIndex={0} aria-label="Remove supplier" className="rounded-lg p-1.5 hover:bg-muted" onClick={(e) => (e.stopPropagation(), setSupplier(null))} onKeyDown={(e) => e.key === "Enter" && setSupplier(null)}>
                  <XIcon className="size-4" />
                </span>
              )}
            </button>
            <Field id="bill" label="Supplier bill no." optional>
              <Input id="bill" value={billNumber} onChange={(e) => setBillNumber(e.target.value)} />
            </Field>
            <Field id="pdate" label="Date">
              <Input id="pdate" type="date" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value || todayIst())} />
            </Field>
            <div className="flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2 sm:mt-6">
              <span className="text-[13px] font-medium">Rates include GST</span>
              <Switch checked={inclusive} onCheckedChange={setInclusive} aria-label="Rates include GST" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input className="pl-10" placeholder="Add product…" aria-label="Search product to add" value={q} onChange={(e) => setQ(e.target.value)} />
              {results.length > 0 && (
                <ul className="absolute inset-x-0 top-12 z-20 max-h-72 divide-y overflow-y-auto rounded-xl border bg-popover shadow-lift">
                  {results.map((p) => (
                    <li key={p.id}>
                      <button type="button" className="flex min-h-11 w-full items-center justify-between px-3.5 text-left hover:bg-accent" onClick={() => add(p)}>
                        <span className="text-[14px] font-medium">{p.name}</span>
                        <span className="text-[12px] text-muted-foreground">
                          {formatQty(p.currentStockMilli)} {p.unit}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {lines.length === 0 ? (
              <p className="rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">Search and add the products you received.</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {lines.map((l, i) => (
                  <li key={l.product.id} className="space-y-2 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[14.5px] font-semibold">{l.product.name}</span>
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${l.product.name}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                        <Trash2Icon className="text-muted-foreground" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <QtyStepper size="sm" label={`${l.product.name} quantity`} value={l.quantityMilli} min={1} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, quantityMilli: Math.max(1, v) } : x)))} />
                      <span className="text-[13px] text-muted-foreground">{l.product.unit} @</span>
                      <AmountInput className="w-32" aria-label={`${l.product.name} rate per ${l.product.unit}`} value={l.unitCostPaise} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, unitCostPaise: v } : x)))} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Segmented
              label="Payment status"
              value={status}
              onChange={setStatus}
              options={[
                { value: "PAID", label: "Paid" },
                { value: "PARTIAL", label: "Part paid" },
                { value: "UNPAID", label: "On credit" },
              ]}
            />
            {status !== "UNPAID" && <Segmented label="Paid by" value={method} onChange={setMethod} options={SETTLEMENT_METHODS.map((m) => ({ value: m, label: m === "CASH" ? "Cash" : m === "OTHER" ? "Other" : m === "CARD" ? "Card" : "UPI" }))} />}
            {status === "PARTIAL" && (
              <Field id="ppaid" label="Amount paid now">
                <AmountInput id="ppaid" value={paid} onChange={setPaid} />
              </Field>
            )}
            <Field id="pnotes" label="Notes" optional>
              <Textarea id="pnotes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            {pricing && (
              <dl className="space-y-1 rounded-xl bg-muted/60 p-3 text-[13.5px]">
                <div className="flex justify-between text-muted-foreground">
                  <dt>Taxable</dt>
                  <dd><Money paise={pricing.taxablePaise} /></dd>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <dt>GST (input)</dt>
                  <dd><Money paise={pricing.taxPaise} /></dd>
                </div>
                <div className="flex justify-between border-t pt-1.5 text-[17px] font-bold">
                  <dt>Total</dt>
                  <dd><Money paise={pricing.totalPaise} /></dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t bg-card/95 p-3 backdrop-blur md:static md:mt-4 md:border-0 md:bg-transparent md:p-0">
        <Button size="xl" className="w-full" onClick={save} loading={saving} disabled={!lines.length}>
          <CheckCircle2Icon /> Save purchase {pricing ? <>· <Money paise={pricing.totalPaise} compact /></> : null}
        </Button>
      </div>
      <PartyPicker kind="supplier" open={pickSupplier} onOpenChange={setPickSupplier} selectedId={supplier?.id} onSelect={setSupplier} />
    </div>
  );
}
