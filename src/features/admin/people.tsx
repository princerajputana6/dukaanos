"use client";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { HandshakeIcon, HistoryIcon, KeyRoundIcon, PencilIcon, PlusIcon, SearchIcon, ShieldCheckIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field } from "@/components/shared/field";
import { LoadMore } from "@/components/shared/load-more";
import { PageHeader } from "@/components/shared/page-header";
import { PasswordInput } from "@/components/shared/password-input";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { useUrlState } from "@/components/shared/url-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { useDebounced } from "@/hooks/use-debounced";
import { api, apiGet, errorMessage, qs } from "@/lib/api";
import type { AdminAgency, AdminAuditList, AdminUserList, AdminUserRow } from "@/lib/api-types";
import { formatDateTime, formatRelative } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./badges";
import { useAgencies } from "./tenants";

// ─── Agencies ────────────────────────────────────────────────────────────────

export function AgenciesView() {
  const q = useAgencies();
  const [editing, setEditing] = React.useState<Partial<AdminAgency> | null>(null);
  return (
    <div>
      <PageHeader
        title="Agencies"
        description="Partners and resellers who onboard and support shops."
        actions={
          <Button onClick={() => setEditing({})}>
            <PlusIcon /> Add agency
          </Button>
        }
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <ListSkeleton rows={3} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={HandshakeIcon} title="No agencies yet." description="Shops can be direct customers or belong to an agency." action={<Button onClick={() => setEditing({})}>Add agency</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[640px] text-[14px]">
            <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Agency</th>
                <th className="px-3 py-2.5 font-medium">Contact</th>
                <th className="px-3 py-2.5 text-right font-medium">Accounts</th>
                <th className="px-3 py-2.5 text-right font-medium">Shops</th>
                <th className="px-3 py-2.5 text-right font-medium">Active licences</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {q.data.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3">
                    <span className="font-semibold">{a.name}</span>
                    <span className="block text-[12px] text-muted-foreground">
                      {a.city ?? "—"} · <StatusBadge status={a.status} />
                    </span>
                  </td>
                  <td className="px-3 py-3 text-[13px]">
                    {a.contactName ?? "—"}
                    <span className="block text-muted-foreground">{[a.phone ? `+91 ${a.phone}` : null, a.email].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Link href={`/admin/tenants?agency=${a.id}`} className="hover:text-primary">
                      {a.tenants}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-right">{a.shops}</td>
                  <td className="px-3 py-3 text-right">{a.activeLicenses}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(a)} aria-label={`Edit ${a.name}`}>
                      <PencilIcon />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AgencyEditor agency={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function AgencyEditor({ agency, onClose }: { agency: Partial<AdminAgency> | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = React.useState({ name: "", contactName: "", phone: "", email: "", city: "", status: "ACTIVE", notes: "" });
  const [key, setKey] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const k = agency ? (agency.id ?? "new") : null;
  if (k !== key) {
    setKey(k);
    if (agency) setV({ name: agency.name ?? "", contactName: agency.contactName ?? "", phone: agency.phone ?? "", email: agency.email ?? "", city: agency.city ?? "", status: agency.status ?? "ACTIVE", notes: agency.notes ?? "" });
  }
  return (
    <ResponsiveModal open={!!agency} onOpenChange={(o) => !o && onClose()} title={agency?.id ? "Edit agency" : "New agency"}>
      <div className="grid gap-3 pb-2 sm:grid-cols-2">
        <Field id="ag-name" label="Agency name" className="sm:col-span-2">
          <Input id="ag-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field id="ag-contact" label="Contact person" optional>
          <Input id="ag-contact" value={v.contactName} onChange={(e) => setV({ ...v, contactName: e.target.value })} />
        </Field>
        <Field id="ag-phone" label="Mobile" optional>
          <Input id="ag-phone" type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        </Field>
        <Field id="ag-email" label="Email" optional>
          <Input id="ag-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </Field>
        <Field id="ag-city" label="City" optional>
          <Input id="ag-city" value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} />
        </Field>
        <Field id="ag-status" label="Status">
          <NativeSelect id="ag-status" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </NativeSelect>
        </Field>
        <Field id="ag-notes" label="Notes" optional className="sm:col-span-2">
          <Textarea id="ag-notes" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </Field>
        <Button
          className="sm:col-span-2"
          loading={busy}
          disabled={v.name.trim().length < 2}
          onClick={async () => {
            setBusy(true);
            try {
              await api(agency?.id ? `/admin/agencies/${agency.id}` : "/admin/agencies", { method: agency?.id ? "PATCH" : "POST", body: v });
              toast.success("Agency saved");
              await qc.invalidateQueries({ queryKey: ["admin"] });
              onClose();
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Save agency
        </Button>
      </div>
    </ResponsiveModal>
  );
}

// ─── Users ───────────────────────────────────────────────────────────────────

const USER_FILTERS = [
  { id: "", label: "All users" },
  { id: "OWNER", label: "Owners" },
  { id: "SUPER_ADMIN", label: "Super admins" },
  { id: "DISABLED", label: "Disabled" },
];

export function UsersView() {
  const url = useUrlState();
  const qc = useQueryClient();
  const filter = url.get("filter") ?? "";
  const [q, setQ] = React.useState(url.get("q") ?? "");
  const dq = useDebounced(q, 250);
  const [reset, setReset] = React.useState<AdminUserRow | null>(null);
  const [confirm, setConfirm] = React.useState<{ user: AdminUserRow; body: Record<string, unknown>; title: string; description: string; label: string; destructive?: boolean } | null>(null);
  const [view, setView] = React.useState<AdminUserRow | null>(null);
  const list = useInfiniteQuery({
    queryKey: ["admin", "users", filter, dq],
    queryFn: ({ pageParam, signal }) => apiGet<AdminUserList>(`/admin/users${qs({ status: filter || undefined, q: dq || undefined, cursor: pageParam })}`, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div>
      <PageHeader title="Owners & users" description="Everyone who can log in to DukaanOS." />
      <div className="mb-3 relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input className="pl-10" placeholder="Search name, mobile or email" aria-label="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0" role="group" aria-label="User filter">
        {USER_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => url.set({ filter: f.id || null })}
            className={cn("h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-medium", filter === f.id ? "border-primary bg-primary-soft text-primary-soft-foreground" : "bg-card hover:bg-accent")}
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
        <EmptyState icon={UsersIcon} title="No users match." />
      ) : (
        <>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {items.map((u) => (
              <li key={u.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", !u.isActive && "opacity-60")}>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setView(u)}>
                  <span className="flex flex-wrap items-center gap-1.5 text-[14.5px] font-semibold">
                    {u.name}
                    {u.platformRole === "SUPER_ADMIN" && (
                      <Badge variant="info">
                        <ShieldCheckIcon /> Super admin
                      </Badge>
                    )}
                    {u.ownedTenants > 0 && <Badge variant="outline">Owner</Badge>}
                    {!u.isActive && <Badge variant="danger">Disabled</Badge>}
                  </span>
                  <span className="block text-[12.5px] text-muted-foreground">
                    +91 {u.mobile}
                    {u.email ? ` · ${u.email}` : ""} · {u.shops} shop{u.shops === 1 ? "" : "s"} · {u.lastLoginAt ? `login ${formatRelative(u.lastLoginAt)}` : "never logged in"}
                  </span>
                </button>
                <div className="flex items-center gap-1">
                  <Button size="icon-sm" variant="ghost" aria-label={`Reset password for ${u.name}`} onClick={() => setReset(u)}>
                    <KeyRoundIcon />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setConfirm(
                        u.platformRole === "SUPER_ADMIN"
                          ? { user: u, body: { platformRole: null }, title: `Remove super admin from ${u.name}?`, description: "They keep any shop access they have.", label: "Remove", destructive: true }
                          : { user: u, body: { platformRole: "SUPER_ADMIN" }, title: `Make ${u.name} a super admin?`, description: "They will be able to see and change every tenant, shop, licence and user.", label: "Grant access" },
                      )
                    }
                  >
                    {u.platformRole === "SUPER_ADMIN" ? "Revoke admin" : "Make admin"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={u.isActive ? "text-destructive" : ""}
                    onClick={() =>
                      setConfirm({
                        user: u,
                        body: { isActive: !u.isActive },
                        title: u.isActive ? `Disable ${u.name}?` : `Enable ${u.name}?`,
                        description: u.isActive ? "They are logged out everywhere and can't log in. Their past entries stay." : "They can log in again.",
                        label: u.isActive ? "Disable" : "Enable",
                        destructive: u.isActive,
                      })
                    }
                  >
                    {u.isActive ? "Disable" : "Enable"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />
        </>
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.title ?? ""}
        description={confirm?.description}
        confirmLabel={confirm?.label ?? "OK"}
        destructive={confirm?.destructive}
        onConfirm={async () => {
          if (!confirm) return;
          await api(`/admin/users/${confirm.user.id}`, { method: "PATCH", body: confirm.body }).catch((e) => {
            toast.error(errorMessage(e));
            throw e;
          });
          toast.success("Updated");
          await qc.invalidateQueries({ queryKey: ["admin"] });
        }}
      />
      <ResetPassword user={reset} onClose={() => setReset(null)} />
      <UserMemberships user={view} onClose={() => setView(null)} />
    </div>
  );
}

function ResetPassword({ user, onClose }: { user: AdminUserRow | null; onClose: () => void }) {
  const [pw, setPw] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <ResponsiveModal open={!!user} onOpenChange={(o) => !o && (onClose(), setPw(""))} title={`New password for ${user?.name ?? ""}`} description="They are logged out everywhere and must use this password.">
      <div className="space-y-3 pb-2">
        <PasswordInput aria-label="New password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <Button
          className="w-full"
          disabled={pw.length < 8}
          loading={busy}
          onClick={async () => {
            if (!user) return;
            setBusy(true);
            try {
              await api(`/admin/users/${user.id}/reset-password`, { method: "POST", body: { password: pw } });
              toast.success("Password reset");
              setPw("");
              onClose();
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Set password
        </Button>
      </div>
    </ResponsiveModal>
  );
}

function UserMemberships({ user, onClose }: { user: AdminUserRow | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["admin", "user-memberships", user?.id],
    queryFn: ({ signal }) => apiGet<Array<{ shopId: string; shopName: string; tenantId: string | null; tenantName: string | null; roleName: string; isActive: boolean }>>(`/admin/users/${user!.id}/memberships`, signal),
    enabled: !!user,
  });
  return (
    <ResponsiveModal open={!!user} onOpenChange={(o) => !o && onClose()} title={user?.name ?? ""} description={user ? `+91 ${user.mobile}` : undefined}>
      <div className="pb-2">
        {!q.data ? (
          <ListSkeleton rows={2} />
        ) : q.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not a member of any shop.</p>
        ) : (
          <ul className="divide-y rounded-xl border text-[14px]">
            {q.data.map((m) => (
              <li key={m.shopId} className={cn("flex justify-between gap-3 px-3.5 py-2.5", !m.isActive && "opacity-55")}>
                <span>
                  {m.shopName}
                  {m.tenantId && (
                    <Link href={`/admin/tenants/${m.tenantId}`} className="block text-[12.5px] text-primary hover:underline" onClick={onClose}>
                      {m.tenantName}
                    </Link>
                  )}
                </span>
                <Badge variant="neutral">{m.roleName}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ResponsiveModal>
  );
}

// ─── Admin audit ─────────────────────────────────────────────────────────────

export function AdminAuditView() {
  const [q, setQ] = React.useState("");
  const dq = useDebounced(q, 300);
  const list = useInfiniteQuery({
    queryKey: ["admin", "audit", dq],
    queryFn: ({ pageParam, signal }) => apiGet<AdminAuditList>(`/admin/audit${qs({ q: dq || undefined, cursor: pageParam })}`, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Admin audit log" description="Every action taken in this console." />
      <Input className="mb-4" placeholder="Search" aria-label="Search admin audit log" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="No admin actions yet." />
      ) : (
        <>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {items.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <p className="text-[14px]">{a.summary}</p>
                <p className="text-[12px] text-muted-foreground">
                  {a.actorName ?? "Unknown"} · {a.action.replace(/_/g, " ").toLowerCase()} · {formatDateTime(a.createdAt)}
                  {a.targetType === "tenant" && a.targetId && (
                    <>
                      {" · "}
                      <Link href={`/admin/tenants/${a.targetId}`} className="text-primary hover:underline">
                        open
                      </Link>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
          <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()} />
        </>
      )}
    </div>
  );
}
