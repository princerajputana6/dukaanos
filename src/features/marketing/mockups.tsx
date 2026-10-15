import { ArrowRightIcon, BellIcon, CheckCircle2Icon, MicIcon, PencilIcon, SearchIcon, TrendingUpIcon, XIcon } from "lucide-react";

/**
 * Faithful, lightweight recreations of real Suvakta screens for the marketing site — built from
 * the same design tokens as the app, so they always match the product and stay crisp at any size.
 */

function StatusBar({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between px-5 pt-8 pb-1 text-[11px] font-medium text-muted-foreground">
      <span>9:41</span>
      <span className="font-semibold text-foreground">{title}</span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-4 rounded-sm border border-current" />
      </span>
    </div>
  );
}

/** The hero: a spoken sale understood, ready to confirm. */
export function VoiceConfirmMock() {
  const lines = [
    { name: "Coke 500ml", detail: "×20 bottle @ ₹40", amt: "₹800" },
    { name: "Sprite 250ml", detail: "×10 bottle @ ₹20", amt: "₹200" },
  ];
  return (
    <div className="flex h-full flex-col bg-muted/40">
      <StatusBar title="Talk to Suvakta" />
      <div className="px-4 pt-2 text-center text-[12px] text-muted-foreground">“Aaj 20 Coke aur 10 Sprite biki”</div>
      <div className="flex-1 overflow-hidden px-4 pt-3">
        <div className="overflow-hidden rounded-2xl border bg-card shadow-lift">
          <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2.5">
            <div>
              <p className="text-[10.5px] font-medium text-muted-foreground">I understood:</p>
              <p className="text-[15px] font-semibold">Sale</p>
            </div>
            <span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-semibold text-success">Ready</span>
          </div>
          <div className="space-y-2 px-4 py-3">
            {lines.map((l) => (
              <div key={l.name} className="flex items-baseline justify-between gap-3">
                <div>
                  <p className="text-[13.5px] font-semibold">{l.name}</p>
                  <p className="text-[11px] text-muted-foreground">{l.detail}</p>
                </div>
                <p className="text-[13.5px] font-medium">{l.amt}</p>
              </div>
            ))}
            <div className="flex justify-between border-t pt-2 text-[11px] text-muted-foreground">
              <span>GST included</span>
              <span>₹47.60</span>
            </div>
            <div className="flex justify-between text-[17px] font-bold">
              <span>Total</span>
              <span>₹1,000</span>
            </div>
            <div className="rounded-xl bg-muted/60 p-2.5">
              <p className="mb-1 text-[9.5px] font-semibold tracking-wide text-muted-foreground uppercase">Stock impact</p>
              <div className="flex items-center justify-between text-[12px]">
                <span>Coke 500ml</span>
                <span className="flex items-center gap-1">
                  34 <ArrowRightIcon className="size-3 text-muted-foreground" /> <span className="font-semibold">14</span> <span className="font-semibold text-destructive">(−20)</span>
                </span>
              </div>
            </div>
          </div>
          <div className="grid gap-2 border-t p-3">
            <div className="flex h-10 items-center justify-center gap-2 rounded-xl bg-primary text-[13.5px] font-semibold text-primary-foreground">
              <CheckCircle2Icon className="size-4" /> Confirm Sale
            </div>
            <div className="grid grid-cols-2 gap-2 text-[12.5px] font-medium text-muted-foreground">
              <div className="flex h-9 items-center justify-center gap-1.5 rounded-xl border bg-card">
                <PencilIcon className="size-3.5" /> Edit
              </div>
              <div className="flex h-9 items-center justify-center gap-1.5 rounded-xl">
                <XIcon className="size-3.5" /> Cancel
              </div>
            </div>
          </div>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">Nothing is saved until you confirm.</p>
      </div>
      <MicDock />
    </div>
  );
}

function MicDock() {
  return (
    <div className="flex items-center justify-center pb-6">
      <span className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lift ring-8 ring-primary/15">
        <MicIcon className="size-6" />
      </span>
    </div>
  );
}

