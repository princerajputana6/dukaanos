"use client";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { BuildingIcon, CalendarPlusIcon, PauseCircleIcon, PencilIcon, PlayCircleIcon, PlusCircleIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field } from "@/components/shared/field";
import { LoadMore } from "@/components/shared/load-more";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { useUrlState } from "@/components/shared/url-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { useDebounced } from "@/hooks/use-debounced";
import { api, apiGet, errorMessage, qs } from "@/lib/api";
import type { AdminAgency, AdminTenantDetail, AdminTenantList } from "@/lib/api-types";
import { addDays, formatDate, formatRelative, todayIst } from "@/lib/dates";
import { LICENSE_PLANS, LICENSE_PLAN_KEYS, LICENSE_STATUSES, LICENSE_STATUS_LABELS, type LicensePlan } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { LicenseBadge, PlanBadge, StatusBadge, ValidUntil } from "./badges";

const FILTERS = [
  { id: "", label: "All" },
  { id: "TRIAL", label: "On trial" },
  { id: "EXPIRING", label: "Expiring ≤ 7 days" },
  { id: "EXPIRED", label: "Expired" },
  { id: "SUSPENDED", label: "Suspended" },
];

export function useAgencies() {
  return useQuery({ queryKey: ["admin", "agencies"], queryFn: ({ signal }) => apiGet<AdminAgency[]>("/admin/agencies", signal) });
}

