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

---

## Phase 0 audit alignment (15 Oct 2026)

Full findings in [CURRENT_STATE_AUDIT.md](CURRENT_STATE_AUDIT.md). Mapping the built app to the master-plan releases:

- **Release A — Reliable Core ERP:** ~**Implemented**. Auth, tenancy/branches, catalogue+aliases+units, inventory ledger, POS/sales/returns/reversals, purchases (receiving + supplier ledger), customers/Khata, expenses, dashboard+reports+CSV, roles/permissions, audit, PWA/offline. Gaps within A: purchase **PO/approval/GRN** states, inventory **transfers**, **stock counts**, **POS shifts/cashbook**, **split tender**.
- **Release B — AI Copilot:** ~**Implemented** except **cost metering/budgets/usage admin** (plan §17) → the first real gap.
- **Release C — Advanced intelligence** (forecasting, reorder, anomaly, insights): **Not found**.
- **Release D — Expansion:** **Not found** (as intended).

### Proposed next phase (smallest safe, additive)
**Phase 1 → AI cost metering & budgets (plan §17).** Why: it is explicitly "required", genuinely absent, fully additive (new `ai_usage_events`, `ai_budgets` tables — no destructive migration), and isolated from the money/stock paths.

Scope:
1. Record one `ai_usage_events` row per provider call (STT + LLM) in the existing AI path, incl. retries; never log secrets/raw audio.
2. `ai_budgets` per business with alert thresholds + hard cap + provider kill switch.
3. Enforcement that **degrades AI gracefully while core POS/stock keep working** when the cap is hit.
4. Admin AI-usage screen (cost by provider/model/task, STT vs LLM, budget vs actual).
5. Tests: usage recorded on each call; cap blocks AI but not POS; pricing `price_version` keeps estimates stable.

Gate: `pnpm check` (typecheck + lint + test + build) + migration review. No production data reset.

### Deployment watch-items (carried over, not Phase 1)
- The live Worker is renamed **suvakta**; data resources keep `dukaanos-*` names (see memory/DEPLOYMENT.md).
- Pending production migrations: **0003, 0004, 0005** (`pnpm db:migrate:production`).
- `pnpm build` now succeeds (lucide-in-Server-Component OOM fixed, `1312f87`); deploy via push once Cloudflare build command is `pnpm build` + the vinext deploy command.
