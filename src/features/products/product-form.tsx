"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { AmountInput } from "@/components/shared/amount-input";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useSession } from "@/features/session/session-context";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import { api, apiGet, ApiError, errorMessage } from "@/lib/api";
import type { Category, ProductDetail } from "@/lib/api-types";
import { GST_RATES_BP, PRODUCT_UNITS } from "@/lib/domain";
import { formatGstRate } from "@/lib/pricing";
import { fromMilli, toMilli } from "@/lib/qty";
import { cn } from "@/lib/utils";

interface FormState {
  name: string;
  categoryName: string;
  brand: string;
  unit: string;
  sellingPricePaise: number | null;
  mrpPaise: number | null;
  purchasePricePaise: number | null;
  gstRateBp: number;
  hsnCode: string;
  sku: string;
  barcode: string;
  openingStock: string;
  lowStock: string;
  trackStock: boolean;
  aliases: string[];
  units: Array<{ name: string; factor: string }>;
}

function fromDetail(d: ProductDetail): FormState {
  const p = d.product;
  return {
    name: p.name,
    categoryName: d.category?.name ?? "",
    brand: p.brand ?? "",
    unit: p.unit,
    sellingPricePaise: p.sellingPricePaise,
    mrpPaise: p.mrpPaise,
    purchasePricePaise: p.purchasePricePaise,
    gstRateBp: p.gstRateBp,
    hsnCode: p.hsnCode ?? "",
    sku: p.sku ?? "",
    barcode: p.barcode ?? "",
    openingStock: "",
    lowStock: String(fromMilli(p.lowStockThresholdMilli)),
    trackStock: p.trackStock,
    aliases: d.aliases.map((a) => a.alias),
    units: d.units.map((u) => ({ name: u.name, factor: String(fromMilli(u.factorMilli)) })),
  };
}

