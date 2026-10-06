# DukaanOS

**Run your business by simply talking to it.**

DukaanOS is a mobile-first PWA for Indian small businesses — kirana, paan, cafés, salons,
stationery, electronics, distributors. Shopkeepers speak in Hindi, English or Hinglish, see
exactly what was understood, confirm, and it's recorded: sales, stock, khata (udhaar),
purchases, expenses and GST-ready reports.

> 🎙 "Aaj 20 Coke aur 10 Sprite biki" → *Which Coke?* → Coke 500ml ×20, Sprite 250ml ×10,
> Total ₹1,000, stock 34 → 14 → **Confirm** → Done ✓ Stock updated.

## Highlights

- **Voice → understand → confirm → execute → record.** The AI only proposes; the server
  validates and executes through the transaction engine. Nothing changes without a tap.
- **Never guesses.** Ambiguous products or customers ("Coke" → 250ml / 500ml / 750ml) always
  come back as a question. Unknown products are reported, never invented.
- **Hinglish-first parsing.** A deterministic rules parser handles everyday phrases instantly
  and for free; Workers AI (Llama 3.3) handles the rest via a strict JSON contract.
- **Correct money.** Integer paise, GST-inclusive/exclusive pricing, CGST/SGST/IGST, bill
  discounts allocated exactly, weighted-average cost, gross & net profit.
- **Trustworthy data.** Atomic D1 batches, a DB trigger that blocks negative stock,
  idempotency keys on every write, undo by reversal (never deletion), a full audit log.
- **Khata.** Customer udhaar, payments, adjustments, running balances, WhatsApp reminders.
- **Works offline.** Installable PWA, cached catalogue, and an offline queue for sales,
  payments and expenses that syncs safely (idempotent) — never shown as saved until it is.
- **Multi-tenant & role-based.** Owner / Manager / Staff and custom roles; strict business
  isolation enforced on the server.

## Tech stack

| Layer | Choice |
|---|---|
| UI | Next.js App Router via [vinext](https://github.com/cloudflare/vinext) (Vite), React 19, TypeScript (strict), Tailwind CSS v4, Radix / shadcn-style components, Lucide, TanStack Query, Zustand, React Hook Form + Zod, Recharts |
| API | Hono, mounted at `/api/*` inside the same Worker |
| Data | Cloudflare D1 (SQLite) + Drizzle ORM, R2 for product photos |
| AI | Workers AI — `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (intent JSON), `@cf/openai/whisper-large-v3-turbo` (speech) |
| Runtime | One Cloudflare Worker + cron trigger, Rate Limiting binding |
| Tests | Vitest (unit, Node) · `@cloudflare/vitest-pool-workers` (integration on real D1) · Playwright (E2E on the production build) |

## Quick start

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm db:seed:local     # demo "Sharma General Store" with 30 days of history
pnpm dev               # → http://localhost:3100
```

Demo logins (local only): **98765 43210 / dukaan123** (owner) · **98765 00001 / staff1234** (staff).

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server (workerd, local D1/R2) on port 3100 |
| `pnpm build` / `pnpm start` | Production build / run it locally with Wrangler |
| `pnpm typecheck` · `pnpm lint` | TypeScript strict · ESLint |
| `pnpm test` | Unit + integration tests (108) |
| `pnpm test:e2e` | Playwright E2E (build first) |
| `pnpm check` | typecheck + lint + test + build |
| `pnpm db:generate` | Generate a migration from `src/server/db/schema.ts` |
| `pnpm db:migrate:{local,staging,production}` | Apply migrations |
| `pnpm db:seed:local` · `pnpm db:reset:local` | Seed / wipe + reseed the local DB |
| `pnpm deploy:{staging,production}` | Deploy (see [DEPLOYMENT.md](DEPLOYMENT.md)) |

## Project layout

```
src/app/            routes: (auth) login/signup/reset · onboarding · (app) all business pages · api/[[...route]]
src/features/       client UI by domain (sales, inventory, parties, voice, ai, reports, settings…)
src/components/     ui primitives, layout shell, shared states/inputs, charts
src/lib/            isomorphic: money, qty, dates (IST), pricing/GST, text (Hindi/Hinglish), csv, offline queue
src/schemas/        zod API contracts shared by client and server
src/server/api/     Hono app, middleware (auth, CSRF, rate limit, tenancy), routes
src/server/services transaction engine & domain services (framework-free)
src/server/ai/      contract, rules parser, LLM parser, resolver, planner, assistant, STT
src/server/db/      Drizzle schema, client, sample catalogues
migrations/         D1 SQL migrations · worker/ Worker entry (fetch + cron) · tests/ unit, integration, e2e
```

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — system design, data model, AI pipeline, security, offline sync
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — phases and status
- [DEPLOYMENT.md](DEPLOYMENT.md) — environments, migrations, deploy, backups, rollback

## API (selected)

All responses: `{ "success": true, "data": … }` or `{ "success": false, "error": { "code", "message" } }`.

```
POST /api/auth/signup | login | logout | forgot-password | reset-password    GET /api/me
GET|POST /api/products   PATCH /api/products/:id   POST /api/products/import   GET /api/products/export
GET /api/inventory   GET /api/inventory/movements   POST /api/inventory/adjust
GET|POST /api/sales   GET /api/sales/:id   POST /api/sales/:id/reverse
GET|POST /api/purchases   POST /api/purchases/:id/reverse
GET|POST /api/customers   POST /api/customers/:id/payment | credit | adjust
GET|POST /api/suppliers   POST /api/suppliers/:id/payment
GET|POST /api/expenses   GET /api/reports/{dashboard,sales,profit,expenses,gst,…}   GET /api/reports/export/:kind
POST /api/ai/interpret   POST /api/ai/voice   POST /api/ai/interactions/:id/{clarify,confirm,cancel}
GET /api/audit   GET /api/notifications   GET /api/search   /api/team/*   /api/business/*
```

Mutating endpoints accept an `Idempotency-Key` header; replays return the original result.