export function DashboardMock() {
  const bars = [40, 62, 48, 75, 58, 88, 70];
  return (
    <div className="flex h-full flex-col">
      <StatusBar title="Dashboard" />
      <div className="flex-1 space-y-3 overflow-hidden px-4 pt-2">
        <div>
          <p className="text-[12px] text-muted-foreground">Aaj ka hisaab · Monday</p>
          <p className="text-[20px] font-bold">Namaste, Prince 👋</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl border bg-card p-3">
            <p className="text-[11px] text-muted-foreground">Today’s sales</p>
            <p className="text-[19px] font-bold">₹18,420</p>
            <p className="flex items-center gap-1 text-[11px] font-semibold text-success">
              <TrendingUpIcon className="size-3" /> +12%
            </p>
          </div>
          <div className="rounded-2xl border bg-card p-3">
            <p className="text-[11px] text-muted-foreground">Profit</p>
            <p className="text-[19px] font-bold">₹4,160</p>
            <p className="text-[11px] text-muted-foreground">82 bills</p>
          </div>
          <div className="rounded-2xl border bg-card p-3">
            <p className="text-[11px] text-muted-foreground">Udhaar pending</p>
            <p className="text-[19px] font-bold">₹7,850</p>
            <p className="text-[11px] text-primary">14 customers</p>
          </div>
          <div className="rounded-2xl border bg-card p-3">
            <p className="text-[11px] text-muted-foreground">Cash / UPI</p>
            <p className="text-[19px] font-bold">60 / 40</p>
            <p className="text-[11px] text-muted-foreground">payment mix</p>
          </div>
        </div>
        <div className="rounded-2xl border bg-card p-3">
          <p className="mb-2 text-[12px] font-semibold">This week</p>
          <div className="flex h-20 items-end gap-2">
            {bars.map((h, i) => (
              <div key={i} className="flex-1 rounded-t-md bg-primary/85" style={{ height: `${h}%`, opacity: 0.55 + i * 0.06 }} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-2xl border border-warning/30 bg-warning-soft px-3 py-2.5">
          <BellIcon className="size-4 text-warning-foreground" />
          <p className="text-[12px] text-warning-foreground">
            <span className="font-semibold">3 products</span> low on stock — tap to reorder
          </p>
        </div>
      </div>
    </div>
  );
}

export function InventoryMock() {
  const items = [
    { name: "Coke 500ml", sub: "Cold Drinks", qty: "14 bottle", tone: "warn" },
    { name: "Parle-G", sub: "Biscuits", qty: "126 pkt", tone: "ok" },
    { name: "Bisleri Water 1L", sub: "Beverages", qty: "0 bottle", tone: "out" },
    { name: "Maggi 70g", sub: "Instant Food", qty: "58 pkt", tone: "ok" },
    { name: "Amul Butter 100g", sub: "Dairy", qty: "9 pcs", tone: "warn" },
    { name: "Tata Salt 1kg", sub: "Grocery", qty: "40 pkt", tone: "ok" },
  ] as const;
  const badge = { ok: "bg-success-soft text-success", warn: "bg-warning-soft text-warning-foreground", out: "bg-destructive-soft text-destructive" };
  return (
    <div className="flex h-full flex-col">
      <StatusBar title="Inventory" />
      <div className="px-4 pt-2">
        <p className="text-[18px] font-bold">Inventory</p>
        <div className="mt-2 flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-[12px] text-muted-foreground">
          <SearchIcon className="size-3.5" /> Search products
        </div>
        <div className="mt-2 flex gap-1.5">
          {["All", "Low stock", "Out of stock"].map((f, i) => (
            <span key={f} className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${i === 1 ? "border-primary bg-primary-soft text-primary-soft-foreground" : "bg-card text-muted-foreground"}`}>
              {f}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-2 flex-1 divide-y overflow-hidden border-t">
        {items.map((it) => (
          <div key={it.name} className="flex items-center justify-between px-4 py-2.5">
            <div>
              <p className="text-[13.5px] font-semibold">{it.name}</p>
              <p className="text-[11px] text-muted-foreground">{it.sub}</p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge[it.tone]}`}>{it.qty}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function KhataMock() {
  const rows = [
    { name: "Ramesh Kumar", phone: "98765 43210", bal: "₹1,250", initials: "RK" },
    { name: "Sunita Devi", phone: "90123 45678", bal: "₹640", initials: "SD" },
    { name: "Imran Khan", phone: "99887 76655", bal: "₹2,100", initials: "IK" },
    { name: "Priya Sharma", phone: "80012 34567", bal: "₹375", initials: "PS" },
    { name: "Mohan Lal", phone: "70809 10111", bal: "₹980", initials: "ML" },
  ];
  return (
    <div className="flex h-full flex-col">
      <StatusBar title="Khata" />
      <div className="px-4 pt-2">
        <p className="text-[18px] font-bold">Customers</p>
        <div className="mt-2 rounded-2xl bg-primary-soft px-4 py-3">
          <p className="text-[11px] text-primary-soft-foreground/80">Total udhaar to collect</p>
          <p className="text-[22px] font-bold text-primary-soft-foreground">₹7,850</p>
        </div>
      </div>
      <div className="mt-2 flex-1 divide-y overflow-hidden border-t">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-3 px-4 py-2.5">
            <span className="flex size-9 items-center justify-center rounded-full bg-muted text-[12px] font-bold text-muted-foreground">{r.initials}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold">{r.name}</p>
              <p className="text-[11px] text-muted-foreground">+91 {r.phone}</p>
            </div>
            <div className="text-right">
              <p className="text-[13.5px] font-bold text-destructive">{r.bal}</p>
              <p className="text-[10px] text-muted-foreground">baki</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Desktop reports view. */
export function ReportsMock() {
  const series = [52, 61, 48, 72, 66, 90, 78, 84, 69, 95, 88, 74];
  return (
    <div className="flex h-full flex-col bg-muted/30 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-[13px] text-muted-foreground">Reports · Last 30 days</p>
          <p className="text-[22px] font-bold">Business overview</p>
        </div>
        <span className="rounded-lg border bg-card px-3 py-1.5 text-[12px] font-medium">This month ▾</span>
      </div>
      <div className="mb-4 grid grid-cols-4 gap-3">
        {[
          { k: "Sales", v: "₹4.82L" },
          { k: "Net profit", v: "₹71,400" },
          { k: "Expenses", v: "₹38,200" },
          { k: "Stock value", v: "₹1.19L" },
        ].map((c) => (
          <div key={c.k} className="rounded-2xl border bg-card p-3.5">
            <p className="text-[12px] text-muted-foreground">{c.k}</p>
            <p className="text-[20px] font-bold">{c.v}</p>
          </div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-[1.6fr_1fr] gap-3">
        <div className="rounded-2xl border bg-card p-4">
          <p className="mb-3 text-[13px] font-semibold">Daily sales</p>
          <div className="flex h-[150px] items-end gap-1.5">
            {series.map((h, i) => (
              <div key={i} className="flex-1 rounded-t bg-primary" style={{ height: `${h}%`, opacity: 0.5 + (i / series.length) * 0.5 }} />
            ))}
          </div>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="mb-3 text-[13px] font-semibold">Top products</p>
          <div className="space-y-2.5">
            {[
              { n: "Coke 500ml", w: "90%" },
              { n: "Parle-G", w: "72%" },
              { n: "Maggi 70g", w: "61%" },
              { n: "Amul Milk", w: "48%" },
              { n: "Lays", w: "35%" },
            ].map((p) => (
              <div key={p.n}>
                <div className="mb-1 flex justify-between text-[11.5px]">
                  <span>{p.n}</span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary/80" style={{ width: p.w }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Additional screens ────────────────────────────────────────────────────────

/** The listening state: mic active, live interim transcript, waveform. */
export function VoiceListeningMock() {
  return (
    <div className="flex h-full flex-col bg-muted/40">
      <StatusBar title="Talk to Suvakta" />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <span className="relative flex size-24 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" />
          <MicIcon className="size-9" />
        </span>
        <div className="flex h-8 items-end gap-1.5">
          {[40, 70, 95, 55, 80, 45, 90, 60, 75].map((h, i) => (
            <span key={i} className="w-1.5 rounded-full bg-primary" style={{ height: `${h}%`, opacity: 0.4 + (i % 3) * 0.2 }} />
          ))}
        </div>
        <div>
          <p className="text-[12px] font-medium text-primary">Sun raha hoon…</p>
          <p className="mt-1 text-[16px] font-semibold">“Ramesh ko paanch Coke udhaar…”</p>
        </div>
      </div>
      <p className="pb-10 text-center text-[11px] text-muted-foreground">Tap to stop · or just pause</p>
    </div>
  );
}

/** Supplier purchase understood. */
export function PurchaseMock() {
  return (
    <div className="flex h-full flex-col bg-muted/40">
      <StatusBar title="Talk to Suvakta" />
      <div className="px-4 pt-2 text-center text-[12px] text-muted-foreground">“Sharma se 2 crate Coke aayi”</div>
      <div className="flex-1 px-4 pt-3">
        <div className="overflow-hidden rounded-2xl border bg-card shadow-lift">
          <div className="border-b bg-muted/40 px-4 py-2.5">
            <p className="text-[10.5px] font-medium text-muted-foreground">Purchase · Sharma Wholesale</p>
            <p className="text-[15px] font-semibold">Stock received</p>
          </div>
          <div className="space-y-2 px-4 py-3">
            <div className="flex items-baseline justify-between">
              <div>
                <p className="text-[13.5px] font-semibold">Coke 500ml</p>
                <p className="text-[11px] text-muted-foreground">2 crate × 24 = 48 bottle</p>
              </div>
              <p className="text-[13.5px] font-medium">₹1,296</p>
            </div>
            <div className="rounded-xl bg-muted/60 p-2.5 text-[12px]">
              <div className="flex items-center justify-between">
                <span>Coke 500ml stock</span>
                <span className="flex items-center gap-1">
                  34 <ArrowRightIcon className="size-3 text-muted-foreground" /> <span className="font-semibold text-success">82</span>
                </span>
              </div>
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>Supplier balance</span>
              <span>₹1,296 payable</span>
            </div>
          </div>
          <div className="border-t p-3">
            <div className="flex h-10 items-center justify-center gap-2 rounded-xl bg-primary text-[13.5px] font-semibold text-primary-foreground">
              <CheckCircle2Icon className="size-4" /> Confirm Purchase
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ExpenseMock() {
  const rows = [
    { cat: "Electricity", note: "Bijli bill", amt: "₹1,200", icon: "💡" },
    { cat: "Rent", note: "Dukaan kiraya", amt: "₹8,000", icon: "🏠" },
    { cat: "Transport", note: "Tempo bhada", amt: "₹450", icon: "🚚" },
    { cat: "Salary", note: "Staff — Raju", amt: "₹9,000", icon: "💰" },
  ];
  return (
    <div className="flex h-full flex-col">
      <StatusBar title="Expenses" />
      <div className="px-4 pt-2">
        <p className="text-[18px] font-bold">Expenses</p>
        <div className="mt-2 rounded-2xl border bg-card p-3">
          <p className="text-[11px] text-muted-foreground">This month</p>
          <p className="text-[22px] font-bold">₹38,200</p>
        </div>
      </div>
      <div className="mt-2 flex-1 divide-y overflow-hidden border-t">
        {rows.map((r) => (
          <div key={r.note} className="flex items-center gap-3 px-4 py-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-muted text-[16px]">{r.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold">{r.cat}</p>
              <p className="text-[11px] text-muted-foreground">{r.note}</p>
            </div>
            <p className="text-[13.5px] font-semibold">{r.amt}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GstReportMock() {
  return (
    <div className="flex h-full flex-col">
      <StatusBar title="GST Summary" />
      <div className="flex-1 space-y-3 px-4 pt-2">
        <div>
          <p className="text-[12px] text-muted-foreground">GST · This month</p>
          <p className="text-[18px] font-bold">Tax summary</p>
        </div>
        <div className="rounded-2xl border bg-card p-3.5">
          <p className="text-[11px] text-muted-foreground">Output tax (sales)</p>
          <p className="text-[19px] font-bold">₹24,180</p>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]">
            {[
              { k: "CGST", v: "₹10,090" },
              { k: "SGST", v: "₹10,090" },
              { k: "IGST", v: "₹4,000" },
            ].map((c) => (
              <div key={c.k} className="rounded-lg bg-muted py-1.5">
                <p className="text-muted-foreground">{c.k}</p>
                <p className="font-semibold">{c.v}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border bg-card p-3.5">
          <p className="text-[11px] text-muted-foreground">Input tax (purchases)</p>
          <p className="text-[19px] font-bold">₹16,420</p>
        </div>
        <div className="flex items-center justify-between rounded-2xl bg-primary-soft px-4 py-3">
          <span className="text-[12.5px] font-medium text-primary-soft-foreground">Net GST payable</span>
          <span className="text-[18px] font-bold text-primary-soft-foreground">₹7,760</span>
        </div>
      </div>
    </div>
  );
}

export function SalesTodayMock() {
  const bills = [
    { no: "#1042", items: "Coke ×2, Lays ×1", amt: "₹120", pay: "UPI" },
    { no: "#1041", items: "Parle-G ×5", amt: "₹50", pay: "Cash" },
    { no: "#1040", items: "Maggi ×3, Amul", amt: "₹165", pay: "Udhaar" },
    { no: "#1039", items: "Bisleri ×6", amt: "₹120", pay: "Cash" },
    { no: "#1038", items: "Tata Salt ×2", amt: "₹56", pay: "UPI" },
  ];
  const tone: Record<string, string> = { UPI: "bg-info-soft text-info", Cash: "bg-success-soft text-success", Udhaar: "bg-warning-soft text-warning-foreground" };
  return (
    <div className="flex h-full flex-col">
      <StatusBar title="Sales" />
      <div className="px-4 pt-2">
        <p className="text-[18px] font-bold">Today’s sales</p>
        <p className="text-[12px] text-muted-foreground">82 bills · ₹18,420</p>
      </div>
      <div className="mt-2 flex-1 divide-y overflow-hidden border-t">
        {bills.map((b) => (
          <div key={b.no} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold">
                {b.no} <span className="font-normal text-muted-foreground">· {b.items}</span>
              </p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone[b.pay]}`}>{b.pay}</span>
            <p className="w-12 text-right text-[13px] font-bold">{b.amt}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