export function ProductForm({ existing, initialName }: { existing?: ProductDetail; initialName?: string }) {
  const me = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const idem = useIdempotencyKey();
  const cats = useQuery({ queryKey: ["products", "categories"], queryFn: ({ signal }) => apiGet<Category[]>("/products/categories", signal) });
  const [f, setF] = React.useState<FormState>(() =>
    existing
      ? fromDetail(existing)
      : {
          name: initialName ?? "",
          categoryName: "",
          brand: "",
          unit: "pcs",
          sellingPricePaise: null,
          mrpPaise: null,
          purchasePricePaise: null,
          gstRateBp: 0,
          hsnCode: "",
          sku: "",
          barcode: "",
          openingStock: "",
          lowStock: String(fromMilli(me.settings.defaultLowStockMilli)),
          trackStock: true,
          aliases: [],
          units: [],
        },
  );
  const [aliasDraft, setAliasDraft] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = "Enter a product name";
    if (f.sellingPricePaise === null) e.sellingPricePaise = "Enter the selling price";
    if (f.mrpPaise && f.sellingPricePaise && f.sellingPricePaise > f.mrpPaise) e.sellingPricePaise = "Selling price can't be more than MRP";
    if (f.openingStock && toMilli(f.openingStock) === null) e.openingStock = "Enter a valid quantity";
    if (f.lowStock && toMilli(f.lowStock) === null) e.lowStock = "Enter a valid quantity";
    if (f.hsnCode && !/^(\d{4}|\d{6}|\d{8})$/.test(f.hsnCode)) e.hsnCode = "HSN must be 4, 6 or 8 digits";
    f.units.forEach((u, i) => {
      if (u.name && (toMilli(u.factor) ?? 0) <= 0) e[`unit${i}`] = "How many base units?";
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setSaving(true);
    const body = {
      name: f.name.trim(),
      categoryName: f.categoryName.trim() || null,
      ...(existing && !f.categoryName.trim() ? { categoryId: null } : {}),
      brand: f.brand.trim() || null,
      unit: f.unit,
      sellingPricePaise: f.sellingPricePaise ?? 0,
      mrpPaise: f.mrpPaise,
      purchasePricePaise: f.purchasePricePaise ?? 0,
      gstRateBp: f.gstRateBp,
      hsnCode: f.hsnCode.trim() || null,
      sku: f.sku.trim() || null,
      barcode: f.barcode.trim() || null,
      lowStockThresholdMilli: f.trackStock ? (toMilli(f.lowStock || "0") ?? 0) : 0,
      trackStock: f.trackStock,
      aliases: f.aliases,
      units: f.units.filter((u) => u.name.trim()).map((u) => ({ name: u.name.trim().toLowerCase(), factorMilli: toMilli(u.factor) ?? 1000 })),
      ...(!existing ? { openingStockMilli: f.trackStock ? (toMilli(f.openingStock || "0") ?? 0) : 0 } : {}),
    };
    try {
      if (existing) {
        await api(`/products/${existing.product.id}`, { method: "PATCH", body });
        toast.success("Product updated");
        await qc.invalidateQueries({ queryKey: ["products"] });
        router.push(`/inventory/${existing.product.id}`);
      } else {
        const r = await api<{ id: string }>("/products", { method: "POST", body, idempotencyKey: idem.get() });
        idem.reset();
        toast.success(`${body.name} added`);
        await qc.invalidateQueries({ queryKey: ["products"] });
        router.push(`/inventory/${r.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        const e: Record<string, string> = {};
        for (const d of err.details as Array<{ path: string; message: string }>) e[d.path] = d.message;
        setErrors(e);
      }
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const addAlias = () => {
    const a = aliasDraft.trim();
    if (a && !f.aliases.includes(a)) set("aliases", [...f.aliases, a]);
    setAliasDraft("");
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4 pb-24 md:pb-0">
      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="name" label="Product name" error={errors.name} className="sm:col-span-2">
            <Input id="name" autoFocus={!existing} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Coke 500ml" aria-invalid={!!errors.name} />
          </Field>
          <Field id="category" label="Category" optional>
            <Input id="category" list="category-options" value={f.categoryName} onChange={(e) => set("categoryName", e.target.value)} placeholder="Cold Drinks" />
            <datalist id="category-options">
              {cats.data?.map((c) => <option key={c.id} value={c.name} />)}
            </datalist>
          </Field>
          <Field id="brand" label="Brand" optional>
            <Input id="brand" value={f.brand} onChange={(e) => set("brand", e.target.value)} placeholder="Coca-Cola" />
          </Field>
          <Field id="unit" label="Sold by">
            <NativeSelect id="unit" value={f.unit} onChange={(e) => set("unit", e.target.value)}>
              {[...new Set([...PRODUCT_UNITS, "service", "cup", f.unit])].map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5">
            <div>
              <p className="text-[14px] font-medium">Track stock</p>
              <p className="text-[12px] text-muted-foreground">Turn off for services (haircut, chai)</p>
            </div>
            <Switch checked={f.trackStock} onCheckedChange={(v) => set("trackStock", v)} aria-label="Track stock" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Price & GST</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field id="selling" label="Selling price" error={errors.sellingPricePaise} hint={me.settings.pricesIncludeGst ? "Including GST" : "Before GST"}>
            <AmountInput id="selling" value={f.sellingPricePaise} onChange={(v) => set("sellingPricePaise", v)} aria-invalid={!!errors.sellingPricePaise} />
          </Field>
          <Field id="mrp" label="MRP" optional>
            <AmountInput id="mrp" value={f.mrpPaise} onChange={(v) => set("mrpPaise", v)} />
          </Field>
          <Field id="purchase" label="Purchase price" optional hint="Your cost before GST">
            <AmountInput id="purchase" value={f.purchasePricePaise} onChange={(v) => set("purchasePricePaise", v)} />
          </Field>
          <div className="space-y-1.5 sm:col-span-3">
            <span className="text-[13px] font-medium">GST rate</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="GST rate">
              {GST_RATES_BP.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={f.gstRateBp === r}
                  onClick={() => set("gstRateBp", r)}
                  className={cn("h-10 min-w-14 rounded-xl border px-3 text-[13.5px] font-semibold", f.gstRateBp === r ? "border-primary bg-primary-soft text-primary-soft-foreground" : "bg-card hover:bg-accent")}
                >
                  {formatGstRate(r)}
                </button>
              ))}
            </div>
          </div>
          <Field id="hsn" label="HSN code" optional error={errors.hsnCode}>
            <Input id="hsn" inputMode="numeric" value={f.hsnCode} onChange={(e) => set("hsnCode", e.target.value.replace(/\D/g, ""))} placeholder="2202" />
          </Field>
          <Field id="sku" label="SKU" optional error={errors.sku}>
            <Input id="sku" value={f.sku} onChange={(e) => set("sku", e.target.value)} />
          </Field>
          <Field id="barcode" label="Barcode" optional error={errors.barcode}>
            <Input id="barcode" inputMode="numeric" value={f.barcode} onChange={(e) => set("barcode", e.target.value)} placeholder="Scan or type" />
          </Field>
        </CardContent>
      </Card>

      {f.trackStock && (
        <Card>
          <CardHeader>
            <CardTitle>Stock</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {!existing && (
              <Field id="opening" label={`Opening stock (${f.unit})`} error={errors.openingStock} hint="How many do you have right now?">
                <Input id="opening" inputMode="decimal" value={f.openingStock} onChange={(e) => set("openingStock", e.target.value)} placeholder="0" />
              </Field>
            )}
            <Field id="low" label={`Low stock alert at (${f.unit})`} error={errors.lowStock}>
              <Input id="low" inputMode="decimal" value={f.lowStock} onChange={(e) => set("lowStock", e.target.value)} />
            </Field>
            {existing && <p className="text-[13px] text-muted-foreground sm:col-span-2">To change the stock quantity, use “Adjust stock” on the product page — every change is recorded.</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Voice names & packs</CardTitle>
            <p className="text-[13px] text-muted-foreground">Help DukaanOS understand what you call this product.</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <span className="text-[13px] font-medium">Other names (aliases)</span>
            <div className="flex flex-wrap gap-2">
              {f.aliases.map((a) => (
                <span key={a} className="inline-flex h-8 items-center gap-1 rounded-full bg-primary-soft pr-1 pl-3 text-[13px] font-medium text-primary-soft-foreground">
                  {a}
                  <button type="button" aria-label={`Remove ${a}`} className="rounded-full p-1 hover:bg-primary/10" onClick={() => set("aliases", f.aliases.filter((x) => x !== a))}>
                    <XIcon className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                aria-label="Add alias"
                placeholder="e.g. Coke, कोक, Coke bottle"
                value={aliasDraft}
                onChange={(e) => setAliasDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addAlias();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addAlias}>
                Add
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <span className="text-[13px] font-medium">Packs (e.g. 1 crate = 24 {f.unit})</span>
            {f.units.map((u, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-3 text-[14px]">1</span>
                <Input aria-label="Pack name" className="w-28" placeholder="crate" value={u.name} onChange={(e) => set("units", f.units.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <span className="mt-3 text-[14px]">=</span>
                <div className="flex-1">
                  <Input aria-label="Quantity per pack" inputMode="decimal" placeholder="24" value={u.factor} onChange={(e) => set("units", f.units.map((x, j) => (j === i ? { ...x, factor: e.target.value } : x)))} aria-invalid={!!errors[`unit${i}`]} />
                </div>
                <span className="mt-3 text-[14px] text-muted-foreground">{f.unit}</span>
                <Button type="button" variant="ghost" size="icon" aria-label="Remove pack" onClick={() => set("units", f.units.filter((_, j) => j !== i))}>
                  <XIcon />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => set("units", [...f.units, { name: "", factor: "" }])}>
              <PlusIcon /> Add pack size
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t bg-card/95 p-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
        <div className="flex gap-2 md:justify-end">
          <Button type="button" variant="outline" className="flex-1 md:flex-none" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" size="lg" className="flex-[2] md:flex-none" loading={saving}>
            {existing ? "Save changes" : "Add product"}
          </Button>
        </div>
      </div>
    </form>
  );
}