export function TenantsList() {
  const url = useUrlState();
  const status = url.get("status") ?? "";
  const agencyId = url.get("agency") ?? "";
  const [q, setQ] = React.useState("");
  const dq = useDebounced(q, 250);
  const agencies = useAgencies();
  const list = useInfiniteQuery({
    queryKey: ["admin", "tenants", status, agencyId, dq],
    queryFn: ({ pageParam, signal }) => apiGet<AdminTenantList>(`/admin/tenants${qs({ status: status || undefined, agencyId: agencyId || undefined, q: dq || undefined, cursor: pageParam })}`, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div>
      <PageHeader
        title="Tenants & licences"
        description="Each tenant is an owner's account. Licences, branch limits and user limits are set here."
        actions={
          <Button asChild>
            <Link href="/admin/shops/new">
              <PlusCircleIcon /> Create shop
            </Link>
          </Button>
        }
      />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input className="pl-10" placeholder="Search account, owner name or mobile" aria-label="Search tenants" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <NativeSelect aria-label="Agency" className="sm:w-56" value={agencyId} onChange={(e) => url.set({ agency: e.target.value || null })}>
          <option value="">All agencies</option>
          {agencies.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0" role="group" aria-label="Licence filter">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={status === f.id}
            onClick={() => url.set({ status: f.id || null })}
            className={cn("h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-medium", status === f.id ? "border-primary bg-primary-soft text-primary-soft-foreground" : "bg-card hover:bg-accent")}
          >
            {f.label}
          </button>
        ))}
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState icon={BuildingIcon} title="No tenants match." action={<Button asChild><Link href="/admin/shops/new">Create shop</Link></Button>} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border bg-card">
            <table className="w-full min-w-[760px] text-[14px]">
              <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Account</th>
                  <th className="px-3 py-2.5 font-medium">Owner</th>
                  <th className="px-3 py-2.5 font-medium">Licence</th>
                  <th className="px-3 py-2.5 font-medium">Valid</th>
                  <th className="px-3 py-2.5 text-right font-medium">Shops</th>
                  <th className="px-4 py-2.5 text-right font-medium">Last sale</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((t) => (
                  <tr key={t.id} className="hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <Link href={`/admin/tenants/${t.id}`} className="font-semibold hover:text-primary">
                        {t.name}
                      </Link>
                      <span className="block text-[12px] text-muted-foreground">
                        {t.agencyName ?? "Direct"} · since {formatDate(t.createdAt)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {t.ownerName}
                      <span className="block text-[12px] text-muted-foreground">+91 {t.ownerMobile}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="flex flex-wrap gap-1">
                        <PlanBadge plan={t.plan} />
                        <LicenseBadge status={t.effectiveLicenseStatus} />
                        {t.status === "SUSPENDED" && <StatusBadge status="SUSPENDED" />}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[13px]">
                      <ValidUntil date={t.validUntil} />
                    </td>
                    <td className="px-3 py-3 text-right">
                      {t.branches} / {t.maxBranches ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-[13px] text-muted-foreground">{t.lastSaleAt ? formatRelative(t.lastSaleAt) : "—"}</td>
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

export function TenantDetailView({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "tenant", id], queryFn: ({ signal }) => apiGet<AdminTenantDetail>(`/admin/tenants/${id}`, signal) });
  const [editLicense, setEditLicense] = React.useState(false);
  const [editTenant, setEditTenant] = React.useState(false);
  const [suspend, setSuspend] = React.useState(false);
  const [shopAction, setShopAction] = React.useState<{ id: string; name: string; status: "ACTIVE" | "SUSPENDED" } | null>(null);
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <ListSkeleton rows={5} />;
  const d = q.data;
  const t = d.tenant;
  const lic = d.license;
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin"] });
  const patchLicense = async (body: Record<string, unknown>, msg: string) => {
    try {
      await api(`/admin/tenants/${id}/license`, { method: "PATCH", body });
      toast.success(msg);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const extend = (days: number) => {
    const base = lic?.validUntil && lic.validUntil > todayIst() ? lic.validUntil : todayIst();
    const status = lic?.status === "TRIAL" ? "TRIAL" : "ACTIVE";
    void patchLicense({ validUntil: addDays(base, days), status, note: `Extended by ${days} days` }, `Licence extended to ${formatDate(addDays(base, days))}`);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ href: "/admin/tenants", label: "Tenants" }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {t.name} <StatusBadge status={t.status} />
          </span>
        }
        description={`${d.agency ? `Agency: ${d.agency.name}` : "Direct customer"} · created ${formatDate(t.createdAt)}`}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditTenant(true)}>
              <PencilIcon /> Edit
            </Button>
            <Button variant="outline" className={t.status === "ACTIVE" ? "text-destructive" : ""} onClick={() => setSuspend(true)}>
              {t.status === "ACTIVE" ? <PauseCircleIcon /> : <PlayCircleIcon />} {t.status === "ACTIVE" ? "Suspend account" : "Reactivate"}
            </Button>
            <Button asChild>
              <Link href={`/admin/shops/new?tenant=${t.id}`}>
                <PlusCircleIcon /> Add branch
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Licence</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setEditLicense(true)}>
              <PencilIcon /> Change
            </Button>
          </CardHeader>
          <CardContent>
            {lic ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <PlanBadge plan={lic.plan} />
                  <LicenseBadge status={lic.effectiveStatus} />
                  <span className="text-[14px]">
                    <ValidUntil date={lic.validUntil} />
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Usage label="Shops / branches" used={d.usage.branches} max={lic.maxBranches} />
                  <Usage label="Users" used={d.usage.users} max={lic.maxUsers} />
                </div>
                {lic.note && <p className="rounded-xl bg-muted px-3 py-2 text-[13px]">{lic.note}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="soft" onClick={() => extend(30)}>
                    <CalendarPlusIcon /> +30 days
                  </Button>
                  <Button size="sm" variant="soft" onClick={() => extend(365)}>
                    <CalendarPlusIcon /> +1 year
                  </Button>
                  {lic.effectiveStatus !== "SUSPENDED" ? (
                    <Button size="sm" variant="outline" className="text-destructive" onClick={() => void patchLicense({ status: "SUSPENDED", note: "Suspended from admin" }, "Licence suspended")}>
                      Suspend licence
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => void patchLicense({ status: "ACTIVE" }, "Licence reactivated")}>
                      Reactivate licence
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState icon={BuildingIcon} title="No licence" action={<Button onClick={() => setEditLicense(true)}>Create licence</Button>} />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Owner</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-[14px]">
            {d.owner ? (
              <>
                <p className="font-semibold">{d.owner.name}</p>
                <p>+91 {d.owner.mobile}</p>
                {d.owner.email && <p>{d.owner.email}</p>}
                <p className="text-[12.5px] text-muted-foreground">{d.owner.lastLoginAt ? `Last login ${formatRelative(d.owner.lastLoginAt)}` : "Never logged in"}</p>
                <Link href={`/admin/users?q=${d.owner.mobile}`} className="text-[13px] font-semibold text-primary hover:underline">
                  Manage user
                </Link>
              </>
            ) : (
              <p className="text-muted-foreground">Owner not found.</p>
            )}
            {t.notes && <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-[13px]">{t.notes}</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Shops & branches ({d.shops.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[14px]">
            <thead className="text-left text-[12px] text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">Shop</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 text-right font-medium">Products</th>
                <th className="pb-2 text-right font-medium">Users</th>
                <th className="pb-2 text-right font-medium">Sales (30d)</th>
                <th className="pb-2 text-right font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {d.shops.map((s) => (
                <tr key={s.id}>
                  <td className="py-2.5">
                    <span className="font-semibold">{s.name}</span>
                    <span className="block text-[12px] text-muted-foreground">
                      {s.branchCode ?? "MAIN"} · {s.city ?? "—"} · {s.lastSaleAt ? `last sale ${formatRelative(s.lastSaleAt)}` : "no sales yet"}
                    </span>
                  </td>
                  <td className="py-2.5">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="py-2.5 text-right">{s.products}</td>
                  <td className="py-2.5 text-right">{s.members}</td>
                  <td className="py-2.5 text-right">
                    <Money paise={s.sales30Paise} compact />
                  </td>
                  <td className="py-2.5 text-right">
                    {s.status !== "ARCHIVED" && (
                      <Button size="sm" variant="ghost" className={s.status === "ACTIVE" ? "text-destructive" : ""} onClick={() => setShopAction({ id: s.id, name: s.name, status: s.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" })}>
                        {s.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Users ({d.members.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-[14px]">
              {d.members.map((m) => (
                <li key={`${m.userId}-${m.shopId}`} className={cn("flex justify-between gap-3 py-2", !m.isActive && "opacity-55")}>
                  <span>
                    {m.name} <span className="text-[12px] text-muted-foreground">+91 {m.mobile}</span>
                    <span className="block text-[12px] text-muted-foreground">
                      {m.roleName} at {m.shopName}
                    </span>
                  </span>
                  <span className="text-[12px] text-muted-foreground">{m.lastLoginAt ? formatRelative(m.lastLoginAt) : "never"}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Licence history</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-[13.5px]">
              {d.licenseEvents.map((e) => (
                <li key={e.id} className="py-2">
                  <span className="font-medium">{e.action === "LICENSE_CREATED" ? "Licence created" : "Licence changed"}</span>
                  <span className="text-muted-foreground"> · {formatRelative(e.createdAt)}{e.actorName ? ` · ${e.actorName}` : ""}</span>
                  <span className="block text-[12.5px] text-muted-foreground">
                    {Object.entries((e.afterData ?? {}) as Record<string, unknown>)
                      .filter(([k]) => k !== "note")
                      .map(([k, v]) => `${k}: ${v ?? "none"}`)
                      .join(" · ")}
                    {e.note ? ` — ${e.note}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <LicenseEditor open={editLicense} onOpenChange={setEditLicense} tenantId={id} license={lic} onSaved={refresh} />
      <TenantEditor open={editTenant} onOpenChange={setEditTenant} tenant={t} onSaved={refresh} />
      <ConfirmDialog
        open={suspend}
        onOpenChange={setSuspend}
        title={t.status === "ACTIVE" ? `Suspend ${t.name}?` : `Reactivate ${t.name}?`}
        description={t.status === "ACTIVE" ? "All their shops become read-only immediately: they can view and export data but cannot record anything." : "Their shops can record sales again (if the licence is valid)."}
        confirmLabel={t.status === "ACTIVE" ? "Suspend account" : "Reactivate"}
        destructive={t.status === "ACTIVE"}
        onConfirm={async () => {
          await api(`/admin/tenants/${id}`, { method: "PATCH", body: { status: t.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" } }).catch((e) => {
            toast.error(errorMessage(e));
            throw e;
          });
          toast.success("Updated");
          await refresh();
        }}
      />
      <ConfirmDialog
        open={!!shopAction}
        onOpenChange={(o) => !o && setShopAction(null)}
        title={shopAction?.status === "SUSPENDED" ? `Suspend ${shopAction?.name}?` : `Reactivate ${shopAction?.name}?`}
        description={shopAction?.status === "SUSPENDED" ? "Only this shop becomes read-only. Other branches are not affected." : "This shop can record entries again."}
        confirmLabel={shopAction?.status === "SUSPENDED" ? "Suspend shop" : "Reactivate shop"}
        destructive={shopAction?.status === "SUSPENDED"}
        onConfirm={async () => {
          if (!shopAction) return;
          await api(`/admin/shops/${shopAction.id}`, { method: "PATCH", body: { status: shopAction.status } }).catch((e) => {
            toast.error(errorMessage(e));
            throw e;
          });
          toast.success("Updated");
          await refresh();
        }}
      />
    </div>
  );
}

function Usage({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, max)) * 100));
  return (
    <div className="rounded-xl border p-3">
      <p className="text-[12.5px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">
        {used} <span className="text-[14px] font-normal text-muted-foreground">of {max}</span>
      </p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className={cn("h-full rounded-full", pct >= 100 ? "bg-warning" : "bg-primary")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function LicenseEditor({ open, onOpenChange, tenantId, license, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; tenantId: string; license: AdminTenantDetail["license"]; onSaved: () => unknown }) {
  const [v, setV] = React.useState({ plan: "BASIC" as LicensePlan, status: "ACTIVE", maxBranches: "1", maxUsers: "5", validUntil: "", note: "" });
  const [openedFor, setOpenedFor] = React.useState<boolean>(false);
  const [busy, setBusy] = React.useState(false);
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open)
      setV({
        plan: (license?.plan as LicensePlan) ?? "BASIC",
        status: license?.status ?? "ACTIVE",
        maxBranches: String(license?.maxBranches ?? 1),
        maxUsers: String(license?.maxUsers ?? 5),
        validUntil: license?.validUntil ?? "",
        note: "",
      });
  }
  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} title="Change licence" description="Changes apply immediately to every shop of this account.">
      <div className="grid gap-3 pb-2 sm:grid-cols-2">
        <Field id="lic-plan" label="Plan">
          <NativeSelect
            id="lic-plan"
            value={v.plan}
            onChange={(e) => {
              const p = e.target.value as LicensePlan;
              setV({ ...v, plan: p, maxBranches: String(LICENSE_PLANS[p].maxBranches), maxUsers: String(LICENSE_PLANS[p].maxUsers) });
            }}
          >
            {LICENSE_PLAN_KEYS.map((p) => (
              <option key={p} value={p}>
                {LICENSE_PLANS[p].label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="lic-status" label="Status">
          <NativeSelect id="lic-status" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
            {LICENSE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LICENSE_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="lic-branches" label="Max shops / branches">
          <Input id="lic-branches" inputMode="numeric" value={v.maxBranches} onChange={(e) => setV({ ...v, maxBranches: e.target.value.replace(/\D/g, "") })} />
        </Field>
        <Field id="lic-users" label="Max users">
          <Input id="lic-users" inputMode="numeric" value={v.maxUsers} onChange={(e) => setV({ ...v, maxUsers: e.target.value.replace(/\D/g, "") })} />
        </Field>
        <Field id="lic-valid" label="Valid until" hint="Leave empty for no end date" className="sm:col-span-2">
          <Input id="lic-valid" type="date" value={v.validUntil} onChange={(e) => setV({ ...v, validUntil: e.target.value })} />
        </Field>
        <Field id="lic-note" label="Note" optional className="sm:col-span-2">
          <Textarea id="lic-note" rows={2} placeholder="e.g. Paid ₹2,999 via UPI, ref 1234" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
        </Field>
        <Button
          className="sm:col-span-2"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`/admin/tenants/${tenantId}/license`, {
                method: "PATCH",
                body: { plan: v.plan, status: v.status, maxBranches: Number(v.maxBranches) || 1, maxUsers: Number(v.maxUsers) || 1, validUntil: v.validUntil || null, note: v.note || null },
              });
              toast.success("Licence updated");
              onOpenChange(false);
              await onSaved();
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Save licence
        </Button>
      </div>
    </ResponsiveModal>
  );
}

function TenantEditor({ open, onOpenChange, tenant, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; tenant: AdminTenantDetail["tenant"]; onSaved: () => unknown }) {
  const agencies = useAgencies();
  const [v, setV] = React.useState({ name: tenant.name, agencyId: tenant.agencyId ?? "", notes: tenant.notes ?? "" });
  const [busy, setBusy] = React.useState(false);
  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} title="Edit account">
      <div className="space-y-3 pb-2">
        <Field id="t-name" label="Account name">
          <Input id="t-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field id="t-agency" label="Agency">
          <NativeSelect id="t-agency" value={v.agencyId} onChange={(e) => setV({ ...v, agencyId: e.target.value })}>
            <option value="">Direct (no agency)</option>
            {agencies.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="t-notes" label="Internal notes" optional>
          <Textarea id="t-notes" rows={3} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </Field>
        <Button
          className="w-full"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`/admin/tenants/${tenant.id}`, { method: "PATCH", body: { name: v.name, agencyId: v.agencyId || null, notes: v.notes || null } });
              toast.success("Saved");
              onOpenChange(false);
              await onSaved();
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </Button>
      </div>
    </ResponsiveModal>
  );
}
