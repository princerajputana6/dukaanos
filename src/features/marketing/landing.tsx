"use client";
import {
  ArrowRightIcon,
  BarChart3Icon,
  BellRingIcon,
  BookOpenIcon,
  BoxesIcon,
  CheckCircle2Icon,
  CloudOffIcon,
  FileSpreadsheetIcon,
  GitBranchIcon,
  HistoryIcon,
  LanguagesIcon,
  LockKeyholeIcon,
  MessageCircleIcon,
  MicIcon,
  PackageCheckIcon,
  ReceiptIndianRupeeIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Undo2Icon,
  UsersIcon,
  WalletIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { BrowserFrame, PhoneFrame, VoiceWave } from "./frames";
import { DashboardMock, ExpenseMock, GstReportMock, InventoryMock, KhataMock, PurchaseMock, ReportsMock, SalesTodayMock, VoiceConfirmMock, VoiceListeningMock } from "./mockups";
import { QuoteForm } from "./quote-form";

const SAYINGS = ["“Aaj 20 Coke aur 10 Sprite biki”", "“Ramesh ne ₹500 diye”", "“Sharma se 2 crate Pepsi aayi”", "“Kaunsa maal khatam ho raha hai?”", "“Bijli ka bill 1200 diya”", "“Aaj kitna munafa hua?”"];

const SHOP_TYPES = ["🛒 Kirana", "🌿 Paan shop", "☕ Café & chai", "💇 Salon", "✏️ Stationery", "🔌 Electronics", "👕 Garments", "🚚 Distributors", "🏬 Retail"];

const STEPS = [
  { icon: MicIcon, title: "Bolo", body: "Tap the mic and speak naturally — Hindi, English or Hinglish. No forms, no typing." },
  { icon: SparklesIcon, title: "Suvakta samjhe", body: "It understands products, quantities, customers and money, and picks the right item — your usual Coke, the size in stock." },
  { icon: CheckCircle2Icon, title: "Aap confirm karo", body: "See exactly what will be saved: bill, total, GST and the stock change. Change anything with one tap." },
  { icon: PackageCheckIcon, title: "Ho gaya", body: "Sale recorded, stock updated, khata adjusted and reports refreshed — instantly and safely." },
];

const SPOTLIGHTS: Array<{ eyebrow: string; title: string; body: string; points: string[]; Mock: () => React.ReactNode }> = [
  {
    eyebrow: "Voice billing",
    title: "Billing as fast as you can speak",
    body: "Say what sold and Suvakta prepares the bill. It learns what your shop means — “Coke” becomes your usual Coke 500ml — and never saves anything until you confirm.",
    points: ["Understands Hindi script, English and Hinglish", "Auto-picks your usual product, or the only one in stock", "Shows total, GST and stock impact before saving"],
    Mock: VoiceConfirmMock,
  },
  {
    eyebrow: "Stock & inventory",
    title: "Know what’s on the shelf — always",
    body: "Every sale and purchase updates stock automatically. Crates, boxes and packets convert to pieces for you, and low-stock alerts tell you what to reorder before it runs out.",
    points: ["Pack units: 1 crate = 24 bottles, automatically", "Low-stock and out-of-stock alerts", "Stock can never go negative by mistake"],
    Mock: InventoryMock,
  },
  {
    eyebrow: "Khata & udhaar",
    title: "A khata that never forgets",
    body: "Record udhaar and payments by voice. Every customer’s running balance is always up to date, and a polite WhatsApp reminder is one tap away.",
    points: ["“Ramesh ko 5 Coke udhaar” — done", "Running balance and full history per customer", "One-tap WhatsApp payment reminders"],
    Mock: KhataMock,
  },
  {
    eyebrow: "Dashboard",
    title: "Your whole business on one screen",
    body: "Today’s sales, profit, cash vs UPI vs udhaar, top products and what needs attention — the moment you open the app. A summary arrives every evening at 9 PM.",
    points: ["Live sales, profit and payment mix", "Top-selling products and slow movers", "Daily summary every night"],
    Mock: DashboardMock,
  },
];

const FEATURES: Array<{ icon: LucideIcon; title: string; body: string }> = [
  { icon: LanguagesIcon, title: "Speaks your language", body: "Hindi, English and Hinglish — including how shops actually talk: “biki”, “aayi”, “udhaar”, “baki”." },
  { icon: ReceiptIndianRupeeIcon, title: "GST-ready", body: "GST-inclusive or exclusive pricing, CGST/SGST/IGST split and a GST summary of output and input tax." },
  { icon: BoxesIcon, title: "Purchases & suppliers", body: "Record stock coming in by voice, track what you owe each supplier and keep purchase costs accurate." },
  { icon: WalletIcon, title: "Expenses", body: "Rent, bijli, salary, transport — log expenses in seconds and see real net profit." },
  { icon: BarChart3Icon, title: "Profit, the right way", body: "Weighted-average costing, bill discounts handled exactly, and gross and net profit you can trust." },
  { icon: CloudOffIcon, title: "Works offline", body: "Install it like an app. Bad network? Keep billing — entries sync safely when you’re back online." },
  { icon: GitBranchIcon, title: "Multiple branches", body: "Run several shops from one account. Each branch has its own stock and khata." },
  { icon: UsersIcon, title: "Staff & roles", body: "Owner, manager and staff roles with the right permissions. Staff can bill without seeing your profits." },
  { icon: Undo2Icon, title: "Undo without losing history", body: "Made a mistake? Undo reverses an entry cleanly — nothing is ever silently deleted." },
  { icon: HistoryIcon, title: "Complete audit trail", body: "Every change records who did it, when and how — by voice, by hand or offline." },
  { icon: FileSpreadsheetIcon, title: "Import & export", body: "Bring your product list from Excel/CSV in one go and export reports whenever you need them." },
  { icon: BellRingIcon, title: "Smart alerts", body: "Low stock, pending udhaar and a daily business summary — the app tells you what needs attention." },
];

const TRUST = [
  { icon: ShieldCheckIcon, title: "AI proposes, you decide", body: "The AI never changes your data. It prepares a proposal; only your tap on Confirm saves it." },
  { icon: LockKeyholeIcon, title: "Your data is yours", body: "Every shop’s data is strictly isolated. Passwords are hashed, connections are encrypted (HTTPS)." },
  { icon: BookOpenIcon, title: "Correct to the paisa", body: "Money is stored in exact paise, not rounded decimals. Totals, GST and balances always add up." },
  { icon: HistoryIcon, title: "Nothing disappears", body: "Entries are reversed, never deleted, and every change is in the audit log." },
];

const FAQ = [
  { q: "Do I need to know English or typing?", a: "No. Speak the way you normally do — Hindi, English or a mix. You can also tap and type if you prefer; both work everywhere." },
  { q: "What if Suvakta understands something wrong?", a: "Nothing is ever saved without your confirmation. You see the bill, total and stock change first, and can change the product, quantity or cancel with one tap." },
  { q: "Does it work without internet?", a: "Yes. Billing, payments and expenses keep working offline and sync safely when the connection returns. Voice understanding needs internet." },
  { q: "Which phones does it work on?", a: "Any modern Android phone or iPhone, and on a laptop or desktop browser. Install it to your home screen like an app — no app store needed." },
  { q: "I have more than one shop. Can I manage all of them?", a: "Yes. One account can run multiple branches, each with its own stock and khata, and you can switch between them instantly." },
  { q: "Can my staff use it?", a: "Yes. Add staff with their own login and role. Staff can record sales without seeing your profit or reports." },
  { q: "How much does it cost?", a: "Pricing depends on the number of shops and users. Request a quote and our team will call you with a plan that fits your business." },
  { q: "Is my business data safe?", a: "Your data is isolated from every other shop, protected with hashed passwords and encrypted connections, and every change is recorded in an audit log. See our Data Security page for details." },
];

function Section({ id, children, className }: { id?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={`scroll-mt-20 px-4 py-20 sm:px-6 md:py-28 ${className ?? ""}`}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

function GalleryCard({ title, sub, Mock, wide }: { title: string; sub: string; Mock: () => React.ReactNode; wide?: boolean }) {
  return (
    <div className={`flex items-center gap-5 overflow-hidden rounded-3xl border bg-card p-6 ${wide ? "md:col-span-2" : ""}`}>
      <div className="min-w-0 flex-1">
        <h3 className="text-[18px] font-semibold">{title}</h3>
        <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">{sub}</p>
      </div>
      <div className="w-[120px] shrink-0 sm:w-[132px]">
        <PhoneFrame>
          <Mock />
        </PhoneFrame>
      </div>
    </div>
  );
}

function Heading({ eyebrow, title, body, center = true }: { eyebrow: string; title: React.ReactNode; body?: string; center?: boolean }) {
  return (
    <div className={center ? "mx-auto mb-14 max-w-2xl text-center" : "mb-6"}>
      <p className="mb-3 text-[13px] font-semibold tracking-[0.14em] text-primary uppercase">{eyebrow}</p>
      <h2 className="text-[32px] leading-[1.1] font-bold tracking-tight text-balance md:text-[44px]">{title}</h2>
      {body && <p className="mt-4 text-[17px] leading-relaxed text-pretty text-muted-foreground">{body}</p>}
    </div>
  );
}

export function LandingPage() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-4 pt-10 pb-20 sm:px-6 md:pt-16 md:pb-28">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-40 left-1/2 h-[640px] w-[1100px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,oklch(0.75_0.12_172/0.28),transparent)]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)] bg-[size:56px_56px] opacity-50" />
        </div>
        <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="animate-rise">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-[13px] font-medium shadow-soft">
              <span className="text-primary">
                <VoiceWave />
              </span>
              Voice-first business app for Indian shops
            </p>
            <h1 className="text-[42px] leading-[1.02] font-bold tracking-tight text-balance sm:text-[56px] lg:text-[68px]">
              Bolo, aur <span className="bg-gradient-to-r from-primary to-[oklch(0.62_0.13_200)] bg-clip-text text-transparent">hisaab ho gaya.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[18px] leading-relaxed text-pretty text-muted-foreground">
              {BRAND.name} runs your shop by voice. Speak in Hindi, English or Hinglish to record sales, stock, udhaar, purchases and expenses — and get GST-ready reports without
              touching a register.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-13 px-6 text-[16px]">
                <Link href="#quote">
                  Request a quote <ArrowRightIcon />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-13 px-6 text-[16px]">
                <Link href="#how">See how it works</Link>
              </Button>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-muted-foreground">
              {["Hindi · English · Hinglish", "Works offline", "GST-ready", "Nothing saved without your OK"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <CheckCircle2Icon className="size-4 text-primary" aria-hidden="true" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative mx-auto w-full max-w-[320px]">
            <PhoneFrame>
              <VoiceConfirmMock />
            </PhoneFrame>
            <div className="absolute top-16 -left-6 hidden rounded-2xl border bg-card/95 px-4 py-3 shadow-lift backdrop-blur sm:block lg:-left-20">
              <p className="flex items-center gap-2 text-[13px] font-semibold">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <MicIcon className="size-3.5" />
                </span>
                “Aaj 20 Coke biki”
              </p>
            </div>
            <div className="absolute -right-4 bottom-24 hidden rounded-2xl border bg-card/95 px-4 py-3 shadow-lift backdrop-blur sm:block lg:-right-16">
              <p className="text-[12px] text-muted-foreground">Stock updated</p>
              <p className="text-[15px] font-bold">
                34 → 14 <span className="text-[12px] font-semibold text-success">✓ Saved</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Shop types ───────────────────────────────────────────────────── */}
      <div className="border-y bg-card/60 py-6">
        <p className="mb-4 text-center text-[13px] font-medium text-muted-foreground">Made for every kind of Indian business</p>
        <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
          <div className="flex w-max animate-[marquee_40s_linear_infinite] gap-3 motion-reduce:animate-none">
            {[...SHOP_TYPES, ...SHOP_TYPES].map((s, i) => (
              <span key={i} className="rounded-full border bg-background px-4 py-2 text-[14px] font-medium whitespace-nowrap" aria-hidden={i >= SHOP_TYPES.length}>
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <Section id="how">
        <Heading eyebrow="How it works" title="Four seconds from words to records" body="No training, no register, no data entry. If you can tell a helper what sold, you can use Suvakta." />
        <ol className="grid gap-4 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative rounded-3xl border bg-card p-6 shadow-soft">
              <span className="absolute top-5 right-5 text-[44px] leading-none font-bold text-muted/80 select-none" aria-hidden="true">
                {i + 1}
              </span>
              <span className="mb-5 flex size-11 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                <s.icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="text-[19px] font-semibold">{s.title}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-12 flex flex-wrap justify-center gap-2.5">
          {SAYINGS.map((s) => (
            <span key={s} className="flex items-center gap-2 rounded-full bg-primary-soft px-4 py-2 text-[14px] font-medium text-primary-soft-foreground">
              <MicIcon className="size-3.5" aria-hidden="true" /> {s}
            </span>
          ))}
        </div>
      </Section>

      {/* ── Voice demo strip ─────────────────────────────────────────────── */}
      <section className="scroll-mt-20 bg-brand px-4 py-20 text-brand-foreground sm:px-6 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <p className="mb-3 text-[13px] font-semibold tracking-[0.14em] text-brand-foreground/70 uppercase">See it in action</p>
            <h2 className="text-[32px] leading-[1.1] font-bold tracking-tight text-balance md:text-[44px]">Say it. See it. Done.</h2>
            <p className="mt-4 text-[17px] text-brand-foreground/85">One sentence becomes a recorded sale — in three steps, with you in control the whole time.</p>
          </div>
          <div className="grid items-start gap-6 md:grid-cols-3">
            {[
              { n: "1", label: "You speak", Mock: VoiceListeningMock },
              { n: "2", label: "Suvakta shows what it understood", Mock: VoiceConfirmMock },
              { n: "3", label: "You confirm — it’s recorded", Mock: SalesTodayMock },
            ].map((s) => (
              <div key={s.n} className="flex flex-col items-center">
                <div className="w-full max-w-[240px]">
                  <PhoneFrame>
                    <s.Mock />
                  </PhoneFrame>
                </div>
                <p className="mt-5 flex items-center gap-2 text-[14.5px] font-medium">
                  <span className="flex size-6 items-center justify-center rounded-full bg-white/15 text-[12px] font-bold">{s.n}</span>
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Spotlights ───────────────────────────────────────────────────── */}
      <div className="bg-[linear-gradient(to_bottom,transparent,var(--muted)_15%,var(--muted)_85%,transparent)]">
        {SPOTLIGHTS.map((s, i) => (
          <Section key={s.title} className="py-16 md:py-20">
            <div className={`grid items-center gap-12 md:grid-cols-2 ${i % 2 ? "md:[&>*:first-child]:order-2" : ""}`}>
              <div className="mx-auto w-full max-w-[290px]">
                <PhoneFrame>
                  <s.Mock />
                </PhoneFrame>
              </div>
              <div>
                <Heading eyebrow={s.eyebrow} title={s.title} center={false} />
                <p className="text-[17px] leading-relaxed text-pretty text-muted-foreground">{s.body}</p>
                <ul className="mt-6 space-y-3">
                  {s.points.map((p) => (
                    <li key={p} className="flex items-start gap-3 text-[15.5px]">
                      <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" /> {p}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Section>
        ))}
      </div>

      {/* ── App gallery (bento) ──────────────────────────────────────────── */}
      <Section id="gallery">
        <Heading eyebrow="Everything in one app" title="One app for the whole shop" body="Sales, purchases, expenses, khata and GST — every part of your business, a sentence away." />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col items-center justify-end rounded-3xl border bg-gradient-to-b from-primary-soft/50 to-card p-6 md:row-span-2">
            <div className="mb-5 text-center">
              <h3 className="text-[20px] font-semibold">Purchases by voice</h3>
              <p className="mt-1 text-[14px] text-muted-foreground">“Sharma se 2 crate Coke aayi” — stock and supplier balance updated.</p>
            </div>
            <div className="w-full max-w-[230px]">
              <PhoneFrame>
                <PurchaseMock />
              </PhoneFrame>
            </div>
          </div>
          <GalleryCard title="Expenses in seconds" sub="Rent, bijli, salary, transport — real net profit." Mock={ExpenseMock} />
          <GalleryCard title="GST-ready, always" sub="CGST/SGST/IGST and net payable, calculated for you." Mock={GstReportMock} />
          <GalleryCard title="Live inventory" sub="Low-stock alerts before you run out." Mock={InventoryMock} wide />
        </div>
      </Section>

      {/* ── Works on every device ────────────────────────────────────────── */}
      <Section className="bg-card/60">
        <Heading eyebrow="On the counter and on the laptop" title="Works on every device" body="Bill from your phone at the counter, review the big picture on a laptop — one account, always in sync. Install it like an app; it even works offline." />
        <div className="relative mx-auto max-w-4xl">
          <BrowserFrame>
            <ReportsMock />
          </BrowserFrame>
          <div className="absolute -right-2 -bottom-8 hidden w-[150px] sm:block md:-right-6 md:w-[190px]">
            <PhoneFrame>
              <DashboardMock />
            </PhoneFrame>
          </div>
        </div>
      </Section>

      {/* ── Feature grid ─────────────────────────────────────────────────── */}
      <Section id="features" className="bg-card/60">
        <Heading eyebrow="Everything included" title="A complete business OS, not just a billing app" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="group rounded-3xl border bg-background p-6 transition-shadow hover:shadow-lift">
              <span className="mb-4 flex size-11 items-center justify-center rounded-2xl bg-primary-soft text-primary transition-transform group-hover:scale-105">
                <f.icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="text-[17px] font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Before / after ───────────────────────────────────────────────── */}
      <Section>
        <Heading eyebrow="Why shops switch" title="The register, reimagined" />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border bg-card p-7">
            <h3 className="mb-4 text-[18px] font-semibold text-muted-foreground">📒 Register & memory</h3>
            <ul className="space-y-3 text-[15px] text-muted-foreground">
              {["Writing every sale by hand at rush hour", "Guessing what stock is left", "Udhaar forgotten or disputed", "Month-end totals take hours", "GST figures put together at the last minute"].map((t) => (
                <li key={t} className="flex gap-2.5">
                  <span aria-hidden="true">✕</span> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl border border-primary/30 bg-primary-soft/60 p-7">
            <h3 className="mb-4 text-[18px] font-semibold text-primary-soft-foreground">🎙 With {BRAND.name}</h3>
            <ul className="space-y-3 text-[15px]">
              {["Speak once — the bill is ready", "Live stock with low-stock alerts", "Every rupee of udhaar on record, with reminders", "Today’s sales and profit, always on screen", "GST summary ready whenever you need it"].map((t) => (
                <li key={t} className="flex gap-2.5">
                  <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" /> {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* ── Trust ────────────────────────────────────────────────────────── */}
      <section id="trust" className="scroll-mt-20 bg-brand px-4 py-20 text-brand-foreground sm:px-6 md:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <p className="mb-3 text-[13px] font-semibold tracking-[0.14em] text-brand-foreground/70 uppercase">Security & trust</p>
            <h2 className="text-[32px] leading-[1.1] font-bold tracking-tight text-balance md:text-[44px]">Built to be trusted with your shop’s money</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map((t) => (
              <div key={t.title} className="rounded-3xl bg-white/8 p-6 ring-1 ring-white/12">
                <t.icon className="mb-4 size-6" aria-hidden="true" />
                <h3 className="text-[17px] font-semibold">{t.title}</h3>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-brand-foreground/80">{t.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-10 text-center text-[14px] text-brand-foreground/75">
            Read more in our{" "}
            <Link href="/security" className="font-semibold underline underline-offset-4">
              Data Security
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="font-semibold underline underline-offset-4">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </section>

      {/* ── Pricing teaser ───────────────────────────────────────────────── */}
      <Section id="pricing">
        <Heading eyebrow="Pricing" title="Plans that fit your shop" body="From a single kirana to a chain of outlets. Tell us your size and we’ll share a plan — no card needed to start." />
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { name: "Single shop", for: "One kirana, paan or café", points: ["Voice billing & stock", "Khata & udhaar reminders", "GST-ready reports", "Works offline"] },
            { name: "Multi-branch", for: "Owners with 2+ outlets", points: ["Everything in Single shop", "Each branch its own stock & khata", "Staff accounts & roles", "One owner dashboard"], featured: true },
            { name: "Distributor", for: "Wholesale & supply", points: ["Everything in Multi-branch", "Supplier ledgers & purchases", "Bulk import / export", "Priority onboarding"] },
          ].map((p) => (
            <div key={p.name} className={`relative flex flex-col rounded-3xl border p-6 ${p.featured ? "border-primary/40 bg-primary-soft/40 shadow-lift" : "bg-card"}`}>
              {p.featured && <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground">Most popular</span>}
              <h3 className="text-[20px] font-bold">{p.name}</h3>
              <p className="mt-1 text-[13.5px] text-muted-foreground">{p.for}</p>
              <ul className="mt-5 flex-1 space-y-2.5">
                {p.points.map((pt) => (
                  <li key={pt} className="flex items-start gap-2.5 text-[14.5px]">
                    <CheckCircle2Icon className="mt-0.5 size-4.5 shrink-0 text-primary" aria-hidden="true" /> {pt}
                  </li>
                ))}
              </ul>
              <Button asChild variant={p.featured ? "default" : "outline"} className="mt-6 w-full">
                <Link href="#quote">Get a quote</Link>
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-[13.5px] text-muted-foreground">Transparent pricing shared on your call. No hidden fees, cancel anytime.</p>
      </Section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <Section id="faq">
        <Heading eyebrow="FAQ" title="Questions shop owners ask us" />
        <div className="mx-auto max-w-3xl divide-y rounded-3xl border bg-card">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold">
                {f.q}
                <span className="text-xl text-muted-foreground transition-transform group-open:rotate-45" aria-hidden="true">
                  +
                </span>
              </summary>
              <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* ── Quote ────────────────────────────────────────────────────────── */}
      <Section id="quote" className="bg-[radial-gradient(ellipse_at_top,oklch(0.75_0.12_172/0.18),transparent_60%)]">
        <div className="grid items-start gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="lg:sticky lg:top-28">
            <Heading
              eyebrow="Request a quote"
              title="Let’s get your shop talking"
              body="Tell us a little about your business. Our team will call you, set up your shop with your products, and share a plan that fits — one shop or fifty."
              center={false}
            />
            <ul className="mt-6 space-y-3 text-[15.5px]">
              {["Free setup help, including your product list", "Hands-on training for you and your staff", "Plans for single shops, chains and distributors"].map((t) => (
                <li key={t} className="flex items-start gap-3">
                  <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" /> {t}
                </li>
              ))}
            </ul>
            <p className="mt-8 flex items-center gap-2 text-[14px] text-muted-foreground">
              <MessageCircleIcon className="size-4" aria-hidden="true" /> Already a customer?{" "}
              <Link href="/login" className="font-semibold text-primary hover:underline">
                Log in
              </Link>
            </p>
          </div>
          <QuoteForm />
        </div>
      </Section>
    </>
  );
}