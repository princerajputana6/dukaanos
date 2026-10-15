"use client";
import { useQueryClient } from "@tanstack/react-query";
import { BellIcon, BuildingIcon, ChevronRightIcon, DatabaseIcon, KeyRoundIcon, MicIcon, PackageIcon, ReceiptTextIcon, ShieldCheckIcon, StoreIcon, UsersIcon , CoinsIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { Field } from "@/components/shared/field";
import { PageHeader } from "@/components/shared/page-header";
import { PasswordInput } from "@/components/shared/password-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { useCan, useSession } from "@/features/session/session-context";
import { BrowserSpeechProvider, ServerSpeechProvider } from "@/features/voice/speech";
import { presetRange } from "@/components/shared/date-range";
import { api, ApiError, errorMessage, qs } from "@/lib/api";
import { BUSINESS_TYPES, FEATURE_FLAGS, GST_REGISTRATION, INDIAN_STATES, type FeatureFlag } from "@/lib/domain";
import { fromMilli, toMilli } from "@/lib/qty";

const SECTIONS = [
  { href: "/settings/business", label: "Business", desc: "Name, type, address, contact", icon: BuildingIcon, perm: "settings.manage" },
  { href: "/settings/branches", label: "Branches & plan", desc: "Your shops, licence and limits", icon: StoreIcon, perm: null },
  { href: "/settings/users", label: "Users", desc: "Staff accounts and access", icon: UsersIcon, perm: "users.manage" },
  { href: "/settings/roles", label: "Roles", desc: "What each role can do", icon: ShieldCheckIcon, perm: "users.manage" },
  { href: "/settings/gst", label: "GST", desc: "GSTIN, legal name, state", icon: ReceiptTextIcon, perm: "settings.manage" },
  { href: "/settings/inventory", label: "Products & inventory", desc: "GST-inclusive prices, stock rules, bill numbers", icon: PackageIcon, perm: "settings.manage" },
  { href: "/settings/voice", label: "Voice & AI", desc: "Microphone, language, AI features", icon: MicIcon, perm: null },
  { href: "/settings/notifications", label: "Notifications", desc: "Low stock, daily summary, reminders", icon: BellIcon, perm: "settings.manage" },
  { href: "/settings/security", label: "Security", desc: "Password and sessions", icon: KeyRoundIcon, perm: null },
  { href: "/settings/ai-usage", label: "AI usage", desc: "Your voice/AI spend and limit this month", icon: CoinsIcon, perm: "reports.view" },
  { href: "/settings/data", label: "Data", desc: "Export & backup", icon: DatabaseIcon, perm: "reports.view" },
] as const;

export function SettingsIndex() {
  const can = useCan();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" />
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        {SECTIONS.filter((s) => !s.perm || can(s.perm)).map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="flex items-center gap-3 px-4 py-3.5 hover:bg-accent/60">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
                <s.icon className="size-5" aria-hidden="true" />
              </span>
              <span className="flex-1">
                <span className="block text-[15px] font-semibold">{s.label}</span>
                <span className="block text-[12.5px] text-muted-foreground">{s.desc}</span>
              </span>
              <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function useSave() {
  const qc = useQueryClient();
  const [saving, setSaving] = React.useState(false);
  const save = async (path: string, body: unknown, ok = "Saved") => {
    setSaving(true);
    try {
      await api(path, { method: "PATCH", body });
      toast.success(ok);
      await qc.invalidateQueries({ queryKey: ["me"] });
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { saving, save };
}

function Shell({ title, children, description }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={title} description={description} back={{ href: "/settings", label: "Settings" }} />
      {children}
    </div>
  );
}

export function BusinessSettings() {
  const me = useSession();
  const { saving, save } = useSave();
  const b = me.business;
  const [v, setV] = React.useState({ name: b.name, type: b.type, city: b.city ?? "", stateCode: b.stateCode ?? "", phone: b.phone ?? "", address: b.address ?? "" });
  const set = (k: keyof typeof v, x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <Shell title="Business">
      <Card>
        <CardContent className="grid gap-4 pt-5 sm:grid-cols-2">
          <Field id="b-name" label="Business name" className="sm:col-span-2">
            <Input id="b-name" value={v.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field id="b-type" label="Type">
            <NativeSelect id="b-type" value={v.type} onChange={(e) => set("type", e.target.value)}>
              {BUSINESS_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="b-phone" label="Shop phone" optional>
            <Input id="b-phone" type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field id="b-city" label="City">
            <Input id="b-city" value={v.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field id="b-state" label="State">
            <NativeSelect id="b-state" value={v.stateCode} onChange={(e) => set("stateCode", e.target.value)}>
              <option value="">—</option>
              {INDIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="b-address" label="Address" optional className="sm:col-span-2">
            <Input id="b-address" value={v.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Button
            className="sm:col-span-2"
            loading={saving}
            onClick={() =>
              save("/business/profile", { name: v.name, type: v.type, city: v.city || null, stateCode: v.stateCode || null, phone: v.phone || null, address: v.address || null }).then((ok) => ok && location.reload())
            }
          >
            Save
          </Button>
        </CardContent>
      </Card>
    </Shell>
  );
}

export function GstSettings() {
  const me = useSession();
  const [saving, setSaving] = React.useState(false);
  const [v, setV] = React.useState({ gstin: me.gst.gstin ?? "", legalName: me.gst.legalName ?? "", stateCode: me.gst.stateCode ?? me.business.stateCode ?? "", registrationStatus: me.gst.registrationStatus });
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <Shell title="GST" description="Used on bills and the GST summary report. Suvakta does not file returns.">
      <Card>
        <CardContent className="grid gap-4 pt-5">
          <Segmented label="Registration" value={v.registrationStatus as (typeof GST_REGISTRATION)[number]} onChange={(x) => setV({ ...v, registrationStatus: x })} options={GST_REGISTRATION.map((r) => ({ value: r, label: r === "UNREGISTERED" ? "Not registered" : r === "REGISTERED" ? "Regular" : "Composition" }))} />
          <Field id="gstin" label="GSTIN" optional error={err ?? undefined}>
            <Input id="gstin" value={v.gstin} maxLength={15} onChange={(e) => setV({ ...v, gstin: e.target.value.toUpperCase() })} placeholder="08ABCDE1234F1Z5" />
          </Field>
          <Field id="legal" label="Legal name" optional>
            <Input id="legal" value={v.legalName} onChange={(e) => setV({ ...v, legalName: e.target.value })} />
          </Field>
          <Field id="gst-state" label="State" hint="Customers from other states are billed IGST">
            <NativeSelect id="gst-state" value={v.stateCode} onChange={(e) => setV({ ...v, stateCode: e.target.value })}>
              <option value="">—</option>
              {INDIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} · {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button
            loading={saving}
            onClick={async () => {
              setErr(null);
              setSaving(true);
              try {
                await api("/business/gst", { method: "PATCH", body: { gstin: v.gstin || null, legalName: v.legalName || null, stateCode: v.stateCode || null, registrationStatus: v.registrationStatus } });
                toast.success("GST settings saved");
              } catch (e) {
                if (e instanceof ApiError) setErr(e.message);
                toast.error(errorMessage(e));
              } finally {
                setSaving(false);
              }
            }}
          >
            Save
          </Button>
        </CardContent>
      </Card>
    </Shell>
  );
}

function ToggleRow({ label, desc, checked, onChange }: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = React.useId();
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <label htmlFor={id} className="cursor-pointer">
        <span className="block text-[14.5px] font-medium">{label}</span>
        {desc && <span className="block text-[12.5px] text-muted-foreground">{desc}</span>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function InventorySettings() {
  const me = useSession();
  const { saving, save } = useSave();
  const s = me.settings;
  const [v, setV] = React.useState({ pricesIncludeGst: s.pricesIncludeGst, allowNegativeStock: s.allowNegativeStock, lowStock: String(fromMilli(s.defaultLowStockMilli)), invoicePrefix: s.invoicePrefix });
  return (
    <Shell title="Products & inventory">
      <Card>
        <CardContent className="divide-y pt-2">
          <ToggleRow label="Selling prices include GST" desc="Usual for shops selling at MRP. GST is worked out of the price." checked={v.pricesIncludeGst} onChange={(x) => setV({ ...v, pricesIncludeGst: x })} />
          <ToggleRow label="Allow selling below zero stock" desc="Off is safer: a sale is blocked when stock would go negative." checked={v.allowNegativeStock} onChange={(x) => setV({ ...v, allowNegativeStock: x })} />
          <div className="grid gap-4 py-4 sm:grid-cols-2">
            <Field id="low-default" label="Default low-stock alert" hint="For new products">
              <Input id="low-default" inputMode="decimal" value={v.lowStock} onChange={(e) => setV({ ...v, lowStock: e.target.value })} />
            </Field>
            <Field id="prefix" label="Bill number prefix" hint="e.g. INV → INV-0042">
              <Input id="prefix" value={v.invoicePrefix} maxLength={8} onChange={(e) => setV({ ...v, invoicePrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} />
            </Field>
          </div>
          <div className="pt-4">
            <Button
              className="w-full"
              loading={saving}
              onClick={() => save("/business/settings", { pricesIncludeGst: v.pricesIncludeGst, allowNegativeStock: v.allowNegativeStock, defaultLowStockMilli: toMilli(v.lowStock || "0") ?? 0, invoicePrefix: v.invoicePrefix || "INV" })}
            >
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </Shell>
  );
}

const FLAG_LABELS: Record<FeatureFlag, string> = {
  VOICE_ENABLED: "Voice input",
  AI_INSIGHTS_ENABLED: "Dashboard insights",
  OFFLINE_ENABLED: "Offline mode (queue sales when offline)",
  GST_ENABLED: "GST features",
  REPORTS_ENABLED: "Reports",
};

export function VoiceSettings() {
  const me = useSession();
  const can = useCan();
  const { saving, save } = useSave();
  const [provider, setProvider] = React.useState(me.settings.voiceProvider as "auto" | "browser" | "server");
  const [aiEnabled, setAiEnabled] = React.useState(me.settings.aiEnabled);
  const [language, setLanguage] = React.useState(me.settings.language as "hinglish" | "english" | "hindi");
  const [flags, setFlags] = React.useState(me.flags);
  const supportKey = React.useSyncExternalStore(
    () => () => undefined,
    () => `${new BrowserSpeechProvider().isSupported()}|${new ServerSpeechProvider().isSupported()}`,
    () => "",
  );
  const support = supportKey ? { browser: supportKey.startsWith("true"), server: supportKey.endsWith("true") } : null;
  const manage = can("settings.manage");
  return (
    <Shell title="Voice & AI" description="How Suvakta listens and understands.">
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Speech recognition</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Segmented
            label="Speech engine"
            value={provider}
            onChange={setProvider}
            options={[
              { value: "auto", label: "Automatic" },
              { value: "browser", label: "Phone/browser" },
              { value: "server", label: "Suvakta server" },
            ]}
          />
          <p className="text-[13px] text-muted-foreground">
            This device: browser recognition {support?.browser ? "✓ available" : "✗ not available"} · recording {support?.server ? "✓ available" : "✗ not available"}. Audio is not stored — only the text.
          </p>
          <Segmented
            label="Reply language"
            value={language}
            onChange={setLanguage}
            options={[
              { value: "hinglish", label: "Hinglish" },
              { value: "english", label: "English" },
              { value: "hindi", label: "Hindi" },
            ]}
          />
          <ToggleRow label="Use AI for complex sentences" desc="Simple commands are understood on the server without AI. Off = rules only." checked={aiEnabled} onChange={setAiEnabled} />
        </CardContent>
      </Card>
      {manage && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Features</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {FEATURE_FLAGS.map((f) => (
              <ToggleRow key={f} label={FLAG_LABELS[f]} checked={flags[f]} onChange={(x) => setFlags({ ...flags, [f]: x })} />
            ))}
          </CardContent>
        </Card>
      )}
      <Button
        className="w-full"
        loading={saving}
        disabled={!manage}
        onClick={() => save("/business/settings", { voiceProvider: provider, aiEnabled, language, featureFlags: flags }).then((ok) => ok && location.reload())}
      >
        {manage ? "Save" : "Only the owner can change these"}
      </Button>
    </Shell>
  );
}

export function NotificationSettings() {
  const me = useSession();
  const { saving, save } = useSave();
  const [v, setV] = React.useState({ lowStockNotifications: me.settings.lowStockNotifications, dailySummaryNotifications: me.settings.dailySummaryNotifications, outstandingReminders: me.settings.outstandingReminders });
  return (
    <Shell title="Notifications">
      <Card>
        <CardContent className="divide-y pt-2">
          <ToggleRow label="Low stock alerts" desc="When a product reaches its alert level" checked={v.lowStockNotifications} onChange={(x) => setV({ ...v, lowStockNotifications: x })} />
          <ToggleRow label="Daily summary" desc="Every evening at 9 pm" checked={v.dailySummaryNotifications} onChange={(x) => setV({ ...v, dailySummaryNotifications: x })} />
          <ToggleRow label="Udhaar reminders" desc="Weekly, for dues older than a week" checked={v.outstandingReminders} onChange={(x) => setV({ ...v, outstandingReminders: x })} />
          <div className="pt-4">
            <Button className="w-full" loading={saving} onClick={() => save("/business/settings", v)}>
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </Shell>
  );
}

export function SecuritySettings() {
  const me = useSession();
  const [cur, setCur] = React.useState("");
  const [next, setNext] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <Shell title="Security" description={`Logged in as ${me.user.name} (+91 ${me.user.mobile})`}>
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (next.length < 8) return void toast.error("New password must have at least 8 characters.");
              setBusy(true);
              try {
                await api("/auth/change-password", { method: "POST", body: { currentPassword: cur, newPassword: next } });
                toast.success("Password changed");
                setCur("");
                setNext("");
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field id="cur" label="Current password">
              <PasswordInput id="cur" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
            </Field>
            <Field id="new" label="New password" hint="At least 8 characters">
              <PasswordInput id="new" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Button type="submit" loading={busy} className="w-full">
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>
    </Shell>
  );
}

export function DataSettings() {
  const r = presetRange("30d");
  const year = { from: `${r.to.slice(0, 4)}-01-01`, to: r.to };
  const exports = [
    { label: "Products", href: "/api/products/export" },
    { label: "Sales (this year)", href: `/api/sales/export${qs(year)}` },
    { label: "Purchases (this year)", href: `/api/purchases/export${qs(year)}` },
    { label: "Customers", href: "/api/customers/export" },
    { label: "Suppliers", href: "/api/suppliers/export" },
    { label: "Expenses (this year)", href: `/api/expenses/export${qs(year)}` },
  ];
  return (
    <Shell title="Data" description="Your data is yours. Download it any time as CSV (opens in Excel / Google Sheets).">
      <Card>
        <CardContent className="divide-y pt-2">
          {exports.map((e) => (
            <div key={e.label} className="flex items-center justify-between py-3">
              <span className="text-[14.5px] font-medium">{e.label}</span>
              <Button variant="outline" size="sm" asChild>
                <a href={e.href} download>
                  Download CSV
                </a>
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
      <p className="mt-3 text-[12.5px] text-muted-foreground">Backups: the database is also backed up by Cloudflare D1 Time Travel (point-in-time restore for 30 days).</p>
    </Shell>
  );
}
