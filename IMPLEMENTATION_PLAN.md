# Suvakta — Implementation Plan

Status legend: ☐ todo · ◐ partly done / not verified end-to-end · ☑ done

Each phase ends with: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
A feature counts as done only when it meets the Definition of Done in the product brief
(UI, API, DB, validation, authz, loading/empty/error states, audit, tests, mobile).

## ☑ Phase 1 — Foundation
- vinext + Cloudflare Worker scaffold, `src/` layout, strict TS, ESLint, Prettier
- Tailwind v4 + shadcn/ui primitives, design tokens (brand teal, neutral zinc), Inter
- Vitest (unit, Node) + vitest-pool-workers (integration, workerd + D1) + Playwright
- `src/lib`: money, qty, dates (IST), text normalisation, ids (UUIDv7)
- Server lib: AppError + error envelope, logger with redaction, env typing, feature flags
- Hono API mounted at `/api/[[...route]]`, request-id/logging/error middleware

## ☑ Phase 2 — Authentication
- Drizzle schema + first migration (identity & tenancy tables)
- PBKDF2 password hashing, sessions (hashed token, sliding expiry), CSRF origin check
- `POST /api/auth/signup|login|logout|forgot-password|reset-password`, `GET /api/me`
- Rate limiting (binding + no-op fallback)
- UI: /login, /signup, /forgot-password, /reset-password; middleware redirect

## ☑ Phase 3 — Onboarding
- 4-step wizard: business → type → first products (manual / CSV / sample) → meet assistant
- System roles/permissions seed, business settings/GST defaults, expense categories

## ☑ Phase 4 — Products
- Schema: products, categories, aliases, units; search_text + phonetic key
- CRUD, archive, search/filter, CSV import/export, R2 image upload
- UI: /products, /products/new, /products/[id]

## ☑ Phase 5 — Inventory
- Movement ledger, stock guard trigger, adjust (ADJUSTMENT/DAMAGE/RETURN)
- Inventory dashboard (totals, low/out of stock, value, today's movements), /inventory/[id]
- Low-stock alerts + notifications (post-commit)

## ☑ Phase 6 — Sales
- Pricing engine (discount allocation, GST inclusive/exclusive, CGST/SGST/IGST)
- `createSale` transaction engine, idempotency, invoice numbering
- UI: /sales, /sales/new (POS-style, mobile bottom sheet cart), /sales/[id]

## ☑ Phase 7 — Purchases
- `createPurchase`: stock in, weighted avg cost, supplier ledger, payment status
- UI: /purchases, /purchases/new

## ☑ Phase 8 — Customers / Khata
- Ledger (credit, payment, adjustment), balances, credit sales integration
- UI: /customers, /customers/[id] (khata view, quick "Payment received"/"Udhaar")

## ☑ Phase 9 — Suppliers
- Ledger, payments, outstanding; UI: /suppliers, /suppliers/[id]

## ☑ Phase 10 — Expenses
- Categories, create/list/reverse; UI: /expenses

## ☑ Phase 11 — Dashboard
- Today's sales/profit/outstanding/low stock, sales trend, top products, expense trend,
  data-backed insights, quick actions, "Talk to Suvakta" CTA

## ☑ Phase 12 — Reports
- Report service: daily/weekly/monthly sales, profit, expenses, inventory valuation,
  top products, low stock, customer/supplier outstanding, GST summary; date filters; CSV

## ◐ Phase 13 — AI intent engine
- ParsedIntent zod contract, RulesParser (Hinglish grammar), WorkersAIParser, HybridParser
- ContextResolver, EntityResolver (exact/alias/fuzzy/phonetic), ambiguity handling
- Read-only answerers (stock, sales, profit, outstanding, low stock, summaries)
- Proposals for mutating intents, conversation context with expiry

## ◐ Phase 14 — Voice interface
- SpeechProvider abstraction (browser, server/Whisper), voice state machine UI,
  floating mic button, /ai chat page

## ☑ Phase 15 — Confirmation engine
- Confirmation card (items, totals, stock impact), confirm/edit/cancel, clarify options,
  execution through transaction engine with source=VOICE; undo (reversal) intent

## ☑ Phase 16 — Audit
- Audit UI (/audit) with filters, before/after diff, source badges

## ☑ Phase 17 — Roles & permissions
- Settings → Users (add staff, change role, deactivate, reset password), Roles matrix

## ☑ Phase 18 — Offline / PWA
- Manifest, icons, service worker, install prompt, IndexedDB queue + sync engine

## ☑ Phase 19 — Testing
- Fill remaining unit/integration coverage; Playwright e2e incl. mobile viewport

## ◐ Phase 20 — Cloudflare deployment
- wrangler envs (dev/staging/prod), migrations, seed, cron, DEPLOYMENT.md, README

---

## Progress log

**Verification at the end of the build** (all run locally):

| Check | Result |
|---|---|
| `pnpm typecheck` | ✅ clean (TypeScript strict, `noUncheckedIndexedAccess`) |
| `pnpm lint` | ✅ clean |
| Unit tests (Node) | ✅ 60 — money, GST pricing (incl. 500-case property check), qty, IST dates, Hindi/Hinglish text, CSV, rules parser (spec phrases), entity matching, AI contract, log redaction |
| Integration tests (workerd + real D1) | ✅ 48 — auth, CSRF, validation, products/import, inventory & stock trigger, sales/GST/idempotency/undo, purchases/avg cost, khata, expenses/reports/GST, multi-tenant isolation, roles, AI assistant end-to-end |
| E2E (Playwright, production build) | ✅ 12 — signup → onboarding → dashboard, login/logout, product, POS sale, purchase, khata, voice confirm, ambiguity, mobile layout |
| `pnpm build` | ✅ |
| Production Worker | ✅ serves pages/API; cron handler ran daily jobs against seeded data |

**What is implemented but not verified end-to-end here**

- **Workers AI LLM parser** (Phase 13): wired and schema-validated, but the tests and local runs
  had no Workers AI access (needs `wrangler login` / a deployed Worker). Everything tested went
  through the rules parser, which handles the spec's example phrases.
- **Server speech-to-text** (Whisper) and **browser speech recognition** (Phase 14): the browser
  pane used for manual checks blocks the microphone; the typed path and the "mic blocked"
  fallback were verified. Real voice capture must be checked on a phone over HTTPS.
- **Cloudflare deployment** (Phase 20): config, scripts and docs are ready, but nothing was
  deployed — staging/production D1 IDs are placeholders.
- **Password-reset email:** the Cloudflare Email Service binding is optional and untested
  (needs an onboarded domain).

**Remaining / next**

1. Deploy to staging, run the smoke test on a real Android phone (Chrome, Hindi voice).
2. Tune the LLM prompt with real shopkeeper transcripts (`ai_interactions` stores them).
3. OTP / WhatsApp login + reset delivery (`MessageDelivery` interface is ready).
4. Printable/shareable GST invoice PDF and thermal-printer layout.
5. Barcode scanning via camera (`BarcodeDetector`) in the POS search field.
