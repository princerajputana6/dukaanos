# Suvakta — Current State Audit (Phase 0)

**Date:** 15 October 2026
**Method:** Static inspection of the repository + runtime checks. Landing-page claims were verified against code, not assumed.
**Checks run this phase:** `tsc --noEmit` → **pass (0 errors)**; `eslint .` → **clean**; `pnpm test` (unit + integration, vitest + vitest-pool-workers on real D1) → **14 files / 139 tests passed**; Playwright E2E (`tests/e2e`) → **12 passed** (verified earlier in session); `pnpm build` (`vinext build`) → **succeeds** after the lucide-in-server-component fix (commit `1312f87`).

Status legend: **Implemented** · **Partial** · **Mocked** · **Broken** · **Not found**

---

## 1. Summary

Suvakta is **not** an early prototype. It is a working, multi-tenant, voice-first retail ERP with a deterministic transaction engine, 44 database tables, 21 domain services, an atomic `db.batch()` commit path with idempotency and DB-level stock guards, role-based permissions, an audit log, a rules-first + LLM-fallback AI pipeline that proposes and never directly mutates, a PWA with an offline queue, and CSV import/export. The core loop the landing page advertises — *speak → understand → confirm → commit → audit* — exists and is covered by integration tests.

The real gaps versus this master plan are in **advanced/ops breadth**, not core correctness:
- **AI cost metering & budgets** (plan §17): **Implemented in Phase 1** — `ai_usage_events` + `ai_budgets`, per-call recording, per-shop cap/kill switch that degrades AI while POS keeps working, and an `/admin/ai-usage` screen.
- **Purchase Order → approval → GRN workflow** (§11): **Implemented in Phase 2b** — `purchase_orders`/`purchase_order_lines`, Draft→Submitted→Approved→Partially/Received→Cancelled, receive posts stock+payable via a linked purchase.
- **POS shifts/cashbook** (§13): → **Not found**. (Inventory transfers + stock counts shipped in Phase 2a.)
- **Forecasting / reorder drafts / anomaly / insights** (Release C, §18): → **Not found**
- **Split tender** (§10): single payment method per sale. → **Not found**
- **Database choice** (§21): runs on Cloudflare **D1 (SQLite)**, not PostgreSQL/Hyperdrive. Invariants are enforced via DB triggers + idempotency + tests. This is a deliberate, documented trade-off — see ARCHITECTURE.md and the decision note in §7 below.

No fabricated metrics, dead buttons, or pre-commit success messages were found in the core flows. One honesty caveat is noted per feature below.

---

## 2. Landing-page claim verification

| Advertised | Status | Evidence |
|---|---|---|
| Hindi / English / Hinglish voice | **Implemented** | `src/features/voice/speech.ts` (browser Web Speech + server Whisper fallback), `src/server/ai/rules-parser.ts` (Hinglish + Devanagari), `POST /api/ai/voice` |
| Confirm before saving | **Implemented** | `src/server/ai/assistant.ts` — proposals stored `PROPOSED`, committed only on `confirm`; `src/features/voice/assistant-turn.tsx` ConfirmationCard |
| Product matching & aliases | **Implemented** | `product_aliases`, `product_units` tables; `src/server/ai/matching.ts`, resolver in `catalog.ts`/`planner.ts`; ambiguity → clarify / auto-pick with reason |
| Sales / POS | **Implemented** | `src/server/services/sales.ts` (`createSale`, line snapshots, payments, stock movements, audit); routes `src/server/api/routes/sales.ts`; `tests/integration/sales-purchases.test.ts` |
| Purchases / suppliers | **Partial** | `purchases.ts` (`createPurchase`, `reversePurchase`, supplier ledger). **No** PO/approval/GRN states; stock posts on create |
| Unit conversions | **Implemented** | `product_units` (per-product factors), `src/lib/qty.ts`; "1 crate = 24" tested in `tests/integration/ai.test.ts` |
| Customer Khata | **Implemented** | `customers`, `customer_transactions`, `payments`; `services/customers.ts`; running balance + reversals; `/customers/:id/payment\|credit\|adjust` |
| Expenses | **Implemented** | `expenses`, `expense_categories`; `services/expenses.ts`; feeds profit report |
| GST-ready summaries | **Implemented** | `gst_settings`, `services/reports.ts` `gstSummary`, `src/lib/pricing.ts` (CGST/SGST/IGST, inclusive/exclusive, basis points). *Correctly scoped: summaries, not statutory filing.* |
| Profit / weighted-average costing | **Implemented** | `reports.ts` `profitReport`; weighted-average cost on purchase; returns via reversal |
| Offline mode | **Implemented** | `public/sw.js`, `public/manifest.webmanifest`, `src/lib/offline/queue.ts` (IndexedDB, idempotency, `PENDING→SYNCING→SYNCED/FAILED`) |
| Multiple branches | **Implemented** | `businesses.tenant_id` + `branch_code`; `services/branches.ts`; branch isolation in `ServiceContext` |
| Staff roles | **Implemented** (server-enforced) | `roles`, `permissions`, `role_permissions`; `requirePerm()` middleware; `tests/integration/isolation-authz.test.ts` |
| Undo / audit | **Implemented** | `reversals`, `audit_logs` (actor, source, before/after); `/sales/:id/reverse`, `/purchases/:id/reverse` |
| CSV import / export | **Implemented** | product import/export, report CSV (`reports.ts` `reportCsv`, `products.ts`) |
| Alerts / daily summaries | **Implemented** | `stock_alerts`, `daily_summaries`; cron `worker/index.ts` → `runDailyJobs` (21:00 IST) |
| Security / privacy | **Implemented** (core) | PBKDF2-SHA256 (100k iter) `auth/password.ts`; HttpOnly/SameSite/Secure cookies `auth/session.ts`; CSRF + rate limits `api/middleware.ts`; tenant isolation tests |

