# DukaanOS — Architecture

> "Run your business by simply talking to it."

DukaanOS is a mobile-first PWA for Indian small businesses (kirana, paan, salon, café,
distributors…). The core loop is **VOICE → UNDERSTAND → CONFIRM → EXECUTE → RECORD**.

This document is the source of truth for how the system is put together. If code and this
document disagree, one of them is a bug.

---

## 1. System overview

```
┌──────────────────────────────┐
│ PWA (React 19, App Router UI) │  TanStack Query · Zustand · IndexedDB offline queue
│  Service worker (app shell)   │  SpeechProvider (browser STT | server STT)
└──────────────┬───────────────┘
               │ HTTPS (HttpOnly session cookie, Idempotency-Key)
               ▼
┌──────────────────────────────────────────────────────────────┐
│ ONE Cloudflare Worker (vinext = Next.js API surface on Vite) │
│                                                              │
│  src/app/**            → RSC/SSR pages (thin shells + auth)  │
│  src/app/api/[[...]]   → Hono API app (src/server/api)       │
│        │                                                     │
│        ├─ middleware: request-id · logging · CSRF · session  │
│        │              · business resolution · rate limiting  │
│        ├─ routes (thin): parse → zod → service → envelope    │
│        ▼                                                     │
│  Domain services (src/server/services/*)                     │
│    Transaction engine: read → validate → plan → atomic batch │
│        │                                                     │
│  AI layer (src/server/ai/*)  — READ-ONLY access to data      │
│    parser (rules | Workers AI) → zod → resolver → proposal   │
└───────┬──────────────┬───────────────┬──────────────┬────────┘
        ▼              ▼               ▼              ▼
   D1 (SQLite)     R2 (images,     Workers AI      Rate Limiting
   Drizzle ORM     exports)        (LLM + Whisper)  binding
```

A single Worker serves both UI and API. This keeps latency low (UI and data at the
same edge location), avoids CORS, and lets the session cookie be `SameSite=Lax; HttpOnly`.

### Why vinext (and not `next build` / OpenNext)

Cloudflare's current recommendation for new Next.js projects on Workers is **vinext**, which
re-implements the Next.js App Router API on Vite and runs the server in `workerd` during
development (real D1/R2/AI bindings via `import { env } from "cloudflare:workers"`).
vinext is in beta, so the design deliberately keeps framework coupling thin:

- All business logic lives in framework-free services (`src/server/services`), which take a
  `ServiceContext` and a Drizzle `db`. They know nothing about Next.js or Hono.
- The HTTP API is a **Hono** app mounted by one catch-all route handler. Hono is portable and
  is also what the integration tests call directly.
- Pages are thin: they check the session and render client components that talk to `/api`.

Moving to OpenNext later means changing the build tooling, not the application.

---

## 2. Request lifecycle (mutations)

```
Client form / voice confirmation
  → POST /api/sales   (Idempotency-Key: <uuid>)
  → middleware: requestId, logger, CSRF(Origin check), session → user, active business,
                member role → permission set, rate limit
  → route: zod.parse(body)                         (400 VALIDATION_ERROR)
  → service.createSale(ctx, input)
       1. assert permission sales.create           (403 FORBIDDEN)
       2. load products (scoped to ctx.businessId)  (404 PRODUCT_NOT_FOUND)
       3. check stock                               (409 INSUFFICIENT_STOCK)
       4. price lines: discount → GST split (integer paise)
       5. build ONE atomic D1 batch:
            idempotency row · counter bump · sale · sale_items · inventory_movements
            · stock updates · customer ledger · payments · audit_log · app_event
       6. db.batch([...])  — all-or-nothing
       7. post-commit (non-critical): low-stock alerts/notifications
  → { success: true, data }
```

### Atomicity on D1

D1 does not support interactive `BEGIN … COMMIT` from Workers. Every multi-row mutation
therefore uses **`db.batch()`**, which D1 executes as a single implicit transaction: if any
statement fails, the whole batch is rolled back.

Because there is no interactive transaction, the service reads first, then writes in a batch.
Race conditions between the read and the write are closed by **database-level guards**
executed inside the batch:

