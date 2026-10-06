"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, KeyRoundIcon, LockIcon, PlusIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field } from "@/components/shared/field";
import { PageHeader } from "@/components/shared/page-header";
import { PasswordInput } from "@/components/shared/password-input";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { useCan, useSession } from "@/features/session/session-context";
import { api, apiGet, errorMessage } from "@/lib/api";
import type { Member, Role } from "@/lib/api-types";
import { formatRelative } from "@/lib/dates";
import { PERMISSION_LABELS, PERMISSIONS, type Permission } from "@/lib/domain";
import { initials } from "@/lib/text";
import { cn } from "@/lib/utils";

function useRoles() {
  return useQuery({ queryKey: ["team", "roles"], queryFn: ({ signal }) => apiGet<Role[]>("/team/roles", signal) });
}

export function UsersSettings() {
  const can = useCan();
  const me = useSession();
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ["team", "members"], queryFn: ({ signal }) => apiGet<Member[]>("/team/members", signal), enabled: can("users.manage") });
  const roles = useRoles();
  const [adding, setAdding] = React.useState(false);
  const [resetFor, setResetFor] = React.useState<Member | null>(null);
  const [deactivate, setDeactivate] = React.useState<Member | null>(null);

  if (!can("users.manage")) return <EmptyState icon={LockIcon} title="Only the owner can manage users." />;

  const update = async (m: Member, body: { roleId?: string; isActive?: boolean }) => {
    try {
      await api(`/team/members/${m.memberId}`, { method: "PATCH", body });
      toast.success("Updated");
      await qc.invalidateQueries({ queryKey: ["team"] });
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Users"
        description="Give staff their own login. Every action they take is in the audit log."
        back={{ href: "/settings", label: "Settings" }}
        actions={
          <Button onClick={() => setAdding(true)}>
            <UserPlusIcon /> Add staff
          </Button>
        }
      />
      {members.isError ? (
        <ErrorState error={members.error} onRetry={() => members.refetch()} />
      ) : !members.data ? (
        <ListSkeleton rows={3} />
      ) : members.data.length <= 1 ? (
        <EmptyState icon={UsersIcon} title="Only you so far." description="Add a staff member so they can bill and manage stock with their own login." action={<Button onClick={() => setAdding(true)}><PlusIcon /> Add staff</Button>} />
      ) : null}
      {members.data && (
        <ul className="mt-3 divide-y overflow-hidden rounded-2xl border bg-card">
          {members.data.map((m) => {
            const self = m.userId === me.user.id;
            return (
              <li key={m.memberId} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", !m.isActive && "opacity-60")}>
                <span className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-[13px] font-bold text-primary">{initials(m.name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[14.5px] font-semibold">
                    {m.name} {self && <Badge variant="neutral">You</Badge>} {!m.isActive && <Badge variant="danger">No access</Badge>}
                  </span>
                  <span className="block text-[12.5px] text-muted-foreground">
                    +91 {m.mobile} · {m.lastLoginAt ? `last login ${formatRelative(m.lastLoginAt)}` : "never logged in"}
                  </span>
                </span>
                {self ? (
                  <Badge>{m.roleName}</Badge>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <NativeSelect aria-label={`Role for ${m.name}`} className="h-9 w-32 text-[13px]" value={m.roleId} onChange={(e) => void update(m, { roleId: e.target.value }).catch(() => undefined)}>
                      {roles.data?.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button variant="ghost" size="icon-sm" aria-label={`Reset password for ${m.name}`} onClick={() => setResetFor(m)}>
                      <KeyRoundIcon />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => (m.isActive ? setDeactivate(m) : void update(m, { isActive: true }).catch(() => undefined))}>
                      {m.isActive ? "Remove" : "Restore"}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <AddMemberSheet open={adding} onOpenChange={setAdding} roles={roles.data ?? []} />
      <ResetPasswordSheet member={resetFor} onClose={() => setResetFor(null)} />
      <ConfirmDialog
        open={!!deactivate}
        onOpenChange={(o) => !o && setDeactivate(null)}
        title={`Remove access for ${deactivate?.name}?`}
        description="They are logged out immediately. Their past entries stay in your records. You can restore access later."
        confirmLabel="Remove access"
        destructive
        onConfirm={() => (deactivate ? update(deactivate, { isActive: false }) : undefined)}
      />
    </div>
  );
}

function AddMemberSheet({ open, onOpenChange, roles }: { open: boolean; onOpenChange: (o: boolean) => void; roles: Role[] }) {
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [mobile, setMobile] = React.useState("");
  const [roleId, setRoleId] = React.useState("role_staff");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const reset = () => (setName(""), setMobile(""), setPassword(""), setRoleId("role_staff"));
  return (
    <ResponsiveModal open={open} onOpenChange={(o) => (onOpenChange(o), !o && reset())} title="Add staff" description="They log in with their mobile number and the password you set. Ask them to change it.">
      <form
        className="space-y-3 pb-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await api<{ existingAccount: boolean }>("/team/members", { method: "POST", body: { name, mobile, roleId, password: password || undefined } });
            toast.success(r.existingAccount ? "Added — they can use their existing password" : "Staff added");
            await qc.invalidateQueries({ queryKey: ["team"] });
            reset();
            onOpenChange(false);
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field id="s-name" label="Name">
          <Input id="s-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="s-mobile" label="Mobile number">
          <Input id="s-mobile" type="tel" inputMode="numeric" value={mobile} onChange={(e) => setMobile(e.target.value)} />
        </Field>
        <Field id="s-role" label="Role">
          <NativeSelect id="s-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="s-pass" label="Temporary password" hint="At least 8 characters. Not needed if they already use DukaanOS.">
          <PasswordInput id="s-pass" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" loading={busy} disabled={!name.trim() || !mobile.trim()}>
          Add staff
        </Button>
      </form>
    </ResponsiveModal>
  );
}

function ResetPasswordSheet({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const [pw, setPw] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <ResponsiveModal open={!!member} onOpenChange={(o) => !o && (onClose(), setPw(""))} title={`New password for ${member?.name ?? ""}`} description="They will be logged out and must use the new password.">
      <div className="space-y-3 pb-2">
        <PasswordInput aria-label="New password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <Button
          className="w-full"
          loading={busy}
          disabled={pw.length < 8}
          onClick={async () => {
            if (!member) return;
            setBusy(true);
            try {
              await api(`/team/members/${member.memberId}/reset-password`, { method: "POST", body: { password: pw } });
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

export function RolesSettings() {
  const can = useCan();
  const me = useSession();
  const qc = useQueryClient();
  const roles = useRoles();
  const [editing, setEditing] = React.useState<{ id?: string; name: string; permissions: Permission[] } | null>(null);
  const [busy, setBusy] = React.useState(false);
  if (roles.isError) return <ErrorState error={roles.error} onRetry={() => roles.refetch()} />;
  if (!roles.data) return <ListSkeleton rows={3} />;
  const manage = can("users.manage");
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Roles & permissions"
        back={{ href: "/settings", label: "Settings" }}
        actions={
          manage && (
            <Button onClick={() => setEditing({ name: "", permissions: ["sales.create"] })}>
              <PlusIcon /> Custom role
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="overflow-x-auto pt-4">
          <table className="w-full min-w-[520px] text-[13.5px]">
            <thead>
              <tr className="text-left text-[12px] text-muted-foreground">
                <th className="pb-2 font-medium">Permission</th>
                {roles.data.map((r) => (
                  <th key={r.id} className="pb-2 text-center font-medium">
                    {r.isSystem || !manage ? (
                      r.name
                    ) : (
                      <button type="button" className="text-primary hover:underline" onClick={() => setEditing({ id: r.id, name: r.name, permissions: r.permissions })}>
                        {r.name}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {PERMISSIONS.map((p) => (
                <tr key={p}>
                  <td className="py-2 pr-3">{PERMISSION_LABELS[p]}</td>
                  {roles.data.map((r) => (
                    <td key={r.id} className="py-2 text-center">
                      {r.permissions.includes(p) ? <CheckIcon className="mx-auto size-4 text-success" aria-label="Allowed" /> : <span className="text-muted-foreground/50" aria-label="Not allowed">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <p className="mt-3 text-[12.5px] text-muted-foreground">Built-in roles can&apos;t be changed. Your role: {me.membership.roleName}.</p>
      <ResponsiveModal open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing?.id ? "Edit role" : "New role"}>
        {editing && (
          <div className="space-y-3 pb-2">
            <Input aria-label="Role name" placeholder="e.g. Cashier" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <Card>
              <CardHeader>
                <CardTitle className="text-[13px]">Allowed</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {PERMISSIONS.filter((p) => me.membership.permissions.includes(p)).map((p) => (
                  <label key={p} className="flex min-h-10 items-center gap-3 text-[14px]">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={editing.permissions.includes(p)}
                      onChange={(e) => setEditing({ ...editing, permissions: e.target.checked ? [...editing.permissions, p] : editing.permissions.filter((x) => x !== p) })}
                    />
                    {PERMISSION_LABELS[p]}
                  </label>
                ))}
              </CardContent>
            </Card>
            <Button
              className="w-full"
              loading={busy}
              disabled={editing.name.trim().length < 2 || !editing.permissions.length}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(editing.id ? `/team/roles/${editing.id}` : "/team/roles", { method: editing.id ? "PATCH" : "POST", body: { name: editing.name.trim(), permissions: editing.permissions } });
                  toast.success("Role saved");
                  await qc.invalidateQueries({ queryKey: ["team"] });
                  setEditing(null);
                } catch (err) {
                  toast.error(errorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save role
            </Button>
          </div>
        )}
      </ResponsiveModal>
    </div>
  );
}
