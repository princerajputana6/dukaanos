"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookUserIcon, CheckCircle2Icon, CloudOffIcon, PackageSearchIcon, ReceiptIcon, SearchIcon, ShoppingCartIcon, Trash2Icon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { AmountInput } from "@/components/shared/amount-input";
import { Money, Qty } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { QtyStepper } from "@/components/shared/qty-stepper";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { Segmented } from "@/components/ui/segmented";
import { useSession } from "@/features/session/session-context";
import { matchProducts, PartyPicker, useProductCatalog } from "@/features/shared/pickers";
import { SALE_DRAFT_KEY, useVoiceDraft } from "@/features/voice/use-assistant";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { apiGet, errorMessage } from "@/lib/api";
import type { CustomerDetail, ProductListItem, SaleResult } from "@/lib/api-types";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/domain";
import { formatMoney } from "@/lib/money";
import { submitOrQueue } from "@/lib/offline/submit";
import { priceDocument, PricingError } from "@/lib/pricing";
import { formatQty } from "@/lib/qty";
import { cn } from "@/lib/utils";

interface CartLine {
  product: ProductListItem;
  quantityMilli: number;
  unitPricePaise: number;
}

interface SaleDraft {
  items: Array<{ productId: string; quantityMilli: number; unitPricePaise?: number }>;
  customerId?: string | null;
  payment?: { method?: PaymentMethod };
}

type Done = { kind: "saved"; sale: SaleResult } | { kind: "queued"; totalPaise: number };