| Guard | Mechanism |
|---|---|
| Stock never goes negative (unless business allows it) | `BEFORE UPDATE` trigger on `products.current_stock_milli` → `RAISE(ABORT, 'INSUFFICIENT_STOCK')` |
| Correct before/after on movements | movement row is inserted with `before = (SELECT current_stock…)` computed **inside** the batch, immediately before the `UPDATE … SET stock = stock + delta` |
| Duplicate submission / offline replay | `idempotency_keys` PK `(business_id, key)`; inserted in the same batch → duplicate aborts batch; stored response is replayed |
| Double reversal (undo twice) | `reversals` row with PK `(business_id, entity_type, entity_id)` inserted in the same batch |
| Invoice numbers never collide | `counters` row incremented in-batch; number read by sub-select in the `INSERT` |
| Ledger balance consistency | `UPDATE customers SET balance = balance + Δ` in-batch; ledger row stores `balance_after` via sub-select |

All errors raised by triggers are mapped to typed `AppError`s (`INSUFFICIENT_STOCK`, …).

---

## 3. Multi-tenancy & authorization

- Every business-owned table has `business_id` and a leading index on it.
- The **active business is resolved from the session** (`sessions.business_id`), never from
  the request body/URL. A user may be a member of several businesses; switching business
  updates the session after a membership check.
- Services receive `ServiceContext { db, env, businessId, userId, permissions, source, requestId, now }`.
  Every query goes through `scoped(table)` helpers or explicit `eq(table.businessId, ctx.businessId)`.
  Every entity lookup by id is `WHERE id = ? AND business_id = ?` — a foreign id yields 404,
  indistinguishable from a missing one.
- Tests (`tests/integration/isolation.test.ts`) assert that business B cannot read or mutate
  business A data through any endpoint.

### Roles & permissions

`roles` (system roles have `business_id = NULL`; custom roles are business-scoped),
`permissions`, `role_permissions`, `business_members(role_id)`.

| Permission | Owner | Manager | Staff |
|---|:-:|:-:|:-:|
| sales.create | ✓ | ✓ | ✓ |
| sales.edit | ✓ | ✓ | |
| sales.delete (reverse) | ✓ | ✓ | |
| inventory.create (products) | ✓ | ✓ | ✓ |
| inventory.adjust | ✓ | ✓ | |
| purchase.create | ✓ | ✓ | |
| customer.create | ✓ | ✓ | ✓ |
| customer.ledger (credit/payment) | ✓ | ✓ | ✓ |
| supplier.create | ✓ | ✓ | |
| supplier.ledger | ✓ | ✓ | |
| expense.create | ✓ | ✓ | |
| reports.view (profit, reports, dashboard ₹) | ✓ | ✓ | |
| settings.manage | ✓ | | |
| users.manage | ✓ | | |
| audit.view | ✓ | | |

Permissions are enforced **in services** (defence in depth: routes also declare them). The UI
hides what the user cannot do, but hiding is never the control.

---

## 4. Authentication

- Password hashing: **PBKDF2-SHA-256, 100 000 iterations, 16-byte salt** via WebCrypto
  (the Workers runtime maximum). Stored as `pbkdf2$<iter>$<salt_b64>$<hash_b64>`; the format
  allows transparent re-hash upgrades later. Comparison is constant-time.
- Sessions: 32 random bytes → base64url token in `dk_session` cookie
  (`HttpOnly; Secure; SameSite=Lax; Path=/`). The DB stores only `SHA-256(token)`.
  30-day sliding expiry, refreshed at most once per hour. Logout deletes the row.
- Login identifier: mobile number (10-digit Indian, normalised) or email.
- Password reset: single-use token (hash stored), 30-minute expiry, all sessions revoked on
  reset. Delivery goes through a `MessageDelivery` interface: Cloudflare Email Service when
  configured and the user has an email; in development the link is logged. Owners can reset
  staff passwords from Settings → Users. (OTP/WhatsApp are future `MessageDelivery` + login
  providers — `auth_identities` can be added without touching sessions.)
- CSRF: cookie is `SameSite=Lax`, and every non-GET `/api` request must carry an `Origin`
  (or `Sec-Fetch-Site: same-origin`) matching the app host.
- Rate limiting: Cloudflare Rate Limiting binding, keyed by IP for auth endpoints and by user
  for AI endpoints. A no-op limiter is used when the binding is absent (tests/local).

---

## 5. Money, quantity, time