**Not advertised and correctly absent:** statutory GST filing, e-invoice/e-way-bill, payments/lending, payroll. Good — these must not be enabled without validation.

---

## 3. Feature-by-feature status

### Implemented
- **Auth & onboarding** — signup/login/logout/forgot/reset, onboarding wizard (`src/features/onboarding`), PBKDF2, sessions, rate limits.
- **Tenancy / branches / licensing** — `tenants`, `licenses`, `license_events`, `platform_audit_logs`; licence enforced in `engine.commit()` (`LICENSE_INACTIVE`), branch/user limits (`LIMIT_REACHED`).
- **Transaction engine** — `services/engine.ts`: read → validate → `db.batch()` (atomic); `idempotency_keys` written first in the batch; stock trigger (migration `0001`); unique document numbers via `counters`.
- **Catalogue** — products, variants-by-attributes, categories, aliases, per-product units; image upload to R2.
- **Inventory ledger** — `inventory_movements` (immutable), `stock_alerts`, `assertStockAvailable`, `adjustStock`, projection balance on `products.current_stock_milli`.
- **Sales / POS** — server-side totals/tax, payments, credit, receipt, numbering, reverse; line snapshots preserve historical values.
- **Customers / Khata / Suppliers** — ledgers, payments, adjustments, reversals, outstanding reports.
- **Expenses** — categories, payment method, report impact.
- **Reports** — `salesReport`, `profitReport`, `expensesReport`, `inventoryValuation`, `customerOutstanding`, `supplierOutstanding`, `gstSummary`, dashboard; CSV export; money in integer paise.
- **AI / voice copilot** — deterministic `rules-parser` first (confidence ≥ 0.85), Workers AI Llama fallback, zod contract, resolver, planner (clarify/answer/proposal), idempotent commit with `source = VOICE`, learned `voice_preferences`.
- **PWA / offline** — installable, cached shell + read models, durable offline queue with idempotent sync and status labels.
- **Audit** — every mutation writes `audit_logs` with actor/source/before/after; reversals never delete.
- **Super-admin console** (`/admin`) — tenants, shops/branches, agencies, users, licences, leads; `platform_audit_logs`.

### Partial
- **Confidence→review surfacing** — proposals flag `needsReview` under 0.9 but there is no separate reviewer role/queue.

### Not found (vs plan)
- **POS shifts / cashbook** (`pos_shifts` absent).
- **Split tender** (multiple payments per sale).
- **Forecasting, reorder drafts, anomaly detection, insight cards** (Release C; no `forecast_*`/`recommendations` tables).
- **Warehouses / POS terminals** as first-class entities (branch is the lowest scope today).
- **Dedicated AI usage/budget admin UI** and **data export/retention policy page**.

### Broken / Mocked
- **None found in core flows.** The only build-blocking defect found and fixed this phase was a tooling issue (lucide-react barrel imported into `(site)` Server Components → vinext RSC-analysis OOM), not a product defect — fixed in `1312f87`.

---

## 4. Security & correctness posture (verified)

- **Tenant isolation:** `ServiceContext.businessId` from session; every query scoped; `tests/integration/isolation-authz.test.ts` asserts Business A cannot read B by changing IDs.
- **Authorization:** `requirePerm()` on routes; staff-without-profit enforced server-side (not just hidden nav).
- **Money:** integer paise, qty in milli-units, GST in basis points; no JS float in authoritative paths (`src/lib/money.ts`, `pricing.ts`; `tests/unit/money.test.ts`, `pricing.test.ts`).
- **Idempotency:** `Idempotency-Key` on mutations; replay returns original result; double-confirm executes once (tested).
- **AI boundary:** the model only returns a typed proposal; `assistant.ts`/`planner.ts` re-resolve and recompute all money/stock/tax server-side; AI has no DB credentials. ✔ matches plan §16/§6.
- **Secrets:** only `EMAIL_FROM` in production secrets; AI/DB/R2 are bindings; none committed.

---

## 5. Gaps that matter most (ranked)

4. **POS shifts/cashbook** — needed before "cash mismatch" alerts are meaningful.
5. **Forecasting/recommendations** — Release C; gate on data-sufficiency, do not fake.

---

## 6. Honesty caveats found

- `gstSummary` is correctly labelled a **summary**, not a filing — keep it that way in UI copy.
- `profitReport` uses weighted-average cost; where cost data is missing it should be **labelled an estimate** (verify UI shows this on partial data).
- Demo/seed data (`scripts/seed.ts`) is local-only; dashboard totals derive from seeded transactions, not hardcoded — ✔.

---

## 7. Architecture decision to flag (plan §21)

The plan asks to reconsider **D1 vs PostgreSQL/Hyperdrive**. Current reality: the ERP runs on **D1 (SQLite)** and proves its invariants with DB triggers, idempotency keys, atomic `db.batch()`, and integration tests on real D1. D1's single-writer model and 1 MB row / statement limits are acceptable at current scale. **Recommendation: do not migrate now.** Revisit only if/when concurrency, cross-region writes, or analytical query load demonstrably exceed D1 — and only via the documented reason/risk/migration/rollback gate in plan §10. This is a watch-item, not a Phase-1 action.

---

## 8. Proposed smallest safe next phase

See IMPLEMENTATION_PLAN.md. In short: **Phase 1 = AI cost metering & budgets (plan §17)** — additive tables (`ai_usage_events`, `ai_budgets`), record usage in the existing AI path, an admin usage screen, and a budget cap that degrades AI gracefully while **core POS/stock keep working**. It is the highest-value gap, fully additive (no destructive migration), and testable in isolation.