export function NewSale() {
  const me = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const catalog = useProductCatalog();
  const idem = useIdempotencyKey();
  const [q, setQ] = React.useState("");
  const [cart, setCart] = React.useState<CartLine[]>([]);
  const [customer, setCustomer] = React.useState<{ id: string; name: string; balancePaise: number } | null>(null);
  const [pickCustomer, setPickCustomer] = React.useState(false);
  const [checkout, setCheckout] = React.useState(false);
  const [method, setMethod] = React.useState<PaymentMethod>("CASH");
  const [paid, setPaid] = React.useState<number | null>(null);
  const [discount, setDiscount] = React.useState<number | null>(null);
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState<Done | null>(null);
  const [editPrice, setEditPrice] = React.useState<CartLine | null>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  // Prefill from a voice proposal ("Edit"), applied once when the catalogue is ready.
  const draft = useVoiceDraft<SaleDraft>(SALE_DRAFT_KEY, params.get("draft") === "1");
  const [draftApplied, setDraftApplied] = React.useState(false);
  if (draft && catalog.data && !draftApplied) {
    setDraftApplied(true);
    setCart(
      draft.items
        .map((i) => {
          const product = catalog.data.items.find((p) => p.id === i.productId);
          return product ? { product, quantityMilli: i.quantityMilli, unitPricePaise: i.unitPricePaise ?? product.sellingPricePaise } : null;
        })
        .filter((l): l is CartLine => !!l),
    );
    if (draft.payment?.method) setMethod(draft.payment.method);
  }
  const draftCustomer = useQuery({
    queryKey: ["customers", "detail", draft?.customerId],
    queryFn: ({ signal }) => apiGet<CustomerDetail>(`/customers/${draft!.customerId}`, signal),
    enabled: !!draft?.customerId,
  });
  const [draftCustomerApplied, setDraftCustomerApplied] = React.useState(false);
  if (draftCustomer.data && !draftCustomerApplied) {
    setDraftCustomerApplied(true);
    const c = draftCustomer.data.customer;
    setCustomer({ id: c.id, name: c.name, balancePaise: c.balancePaise });
  }

  const results = React.useMemo(() => matchProducts(catalog.data?.items ?? [], q).slice(0, 60), [catalog.data, q]);

  const add = (p: ProductListItem) => {
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, quantityMilli: l.quantityMilli + 1000 } : l));
      return [...c, { product: p, quantityMilli: 1000, unitPricePaise: p.sellingPricePaise }];
    });
    navigator.vibrate?.(8);
  };

  const pricing = React.useMemo(() => {
    if (!cart.length) return null;
    try {
      return priceDocument({
        lines: cart.map((l) => ({ unitPricePaise: l.unitPricePaise, quantityMilli: l.quantityMilli, gstRateBp: l.product.gstRateBp })),
        billDiscountPaise: discount ?? 0,
        pricesIncludeGst: me.settings.pricesIncludeGst,
        interstate: false,
      });
    } catch (e) {
      return e instanceof PricingError ? { error: e.message } : null;
    }
  }, [cart, discount, me.settings.pricesIncludeGst]);
  const total = pricing && !("error" in pricing) ? pricing.totalPaise : 0;
  const received = method === "CREDIT" ? 0 : (paid ?? total);
  const udhaar = Math.max(0, total - received);
  const stockIssues = cart.filter((l) => l.product.trackStock && !me.settings.allowNegativeStock && l.quantityMilli > l.product.currentStockMilli);

  const submit = async () => {
    if (!cart.length || !pricing || "error" in pricing) return;
    if (udhaar > 0 && !customer) {
      toast.error("Choose a customer to record udhaar.");
      setPickCustomer(true);
      return;
    }
    setSubmitting(true);
    const body = {
      items: cart.map((l) => ({
        productId: l.product.id,
        quantityMilli: l.quantityMilli,
        ...(l.unitPricePaise !== l.product.sellingPricePaise ? { unitPricePaise: l.unitPricePaise } : {}),
      })),
      customerId: customer?.id ?? null,
      billDiscountPaise: discount ?? 0,
      payment: { method, ...(method !== "CREDIT" && paid !== null ? { paidPaise: paid } : {}) },
      notes: notes.trim() || null,
    };
    try {
      const r = await submitOrQueue<SaleResult>({
        type: "CREATE_SALE",
        label: `Sale · ${formatMoney(total, { compact: true })} · ${cart.length} item${cart.length > 1 ? "s" : ""}`,
        path: "/sales",
        payload: body,
        idempotencyKey: idem.get(),
        businessId: me.business.id,
        offlineEnabled: me.flags.OFFLINE_ENABLED,
      });
      idem.reset();
      setCheckout(false);
      if (r.queued) {
        setDone({ kind: "queued", totalPaise: total });
      } else {
        setDone({ kind: "saved", sale: r.data });
        await qc.invalidateQueries();
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setCart([]);
    setCustomer(null);
    setMethod("CASH");
    setPaid(null);
    setDiscount(null);
    setNotes("");
    setDone(null);
    setQ("");
    searchRef.current?.focus();
  };

  if (done) {
    return (
      <div className="mx-auto max-w-md py-8 text-center">
        {done.kind === "saved" ? (
          <>
            <CheckCircle2Icon className="mx-auto size-16 text-success" aria-hidden="true" />
            <h1 className="mt-4 text-2xl font-semibold">Sale saved ✓</h1>
            <p className="mt-1 text-muted-foreground">
              {done.sale.invoiceNumber} · <Money paise={done.sale.totalPaise} />
              {done.sale.creditPaise > 0 && (
                <>
                  {" "}
                  · Udhaar <Money paise={done.sale.creditPaise} />
                </>
              )}
            </p>
            <ul className="mx-auto mt-4 max-w-xs space-y-1 text-left text-[13.5px]">
              {done.sale.lines
                .filter((l) => l.trackStock)
                .map((l) => (
                  <li key={l.productName} className="flex justify-between">
                    <span className="text-muted-foreground">{l.productName}</span>
                    <span>
                      <Qty milli={Math.max(0, l.stockAfterMilli)} unit={l.unit} /> left
                    </span>
                  </li>
                ))}
            </ul>
          </>
        ) : (
          <>
            <CloudOffIcon className="mx-auto size-16 text-warning" aria-hidden="true" />
            <h1 className="mt-4 text-2xl font-semibold">Saved offline</h1>
            <p className="mt-1 text-muted-foreground">
              <Money paise={done.totalPaise} /> — this sale will sync when you&apos;re back online. It is <strong>pending</strong> until then.
            </p>
          </>
        )}
        <div className="mt-8 grid grid-cols-2 gap-2">
          {done.kind === "saved" ? (
            <Button variant="outline" asChild>
              <Link href={`/sales/${done.sale.id}`}>View bill</Link>
            </Button>
          ) : (
            <Button variant="outline" onClick={() => router.push("/sales")}>
              All sales
            </Button>
          )}
          <Button onClick={reset} autoFocus>
            New sale
          </Button>
        </div>
      </div>
    );
  }

  const cartPanel = (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setPickCustomer(true)}
        className="flex min-h-12 items-center gap-3 rounded-xl border bg-card px-3.5 text-left hover:bg-accent"
      >
        <BookUserIcon className="size-5 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold">{customer ? customer.name : "Walk-in customer"}</span>
          <span className="block text-[12px] text-muted-foreground">{customer ? (customer.balancePaise > 0 ? `Baki ${formatMoney(customer.balancePaise, { compact: true })}` : "Tap to change") : "Add customer for udhaar / khata"}</span>
        </span>
        {customer && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Remove customer"
            onClick={(e) => (e.stopPropagation(), setCustomer(null))}
            onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), setCustomer(null))}
            className="rounded-lg p-1.5 hover:bg-muted"
          >
            <XIcon className="size-4" />
          </span>
        )}
      </button>
      {cart.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          <ShoppingCartIcon className="mx-auto mb-2 size-7 opacity-60" aria-hidden="true" />
          Tap products to add them to the bill.
        </div>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {cart.map((l) => {
            const over = l.product.trackStock && l.quantityMilli > l.product.currentStockMilli;
            return (
              <li key={l.product.id} className="flex flex-col gap-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[14.5px] font-semibold">{l.product.name}</p>
                    <button type="button" className="text-[12.5px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => setEditPrice(l)}>
                      @ {formatMoney(l.unitPricePaise, { compact: true })} / {l.product.unit}
                      {l.unitPricePaise !== l.product.sellingPricePaise && " (changed)"}
                    </button>
                    {over && (
                      <p className="text-[12px] font-medium text-destructive">
                        Only {formatQty(Math.max(0, l.product.currentStockMilli))} in stock
                      </p>
                    )}
                  </div>
                  <Money paise={Math.round((l.unitPricePaise * l.quantityMilli) / 1000)} className="text-[14.5px] font-semibold" />
                </div>
                <div className="flex items-center justify-between">
                  <QtyStepper
                    size="sm"
                    label={`${l.product.name} quantity`}
                    value={l.quantityMilli}
                    min={0}
                    onChange={(v) => setCart((c) => (v <= 0 ? c.filter((x) => x.product.id !== l.product.id) : c.map((x) => (x.product.id === l.product.id ? { ...x, quantityMilli: v } : x))))}
                  />
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${l.product.name}`} onClick={() => setCart((c) => c.filter((x) => x.product.id !== l.product.id))}>
                    <Trash2Icon className="text-muted-foreground" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  return (
    <div className="pb-28 md:pb-0">
      <PageHeader title="New sale" back={{ href: "/sales", label: "Sales" }} />
      {draftApplied && (
        <p role="status" className="mb-3 rounded-xl bg-info-soft px-3.5 py-2.5 text-[13.5px] text-info">
          Loaded from your voice command — review and confirm.
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-[1fr_380px]">
        <section aria-label="Products" className="min-w-0">
          <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 -mx-4 bg-background/95 px-4 pb-3 backdrop-blur md:static md:mx-0 md:px-0">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                ref={searchRef}
                autoFocus
                className="h-12 pl-10 text-[16px]"
                placeholder="Search or scan barcode…"
                aria-label="Search products"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && results.length === 1) {
                    add(results[0]!);
                    setQ("");
                  }
                }}
              />
            </div>
          </div>
          {catalog.isError ? (
            <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} />
          ) : catalog.isLoading ? (
            <ListSkeleton rows={6} />
          ) : !catalog.data?.items.length ? (
            <EmptyState icon={PackageSearchIcon} title="Your inventory is empty." description="Add products to start billing." action={<Button asChild><Link href="/products/new">Add Product</Link></Button>} />
          ) : results.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No product matches “{q}”.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {results.map((p) => {
                const inCart = cart.find((l) => l.product.id === p.id);
                const out = p.trackStock && p.currentStockMilli <= 0;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => add(p)}
                      className={cn(
                        "relative flex h-full min-h-[84px] w-full flex-col justify-between rounded-2xl border bg-card p-3 text-left shadow-soft transition-all active:scale-[0.98]",
                        inCart ? "border-primary ring-2 ring-primary/20" : "hover:border-primary/40",
                        out && "opacity-60",
                      )}
                    >
                      <span className="line-clamp-2 text-[14px] leading-snug font-semibold">{p.name}</span>
                      <span className="mt-1.5 flex items-end justify-between gap-1">
                        <Money paise={p.sellingPricePaise} compact className="text-[14px] font-bold text-primary" />
                        <span className={cn("text-[11.5px]", out ? "font-semibold text-destructive" : "text-muted-foreground")}>
                          {p.trackStock ? (out ? "Out" : `${formatQty(p.currentStockMilli)} ${p.unit}`) : ""}
                        </span>
                      </span>
                      {inCart && (
                        <span className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground">
                          {formatQty(inCart.quantityMilli)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Desktop cart */}
        <aside aria-label="Bill" className="hidden md:block">
          <div className="sticky top-24 space-y-3">
            {cartPanel}
            {cart.length > 0 && (
              <Button size="xl" className="w-full" onClick={() => setCheckout(true)}>
                <ReceiptIcon /> Checkout · <Money paise={total} compact />
              </Button>
            )}
          </div>
        </aside>
      </div>

      {/* Mobile sticky checkout bar */}
      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t bg-card/95 p-3 backdrop-blur md:hidden">
          <Button size="xl" className="w-full justify-between" onClick={() => setCheckout(true)}>
            <span className="flex items-center gap-2">
              <ShoppingCartIcon /> {cart.length} item{cart.length > 1 ? "s" : ""}
            </span>
            <span className="flex items-center gap-1.5">
              <Money paise={total} compact /> · Checkout
            </span>
          </Button>
        </div>
      )}

      <ResponsiveModal open={checkout} onOpenChange={setCheckout} title="Checkout" description={customer ? `Bill for ${customer.name}` : "Walk-in customer"}>
        <div className="flex flex-col gap-4 pb-2">
          <div className="md:hidden">{cartPanel}</div>
          <div className="space-y-2">
            <Label>Payment</Label>
            <Segmented
              label="Payment method"
              value={method}
              onChange={(m) => {
                setMethod(m);
                setPaid(null);
              }}
              columns={3}
              options={PAYMENT_METHODS.map((m) => ({ value: m, label: m === "CREDIT" ? "Udhaar" : PAYMENT_METHOD_LABELS[m] }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {method !== "CREDIT" && (
              <div className="space-y-1.5">
                <Label htmlFor="paid">Received</Label>
                <AmountInput id="paid" value={paid ?? total} onChange={(v) => setPaid(v)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="discount">Discount</Label>
              <AmountInput id="discount" value={discount} onChange={setDiscount} placeholder="0" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Note</Label>
            <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
          {pricing && !("error" in pricing) && (
            <dl className="space-y-1 rounded-xl bg-muted/60 p-3 text-[13.5px]">
              <Row label="Items total" value={pricing.subtotalPaise} />
              {pricing.discountPaise > 0 && <Row label="Discount" value={-pricing.discountPaise} />}
              {pricing.taxPaise > 0 && <Row label={me.settings.pricesIncludeGst ? "GST (included)" : "GST"} value={pricing.taxPaise} muted />}
              <div className="flex justify-between border-t pt-1.5 text-[17px] font-bold">
                <dt>Total</dt>
                <dd>
                  <Money paise={pricing.totalPaise} />
                </dd>
              </div>
              {udhaar > 0 && <Row label={customer ? `Udhaar to ${customer.name}` : "Udhaar (choose customer)"} value={udhaar} warn />}
            </dl>
          )}
          {pricing && "error" in pricing && <p className="text-sm text-destructive">{pricing.error}</p>}
          {stockIssues.length > 0 && (
            <p className="rounded-xl bg-destructive-soft px-3 py-2 text-[13px] text-destructive">
              Not enough stock for {stockIssues.map((s) => s.product.name).join(", ")}.
            </p>
          )}
          <Button size="xl" className="w-full" onClick={submit} loading={submitting} disabled={!cart.length || stockIssues.length > 0 || (pricing != null && "error" in pricing)}>
            <CheckCircle2Icon /> Confirm Sale · <Money paise={total} compact />
          </Button>
        </div>
      </ResponsiveModal>

      <PartyPicker kind="customer" open={pickCustomer} onOpenChange={setPickCustomer} selectedId={customer?.id} onSelect={(p) => setCustomer(p)} />
      <PriceEditor line={editPrice} onClose={() => setEditPrice(null)} onSave={(price) => setCart((c) => c.map((l) => (l.product.id === editPrice?.product.id ? { ...l, unitPricePaise: price } : l)))} />
    </div>
  );
}

function Row({ label, value, muted, warn }: { label: string; value: number; muted?: boolean; warn?: boolean }) {
  return (
    <div className={cn("flex justify-between", muted && "text-muted-foreground", warn && "font-semibold text-warning-foreground")}>
      <dt>{label}</dt>
      <dd>
        <Money paise={value} />
      </dd>
    </div>
  );
}

function PriceEditor({ line, onClose, onSave }: { line: CartLine | null; onClose: () => void; onSave: (p: number) => void }) {
  const [v, setV] = React.useState<number | null>(null);
  return (
    <ResponsiveModal
      open={!!line}
      onOpenChange={(o) => !o && (onClose(), setV(null))}
      title={`Price for ${line?.product.name ?? ""}`}
      description={line ? `Usual price ${formatMoney(line.product.sellingPricePaise)}${line.product.mrpPaise ? ` · MRP ${formatMoney(line.product.mrpPaise)}` : ""}` : undefined}
      footer={
        <Button
          onClick={() => {
            if (v !== null && v >= 0) onSave(v);
            onClose();
            setV(null);
          }}
        >
          Save price
        </Button>
      }
    >
      {line && <AmountInput autoFocus aria-label="Price per unit" value={v ?? line.unitPricePaise} onChange={setV} />}
    </ResponsiveModal>
  );
}