| Concern | Rule |
|---|---|
| Money | integer **paise** everywhere (`*_paise` columns). `src/lib/money.ts` parses/format; no floats in arithmetic. |
| Quantity | integer **milli-units** (`*_milli`, 1 unit = 1000). Supports 0.5 kg, 1.25 L without float drift. `src/lib/qty.ts`. |
| GST rate | integer **basis points** (`gst_rate_bp`, 18% = 1800). |
| Line math | `gross = round(price × qty_milli / 1000)` → minus discount → if prices include GST: `taxable = round(gross × 10000 / (10000 + rate))`, `tax = gross − taxable`; else `tax = round(taxable × rate / 10000)`. Intra-state: `CGST = floor(tax/2)`, `SGST = tax − CGST`; inter-state: `IGST = tax`. Bill-level discount is allocated across lines by largest remainder so GST stays correct. |
| Rounding | half-up on integers (`roundDiv`), tested exhaustively. |
| Timestamps | UTC epoch ms (`created_at`). |
| Business date | `txn_date` = `YYYY-MM-DD` in **Asia/Kolkata**, stored on every transaction (supports back-dated "kal ki sale"). Reports group by `txn_date`. |
| Display | `Intl` with `timeZone: "Asia/Kolkata"`, `en-IN` grouping (₹1,23,456.50). |

### Cost & profit

- `products.purchase_price_paise` = last purchase price; `products.avg_cost_paise` = weighted
  average cost, updated in-batch on each purchase.
- Each `sale_items` row snapshots `unit_cost_paise` (avg cost at time of sale).
- Gross profit = Σ taxable value − Σ cost of completed sales. Net profit = gross − expenses.
- Reports aggregate from transaction tables; there are no stored running totals except the
  per-party balances (`customers.balance_paise`, `suppliers.balance_paise`) and
  `products.current_stock_milli`, which are updated atomically with their ledgers and have a
  reconciliation check (`services/reconcile.ts`, covered by tests).

---

## 6. Database schema (D1 / SQLite via Drizzle)

Conventions: `id TEXT` (UUIDv7, time-sortable), `created_at/updated_at INTEGER` (ms),
money `*_paise INTEGER`, quantities `*_milli INTEGER`, booleans `INTEGER 0/1`,
enums as `TEXT` validated by zod.

### Identity & tenancy
| Table | Key columns |
|---|---|
| `users` | id, name, mobile (unique), email (unique, nullable), password_hash, is_active, last_login_at |
| `sessions` | id = sha256(token), user_id, business_id (active), expires_at, last_seen_at, user_agent, ip |
| `password_reset_tokens` | id = sha256(token), user_id, expires_at, used_at |
| `businesses` | id, name, type, city, state_code, phone, address, onboarding_step, onboarded_at |
| `business_members` | id, business_id, user_id, role_id, is_active · unique(business_id,user_id) |
| `roles` | id, business_id (NULL = system), key, name, is_system |
| `permissions` | key (PK), description |
| `role_permissions` | (role_id, permission_key) PK |
| `business_settings` | business_id PK, prices_include_gst, allow_negative_stock, default_low_stock_milli, invoice_prefix, language, voice_provider, ai_enabled, feature_flags (JSON) |
| `gst_settings` | business_id PK, gstin, legal_name, state_code, registration_status (REGISTERED/UNREGISTERED/COMPOSITION) |
| `counters` | (business_id, name) PK, value — invoice/purchase numbering |
| `idempotency_keys` | (business_id, key) PK, request_hash, response_json, created_at |
| `reversals` | (business_id, entity_type, entity_id) PK, reason, created_by, source — one row per undone document; a second undo fails inside the batch (`ALREADY_REVERSED`) |

### Catalogue & inventory
| Table | Key columns |
|---|---|
| `product_categories` | id, business_id, name · unique(business_id, name) |
| `products` | id, business_id, name, sku, barcode, category_id, brand, unit, purchase_price_paise (last cost, **before GST**), avg_cost_paise, selling_price_paise, mrp_paise, gst_rate_bp, hsn_code, opening_stock_milli, **current_stock_milli**, low_stock_threshold_milli, **track_stock** (false for services like haircut/chai), supplier_id, image_key, search_text, is_active |
| `product_aliases` | id, business_id, product_id, alias, alias_norm — "Coke", "कोक", "500 Coke" |
| `product_units` | id, business_id, product_id, name ("crate"), factor_milli (base units per 1, ×1000) — "3 crate Coke" = 3 × 24 pcs |
| `inventory_movements` | id, business_id, product_id, type (OPENING/PURCHASE/SALE/ADJUSTMENT/RETURN/DAMAGE/REVERSAL), quantity_milli (signed), before_milli, after_milli, reference_type, reference_id, reason, created_by, created_at |
| `stock_alerts` | id, business_id, product_id, status (OPEN/RESOLVED), stock_milli, threshold_milli, created_at, resolved_at · one OPEN per product |

