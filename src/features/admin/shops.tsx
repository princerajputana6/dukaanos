"use client";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, FileUpIcon, PlusCircleIcon, PlusIcon, SearchIcon, StoreIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { AmountInput } from "@/components/shared/amount-input";
import { Field } from "@/components/shared/field";
import { LoadMore } from "@/components/shared/load-more";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { PasswordInput } from "@/components/shared/password-input";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { useUrlState } from "@/components/shared/url-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { useDebounced } from "@/hooks/use-debounced";
import { api, ApiError, apiGet, errorMessage, qs } from "@/lib/api";
import type { AdminCreateShopResult, AdminShopList, AdminTenantDetail, AdminTenantList } from "@/lib/api-types";
import { formatRelative } from "@/lib/dates";
import { BUSINESS_TYPES, INDIAN_STATES, LICENSE_PLANS, LICENSE_PLAN_KEYS, type LicensePlan } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./badges";
import { useAgencies } from "./tenants";

export function ShopsList() {
  const url = useUrlState();
  const status = url.get("status") ?? "";
  const [q, setQ] = React.useState("");
  const dq = useDebounced(q, 250);
  const list = useInfiniteQuery({
    queryKey: ["admin", "shops", status, dq],
    queryFn: ({ pageParam, signal }) => apiGet<AdminShopList>(`/admin/shops${qs({ status: status || undefined, q: dq || undefined, cursor: pageParam })}`, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div>
      <PageHeader
        title="Shops & branches"
        description="Every shop on the platform. A tenant with several shops has branches."
        actions={
          <Button asChild>
            <Link href="/admin/shops/new">
              <PlusCircleIcon /> Create shop
            </Link>
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input className="pl-10" placeholder="Search shop, city or account" aria-label="Search shops" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <NativeSelect aria-label="Status" className="sm:w-48" value={status} onChange={(e) => url.set({ status: e.target.value || null })}>
          <option value="">Active & suspended</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="ARCHIVED">Archived</option>
        </NativeSelect>
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState icon={StoreIcon} title="No shops match." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border bg-card">
            <table className="w-full min-w-[720px] text-[14px]">
              <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Shop</th>
                  <th className="px-3 py-2.5 font-medium">Account</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 text-right font-medium">Products</th>
                  <th className="px-3 py-2.5 text-right font-medium">Sales (30d)</th>
                  <th className="px-4 py-2.5 text-right font-medium">Last sale</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((s) => (
                  <tr key={s.id} className="hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <span className="font-semibold">{s.name}</span>
                      <span className="block text-[12px] text-muted-foreground">
                        {s.branchCode ?? "MAIN"} · {BUSINESS_TYPES.find((b) => b.value === s.type)?.label ?? s.type} · {s.city ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {s.tenantId ? (
                        <Link href={`/admin/tenants/${s.tenantId}`} className="hover:text-primary">
                          {s.tenantName}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-3 py-3 text-right">{s.products}</td>
                    <td className="px-3 py-3 text-right">
                      <Money paise={s.sales30Paise} compact />
                    </td>
                    <td className="px-4 py-3 text-right text-[13px] text-muted-foreground">{s.lastSaleAt ? formatRelative(s.lastSaleAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />
        </>
      )}
    </div>
  );
}

interface PartyRow {
  name: string;
  phone: string;
  openingBalancePaise: number | null;
}

/** Super admin wizard: account → owner → shop → initial data. */
export function CreateShopWizard() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const agencies = useAgencies();
  const presetTenant = params.get("tenant");
  const [tenantMode, setTenantMode] = React.useState<"new" | "existing">(presetTenant ? "existing" : "new");
  const [tenantId, setTenantId] = React.useState(presetTenant ?? "");
  const [tenantQ, setTenantQ] = React.useState("");
  const dTenantQ = useDebounced(tenantQ, 250);
  const tenantSearch = useQuery({
    queryKey: ["admin", "tenants", "picker", dTenantQ],
    queryFn: ({ signal }) => apiGet<AdminTenantList>(`/admin/tenants${qs({ q: dTenantQ || undefined, limit: 10 })}`, signal),
    enabled: tenantMode === "existing" && !tenantId,
  });
  const chosenTenant = useQuery({
    queryKey: ["admin", "tenant", tenantId],
    queryFn: ({ signal }) => apiGet<AdminTenantDetail>(`/admin/tenants/${tenantId}`, signal),
    enabled: tenantMode === "existing" && !!tenantId,
  });

  const [account, setAccount] = React.useState({ name: "", agencyId: "", plan: "TRIAL" as LicensePlan, validUntil: "" });
  const [ownerMode, setOwnerMode] = React.useState<"new" | "existing">("new");
  const [owner, setOwner] = React.useState({ name: "", mobile: "", email: "", password: "" });
  const [shop, setShop] = React.useState({ name: "", type: "grocery", city: "", stateCode: "", address: "", branchCode: "", gstin: "" });
  const [sample, setSample] = React.useState(true);
  const [copyFrom, setCopyFrom] = React.useState("");
  const [csv, setCsv] = React.useState<{ name: string; text: string } | null>(null);
  const [customers, setCustomers] = React.useState<PartyRow[]>([]);
  const [suppliers, setSuppliers] = React.useState<PartyRow[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<(AdminCreateShopResult & { ownerMobile: string | null }) | null>(null);

  const submit = async () => {
    setErrors({});
    setBusy(true);
    const clean = (rows: PartyRow[]) => rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), phone: r.phone.trim() || null, openingBalancePaise: r.openingBalancePaise ?? 0 }));
    const body = {
      tenant:
        tenantMode === "new"
          ? { mode: "new", name: account.name, agencyId: account.agencyId || null, plan: account.plan, ...(account.validUntil ? { validUntil: account.validUntil } : {}) }
          : { mode: "existing", tenantId },
      ...(tenantMode === "new"
        ? { owner: ownerMode === "new" ? { mode: "new", name: owner.name, mobile: owner.mobile, email: owner.email || null, password: owner.password } : { mode: "existing", mobile: owner.mobile } }
        : {}),
      shop: { name: shop.name, type: shop.type, city: shop.city || null, stateCode: shop.stateCode || null, address: shop.address || null, branchCode: shop.branchCode || undefined, gstin: shop.gstin || null },
      initialData: { sampleProducts: sample, copyCatalogueFromShopId: copyFrom || null, productsCsv: csv?.text ?? null, customers: clean(customers), suppliers: clean(suppliers) },
    };
    try {
      const r = await api<AdminCreateShopResult>("/admin/shops", { method: "POST", body });
      setDone({ ...r, ownerMobile: tenantMode === "new" ? owner.mobile : null });
      await qc.invalidateQueries({ queryKey: ["admin"] });
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) setErrors(Object.fromEntries((err.details as Array<{ path: string; message: string }>).map((d) => [d.path, d.message])));
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-lg py-6 text-center">
        <CheckCircle2Icon className="mx-auto size-16 text-success" aria-hidden="true" />
        <h1 className="mt-3 text-2xl font-semibold">Shop created ✓</h1>
        <p className="mt-1 text-muted-foreground">
          {done.seeded.products} products{done.seeded.productErrors ? ` (${done.seeded.productErrors} CSV rows skipped)` : ""}, {done.seeded.customers} customers and {done.seeded.suppliers} suppliers loaded.
        </p>
        {done.ownerMobile && (
          <p className="mx-auto mt-4 max-w-sm rounded-xl bg-muted px-4 py-3 text-[14px]">
            The owner can log in now with mobile <strong>+91 {done.ownerMobile}</strong>
            {done.ownerCreated ? " and the password you set" : " and their existing password"}.
          </p>
        )}
        <div className="mt-6 grid grid-cols-2 gap-2">
          <Button variant="outline" asChild>
            <Link href={`/admin/tenants/${done.tenantId}`}>Open account</Link>
          </Button>
          <Button onClick={() => window.location.assign("/admin/shops/new")}>Create another</Button>
        </div>
      </div>
    );
  }

  const t = chosenTenant.data;
  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-24">
      <PageHeader title="Create shop" description="Set up an account, its owner and shop, and load the starting data." back={{ href: "/admin/shops", label: "Shops" }} />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>1 · Account (tenant)</CardTitle>
            <CardDescription>A new customer, or another branch for an existing account.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Segmented
            label="Account"
            value={tenantMode}
            onChange={(m) => {
              setTenantMode(m);
              setCopyFrom("");
            }}
            options={[
              { value: "new", label: "New account" },
              { value: "existing", label: "Existing account (add branch)" },
            ]}
          />
          {tenantMode === "new" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="a-name" label="Account / company name" error={errors["tenant.name"]} className="sm:col-span-2">
                <Input id="a-name" value={account.name} onChange={(e) => setAccount({ ...account, name: e.target.value })} placeholder="Sharma Traders" />
              </Field>
              <Field id="a-agency" label="Agency" optional>
                <NativeSelect id="a-agency" value={account.agencyId} onChange={(e) => setAccount({ ...account, agencyId: e.target.value })}>
                  <option value="">Direct (no agency)</option>
                  {agencies.data?.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="a-plan" label="Licence plan" hint={`${LICENSE_PLANS[account.plan].maxBranches} shop(s), ${LICENSE_PLANS[account.plan].maxUsers} users, ${LICENSE_PLANS[account.plan].days} days`}>
                <NativeSelect id="a-plan" value={account.plan} onChange={(e) => setAccount({ ...account, plan: e.target.value as LicensePlan })}>
                  {LICENSE_PLAN_KEYS.map((p) => (
                    <option key={p} value={p}>
                      {LICENSE_PLANS[p].label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="a-valid" label="Valid until" optional hint="Defaults to the plan length">
                <Input id="a-valid" type="date" value={account.validUntil} onChange={(e) => setAccount({ ...account, validUntil: e.target.value })} />
              </Field>
            </div>
          ) : tenantId && t ? (
            <div className="flex items-center justify-between rounded-xl border px-3.5 py-3">
              <span>
                <span className="block font-semibold">{t.tenant.name}</span>
                <span className="text-[13px] text-muted-foreground">
                  Owner {t.owner?.name} · {t.usage.branches} of {t.license?.maxBranches ?? "—"} shops used
                </span>
              </span>
              {!presetTenant && (
                <Button size="sm" variant="ghost" onClick={() => setTenantId("")}>
                  Change
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Input placeholder="Search account or owner" aria-label="Search accounts" value={tenantQ} onChange={(e) => setTenantQ(e.target.value)} />
              <ul className="max-h-60 divide-y overflow-y-auto rounded-xl border">
                {tenantSearch.data?.items.map((x) => (
                  <li key={x.id}>
                    <button type="button" className="flex w-full justify-between px-3.5 py-2.5 text-left hover:bg-accent" onClick={() => setTenantId(x.id)}>
                      <span className="font-medium">{x.name}</span>
                      <span className="text-[12.5px] text-muted-foreground">
                        {x.ownerName} · {x.branches}/{x.maxBranches ?? "—"} shops
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tenantMode === "existing" && t && t.license && t.usage.branches >= t.license.maxBranches && (
            <p className="rounded-xl bg-warning-soft px-3 py-2 text-[13px] text-warning-foreground">
              This account has used all {t.license.maxBranches} shop(s) on its licence.{" "}
              <Link href={`/admin/tenants/${t.tenant.id}`} className="font-semibold underline">
                Raise the branch limit
              </Link>{" "}
              first.
            </p>
          )}
        </CardContent>
      </Card>

      {tenantMode === "new" && (
        <Card>
          <CardHeader>
            <CardTitle>2 · Owner</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Segmented
              label="Owner"
              value={ownerMode}
              onChange={setOwnerMode}
              options={[
                { value: "new", label: "New login" },
                { value: "existing", label: "Already uses Suvakta" },
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {ownerMode === "new" && (
                <Field id="o-name" label="Owner name" error={errors["owner.name"]}>
                  <Input id="o-name" value={owner.name} onChange={(e) => setOwner({ ...owner, name: e.target.value })} />
                </Field>
              )}
              <Field id="o-mobile" label="Mobile (login)" error={errors["owner.mobile"]}>
                <Input id="o-mobile" type="tel" inputMode="numeric" value={owner.mobile} onChange={(e) => setOwner({ ...owner, mobile: e.target.value })} placeholder="98765 43210" />
              </Field>
              {ownerMode === "new" && (
                <>
                  <Field id="o-email" label="Email" optional error={errors["owner.email"]}>
                    <Input id="o-email" type="email" value={owner.email} onChange={(e) => setOwner({ ...owner, email: e.target.value })} />
                  </Field>
                  <Field id="o-pass" label="Temporary password" error={errors["owner.password"]} hint="Share it with the owner; they can change it in Settings → Security.">
                    <PasswordInput id="o-pass" autoComplete="new-password" value={owner.password} onChange={(e) => setOwner({ ...owner, password: e.target.value })} />
                  </Field>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{tenantMode === "new" ? "3" : "2"} · Shop</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field id="s-name" label="Shop name" error={errors["shop.name"]} className="sm:col-span-2">
            <Input id="s-name" value={shop.name} onChange={(e) => setShop({ ...shop, name: e.target.value })} placeholder={tenantMode === "existing" ? "Sharma Kirana — Malviya Nagar" : "Sharma General Store"} />
          </Field>
          <Field id="s-type" label="Type">
            <NativeSelect id="s-type" value={shop.type} onChange={(e) => setShop({ ...shop, type: e.target.value })}>
              {BUSINESS_TYPES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="s-code" label="Branch code" optional error={errors["shop.branchCode"]} hint="e.g. MAIN, JPR-2">
            <Input id="s-code" value={shop.branchCode} onChange={(e) => setShop({ ...shop, branchCode: e.target.value.toUpperCase() })} />
          </Field>
          <Field id="s-city" label="City" optional>
            <Input id="s-city" value={shop.city} onChange={(e) => setShop({ ...shop, city: e.target.value })} />
          </Field>
          <Field id="s-state" label="State" optional>
            <NativeSelect id="s-state" value={shop.stateCode} onChange={(e) => setShop({ ...shop, stateCode: e.target.value })}>
              <option value="">—</option>
              {INDIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="s-address" label="Address" optional className="sm:col-span-2">
            <Input id="s-address" value={shop.address} onChange={(e) => setShop({ ...shop, address: e.target.value })} />
          </Field>
          <Field id="s-gstin" label="GSTIN" optional error={errors["shop.gstin"]}>
            <Input id="s-gstin" maxLength={15} value={shop.gstin} onChange={(e) => setShop({ ...shop, gstin: e.target.value.toUpperCase() })} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{tenantMode === "new" ? "4" : "3"} · Initial data</CardTitle>
            <CardDescription>Loaded through the normal checks: opening stock is recorded as stock movements, and everything appears in the shop&apos;s audit log as “Import”.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3">
            <span>
              <span className="block text-[14.5px] font-medium">Sample product catalogue</span>
              <span className="block text-[12.5px] text-muted-foreground">Typical items for the shop type, with opening stock</span>
            </span>
            <Switch checked={sample} onCheckedChange={setSample} aria-label="Add sample products" />
          </label>
          {tenantMode === "existing" && t && t.shops.length > 0 && (
            <Field id="copy-from" label="Copy products from another branch" optional hint="Prices, GST, voice names and packs — stock starts at zero">
              <NativeSelect id="copy-from" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                <option value="">Don&apos;t copy</option>
                {t.shops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.products} products)
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <div className="space-y-1.5">
            <span className="text-[13px] font-medium">Products from CSV (optional)</span>
            <label className="flex min-h-16 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed bg-muted/40 px-4 text-[14px] hover:bg-muted">
              <FileUpIcon className="size-5 text-muted-foreground" aria-hidden="true" />
              {csv ? csv.name : "Choose CSV — name, selling_price, purchase_price, gst_rate, opening_stock…"}
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setCsv({ name: f.name, text: await f.text() });
                }}
              />
            </label>
            <a href="/api/products/import/template" className="text-[12.5px] font-semibold text-primary hover:underline" download>
              Download template
            </a>
          </div>
          <PartyRows title="Opening customers (khata)" balanceLabel="Old udhaar" rows={customers} onChange={setCustomers} />
          <PartyRows title="Suppliers" balanceLabel="Amount owed" rows={suppliers} onChange={setSuppliers} />
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 p-3 backdrop-blur lg:left-[260px]">
        <div className="mx-auto flex max-w-3xl justify-end">
          <Button size="lg" className="w-full sm:w-auto" loading={busy} onClick={submit} disabled={tenantMode === "existing" && !tenantId}>
            <StoreIcon /> Create shop & load data
          </Button>
        </div>
      </div>
    </div>
  );
}

function PartyRows({ title, balanceLabel, rows, onChange }: { title: string; balanceLabel: string; rows: PartyRow[]; onChange: (r: PartyRow[]) => void }) {
  return (
    <div className="space-y-2">
      <span className="text-[13px] font-medium">{title}</span>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_8rem_auto] gap-2">
          <Input aria-label="Name" placeholder="Name" value={r.name} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <Input aria-label="Mobile" placeholder="Mobile" inputMode="numeric" value={r.phone} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} />
          <AmountInput aria-label={balanceLabel} placeholder={balanceLabel} value={r.openingBalancePaise} onChange={(v) => onChange(rows.map((x, j) => (j === i ? { ...x, openingBalancePaise: v } : x)))} />
          <Button variant="ghost" size="icon" aria-label="Remove row" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Trash2Icon />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...rows, { name: "", phone: "", openingBalancePaise: null }])} className={cn(rows.length >= 50 && "hidden")}>
        <PlusIcon /> Add
      </Button>
    </div>
  );
}