> **Deviation from the brief:** there is no separate `inventory` table. V1 has one location per
> business, so `products.current_stock_milli` is the single stock figure and
> `inventory_movements` is its ledger. A separate table would duplicate state and invite drift.
> Multi-store adds `locations` + `stock_levels(location_id, product_id)` later, with the same
> movement ledger. The `/api/inventory` endpoints expose the inventory view.

### Sales, purchases, parties, money
| Table | Key columns |
|---|---|
| `customers` | id, business_id, name, phone, email, address, state_code, notes, **balance_paise** (they owe us), search_text, is_active |
| `customer_transactions` | id, business_id, customer_id, type (SALE_CREDIT/CREDIT/PAYMENT/ADJUSTMENT/REVERSAL), amount_paise (signed, + raises outstanding), balance_after_paise, reference_type/id, note, txn_date, status, created_by |
| `suppliers` | id, business_id, name, phone, company, gstin, address, state_code, notes, **balance_paise** (we owe), search_text, is_active |
| `supplier_transactions` | as customer_transactions (PURCHASE_CREDIT/PAYMENT/ADJUSTMENT/REVERSAL) |
| `sales` | id, business_id, invoice_number, customer_id, txn_date, status (COMPLETED/REVERSED), payment_method, payment_status (PAID/PARTIAL/UNPAID), subtotal/discount/taxable/cgst/sgst/igst/tax/total/paid/credit/cost `_paise`, is_interstate, notes, source, reversed_at/by, reversal_reason |
| `sale_items` | id, business_id, sale_id, product_id, product_name (snapshot), quantity_milli, unit_price_paise, discount_paise, gst_rate_bp, taxable/cgst/sgst/igst/tax/total `_paise`, unit_cost_paise, cost_paise |
| `purchases` / `purchase_items` | mirror of sales with supplier_id, bill_number, unit_cost |
| `payment_methods` | code (CASH/UPI/CARD/CREDIT/OTHER), label — reference data |
| `payments` | id, business_id, direction (IN/OUT), party_type/party_id, method, amount_paise, reference_type/id, txn_date, status |
| `expense_categories` | id, business_id, name, is_system (Rent, Electricity, Salary, Transport, Maintenance, Marketing, Other) |
| `expenses` | id, business_id, category_id, amount_paise, txn_date, payment_method, notes, status, source |

### AI, audit, notifications
| Table | Key columns |
|---|---|
| `voice_commands` | id, business_id, user_id, transcript, language, stt_provider, duration_ms |
| `ai_interactions` | id, business_id, user_id, voice_command_id, input_text, parser, model, intent, confidence, language, parsed_json, proposal_json, clarification_json, context_json, status (ANSWERED/NEEDS_CLARIFICATION/PROPOSED/CONFIRMED/CANCELLED/EXPIRED/FAILED), response_text, result_type/id, latency_ms, error_code, expires_at |
| `audit_logs` | id, business_id, user_id, action, entity_type, entity_id, before_data, after_data, source (WEB/VOICE/IMPORT/SYSTEM), request_id, ip, created_at |
| `notifications` | id, business_id, user_id (NULL = everyone), type (LOW_STOCK/OUTSTANDING_REMINDER/DAILY_SUMMARY/SYSTEM), title, body, link, dedupe_key, read_at |
| `daily_summaries` | (business_id, date) PK — snapshot sent with the daily-summary notification |
| `app_events` | id, business_id, user_id, name, props_json — product analytics/perf events |

### Indexes
`business_id` leads every business index: `(business_id, created_at)`, `(business_id, txn_date)`,
`(business_id, status)`, `(business_id, product_id)`, `(business_id, customer_id)`,
`(business_id, supplier_id)`, `(business_id, search_text)`, unique `(business_id, sku)`,
`(business_id, barcode)`, `(business_id, invoice_number)`.

### Triggers (custom migration)
- `trg_products_stock_guard` — aborts with `INSUFFICIENT_STOCK` when a decrease makes stock
  negative and `business_settings.allow_negative_stock = 0`.

---

## 7. AI & voice

### Principle
The AI **only produces structured intent**. It never sees write APIs, never writes to the DB,
and never produces numbers that are shown as facts. All prices, stock, totals and answers come
from deterministic services reading D1.

### Pipeline
```
voice ──SpeechProvider──▶ transcript
text  ─────────────────▶ POST /api/ai/interpret
  1. ConversationContext   last ≤5 turns, ≤10 min old; carries last referenced product/customer
  2. IntentParser          RulesParser (deterministic Hinglish/Hindi/English grammar)
                           → if not confident, LLM parser (Workers AI, JSON-schema output)
                             with a SMALL context: top-k candidate product/customer names
                             chosen by the ContextResolver (never the whole DB)
  3. zod ParsedIntentSchema.safeParse — invalid → UNKNOWN, nothing executes
  4. EntityResolver        exact (name/sku/barcode) → alias → fuzzy (token + trigram +
                           phonetic key incl. Devanagari transliteration)
                           · 0 matches → clarification "which product?" / offer to create
                           · >1 plausible → clarification with options (never guess)
  5. Rule validation       stock, permission, customer required for credit, amounts > 0
  6. Build Proposal        exact command payload + preview computed by the SAME pricing
                           service (totals, GST, stock impact) · stored in ai_interactions
  7. Response
       read-only intents   → answered immediately from report/query services
       mutating intents    → status PROPOSED, requires explicit confirm
POST /api/ai/interactions/:id/confirm
  → loads the STORED proposal (client cannot alter it) → transaction engine with
    source = VOICE and Idempotency-Key = interaction id → audit log → result
POST /api/ai/interactions/:id/clarify { optionId } → re-runs steps 4–7 with the choice
```

### Confidence policy
| Confidence | Behaviour |
|---|---|
| ≥ 0.90 | Prepare proposal |
| 0.70 – 0.89 | Prepare proposal, flagged "please check" |
| < 0.70 | Ask clarification; no proposal |
| any mutation | **Always** requires confirmation (sale, purchase, adjustment, credit, payment, expense, reversal) |

### Context safety
Follow-ups ("10 aur bech di") may reuse the last referenced product only if that turn is
< 5 minutes old and from the same user; the proposal shows "Coke 500ml (from earlier)". Context
never auto-executes anything; it only fills a slot in a proposal the user must confirm.

### Providers (swappable)
- `IntentParser`: `RulesParser`, `WorkersAIParser` (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`,
  `response_format: json_schema`), composed by `HybridParser`. External LLMs implement the same
  interface.
- `SttProvider` (server): `WorkersAIWhisper` (`@cf/openai/whisper-large-v3-turbo`).
- `SpeechProvider` (client): `BrowserSpeechProvider` (Web Speech API, `hi-IN`),
  `ServerSpeechProvider` (MediaRecorder → `/api/ai/voice`). Selected in Settings → Voice,
  with automatic fallback.

### Prompt architecture
`src/server/ai/prompts/`: `system.ts` (role + rules), `schema.ts` (output JSON schema, derived
from the zod schema), `context.ts` (business context block), `conversation.ts` (recent turns),
user input — assembled by `buildMessages()`. Prompt size is bounded (candidate lists capped).

### Answers
Answers to read-only intents are rendered from **templates** in the user's language
(English/Hinglish) using figures returned by services, e.g. `CHECK_STOCK` →
"Coke 500ml: 34 pcs bache hain." Numbers are never generated by the LLM.

---

## 8. Offline & sync

- `public/sw.js` (hand-written, no build plugin): precaches the app shell and static assets;
  `GET /api/products|customers|suppliers` use network-first with cache fallback.
- Offline mutations go to an **IndexedDB action queue** (`src/lib/offline/queue.ts`):
  `{ id, type, payload, idempotencyKey, created_at, status: PENDING|SYNCING|SYNCED|FAILED, retry_count, error }`.
- Queueable actions: create sale, expense, customer payment, customer credit.
- The sync engine replays in order when online (exponential backoff, max 5 tries). The server's
  idempotency layer makes replays safe. Business-rule failures (e.g. stock) become FAILED and
  are shown to the user; nothing is silently dropped.
- UI shows "Offline — changes will sync when you're online" and marks queued items
  "Pending sync" — never as confirmed.

---

## 9. Audit, events, notifications, observability

- `audit_logs` row is written **in the same batch** as every mutation (before/after JSON,
  source WEB/VOICE/IMPORT/SYSTEM). Owners browse it at `/audit`.
- Post-commit hooks create low-stock alerts & notifications (deduplicated by `dedupe_key`).
- Cron (`scheduled` handler, daily 21:00 IST): daily summary + outstanding reminders.
- Logging: structured JSON (`src/server/lib/logger.ts`) with request id, route, status,
  latency; secrets/password/token fields redacted. Workers Logs enabled in wrangler.
  AI interactions are persisted with latency and parser used.

---

## 10. Feature flags

`VOICE_ENABLED, AI_INSIGHTS_ENABLED, OFFLINE_ENABLED, GST_ENABLED, REPORTS_ENABLED`.
Defaults come from env vars (`FLAG_*`), overridable per business in
`business_settings.feature_flags`. Resolved server-side and sent to the client in `/api/me`.

---

## 11. Folder structure

```
src/
  app/                         Next.js routes (vinext)
    (auth)/login|signup|forgot-password|reset-password
    (app)/dashboard|sales|purchases|inventory|products|customers|suppliers|
          expenses|reports|ai|notifications|settings/*|audit   (authenticated shell)
    onboarding/
    api/[[...route]]/route.ts  → mounts Hono app
  components/
    ui/                        shadcn/ui primitives
    layout/                    app shell, bottom nav, sidebar, page header
    shared/                    empty/error/loading states, money, qty, stat card…
  features/<domain>/           client UI per domain (components + hooks)
  lib/                         isomorphic utils: money, qty, dates, text, api client, offline
  schemas/                     zod schemas shared by client & server (API contracts)
  server/
    api/                       Hono app, middleware, routes/<domain>.ts
    db/                        schema.ts, client.ts, batch helpers, seed data
    auth/                      password, session, delivery
    services/                  transaction engine & domain services
    ai/                        parser, providers, resolver, context, proposals, answers
    lib/                       errors, logger, ids, rate-limit, flags, env
  types/
worker/                        Worker entry: fetch → vinext, scheduled → daily jobs
migrations/                    D1 SQL migrations (drizzle-kit + custom triggers)
scripts/                       seed, utilities
tests/
  unit/                        pure logic (money, gst, parser, resolver…) — Node
  integration/                 services + API in workerd with real D1 (vitest-pool-workers)
  e2e/                         Playwright
public/                        manifest, icons, sw.js
```

---

## 12. Deployment topology

| Env | Worker | D1 | R2 | Notes |
|---|---|---|---|---|
| development | local `vinext dev` (workerd) | local D1 (`.wrangler/`) | local | seed via `pnpm db:seed:local` |
| staging | `dukaanos-staging` | `dukaanos-staging` | `dukaanos-staging-files` | `--env staging` |
| production | `dukaanos` | `dukaanos-prod` | `dukaanos-files` | secrets via `wrangler secret put` |

Rollback: `wrangler rollback` for code; D1 Time Travel (`wrangler d1 time-travel restore`) for
data; migrations are forward-only and additive. See `DEPLOYMENT.md`.

## 13. Future extension points (not built in V1)
`MessageDelivery` (WhatsApp/SMS), `auth_identities` (OTP/Google), `payments` (UPI collect),
`BarcodeScanner` (client), `ReceiptPrinter` (client), `locations` (multi-store),
`app_events` as outbox for integrations, reorder suggestions from sales velocity.

---

## 14. Implementation notes (decisions made while building)

- **Tailwind** runs through `@tailwindcss/vite` (the PostCSS plugin did not pick up new files
  under vinext's dev server).
- **Worker entry** is `worker/index.ts`, which re-exports vinext's fetch handler and adds the
  cron `scheduled` handler. Test it with `/cdn-cgi/handler/scheduled` (see DEPLOYMENT.md).
- **Hono sub-routers** each apply `requireBusiness` to their own prefix (`bizRouter()`); a `*`
  middleware on a router mounted at `/` would leak onto `/api/auth`.
- **Hydration marker:** `<html data-hydrated>` is set once React is interactive; E2E tests wait
  for it before typing.
- **Purchase prices are stored before GST** (input tax is recoverable), so profit =
  taxable sale value − cost is like-for-like.
- **Read-only ambiguity:** "Coke kitni bachi hai?" lists every matching Coke instead of asking,
  because nothing is written; mutations always ask.
- **Rules first, LLM second:** the rules parser answers when its confidence ≥ 0.85; otherwise the
  LLM is consulted with ≤15 candidate product names, ≤5 customers/suppliers and ≤3 recent turns.
- **Audio is never stored** — only the transcript (`voice_commands`).

## 15. Known limitations (V1)

- vinext is in beta; if a Next.js feature is missing, OpenNext is the fallback (the business
  code does not depend on the framework).
- Password reset needs Cloudflare Email Service; OTP/WhatsApp delivery is not built yet.
- Profit uses weighted-average cost (not FIFO batches); reversing a purchase does not
  recompute the average.
- Offline: sales/payments/expenses queue offline; new products, purchases and settings need
  a connection. Stock checks for queued sales happen when they sync.
- GST: summary report only — no GSTR filing or e-invoicing.

---

## 16. Platform: super admin, tenants, branches & licensing

```
Agency (optional reseller/partner)
  └─ Tenant (an owner's account — holds the licence)
       └─ Shop / branch (= `businesses` row: own stock, sales, khata, staff, audit)
```

| Table | Purpose |
|---|---|
| `agencies` | Partners who onboard and support shops |
| `tenants` | Owner account: name, agency, owner user, status (ACTIVE/SUSPENDED) |
| `licenses` | One per tenant: plan (TRIAL/BASIC/PRO/ENTERPRISE), status, `max_branches`, `max_users`, `valid_until` (IST date, null = no end) |
| `license_events` | History of every licence change (before/after, actor, note) |
| `platform_audit_logs` | Every action taken in the super admin console |
| `businesses.tenant_id / branch_code / status` | Shop → tenant link, code like MAIN/BR-2, ACTIVE/SUSPENDED/ARCHIVED |
| `users.platform_role` | `SUPER_ADMIN` or null |

**Why each branch is its own shop:** the existing per-business isolation, stock ledger, khata and
roles stay exactly as they are; owners switch branches with the business switcher; a branch can
copy the catalogue (prices, GST, aliases, packs) with zero stock.

**Licence enforcement.** The effective status is computed per request
(`ACTIVE/TRIAL` past `valid_until` ⇒ `EXPIRED`). If the shop, tenant or licence is not in good
standing, `ServiceContext.writable = false` and the transaction engine's `commit()` refuses every
business write with `LICENSE_INACTIVE` — reads and CSV exports keep working, so owners never lose
access to their data. Limits: adding a branch beyond `max_branches` or a user beyond `max_users`
(distinct active users across the tenant's shops) fails with `LIMIT_REACHED`.

**Signup:** self-signup creates a tenant with a 30-day TRIAL (1 shop, 3 users).
**Migration 0003** backfilled every pre-existing shop into its own tenant with an ACTIVE, non-expiring
BASIC licence, so no existing user was affected.

**Super admin console (`/admin`, API `/api/admin/*`)** — guarded by `requireSuperAdmin`:
overview counts (tenants, shops, branches, agencies, owners/users, active shops, licences by
status/plan, expiring ≤ 7 days, platform sales), tenants & licences (change plan/limits/validity,
+30 days / +1 year, suspend), shops & branches (suspend/reactivate), agencies, owners & users
(disable, reset password, grant/revoke super admin), admin audit log, and the **Create shop**
wizard (new or existing tenant → owner login → shop → initial data: sample catalogue, CSV with
opening stock, copy from another branch, opening customers/suppliers). Initial data goes through
the normal services, so opening stock appears as stock movements and the shop's audit log shows
it with source `IMPORT`; admin actions inside a shop are mirrored to that shop's audit log
(source `SYSTEM`).

**Bootstrapping a super admin:** `pnpm admin:create --mobile … --name … --env production`
(creates a login or promotes an existing one; password via hidden prompt).
