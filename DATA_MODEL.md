# Suvakta — Data Model (Phase 0, as-built)

Source of truth: `src/server/db/schema.ts` (Drizzle) + `migrations/0000…0005`. Store is **Cloudflare D1 (SQLite)**. Money is **integer paise**, quantity is **integer milli-units**, GST is **basis points**, dates are **IST** `YYYY-MM-DD` or epoch ms.

**44 tables** exist today. Grouped below with the as-built reality and the ledger rules they follow.

## Identity & tenancy
- `users` (incl. `platform_role` for super admin), `sessions`, `password_reset_tokens`
- `agencies` → `tenants` (owner account, holds licence) → `businesses` (shop/branch; `tenant_id`, `branch_code`, `status`)
- `business_members`, `roles`, `permissions`, `role_permissions`
- `licenses`, `license_events`, `platform_audit_logs`
- `business_settings`, `gst_settings`, `payment_methods`, `counters` (document numbering)

## Catalogue
- `product_categories`, `products`, `product_aliases`, `product_units` (per-product conversion factors)

## Inventory (ledger + projection)
- `inventory_movements` — **immutable ledger**, the source of truth. Fields: business/branch, product, base-unit qty, source txn type/id, actor/source, timestamp, idempotency reference, reason.
- `products.current_stock_milli` — **projection** (cached balance), reconciles to movements.
- `stock_alerts` — low/out-of-stock queue.

## Sales / purchases / parties
- `sales`, `sale_items` (historical line snapshots: name, unit, price, discount, tax basis/amounts, cost basis)
- `purchases`, `purchase_items`
- `payments` (one payment row per sale/purchase today — **no split tender**)
- `customers`, `customer_transactions` (Khata ledger), `suppliers`, `supplier_transactions`
- `expenses`, `expense_categories`
- `reversals` — undo creates a reversal; originals are never deleted.

## AI / voice
- `voice_commands` (raw STT), `ai_interactions` (parser, model, intent, confidence, latency, status, proposal/clarification/context JSON — **no token/cost fields**), `voice_preferences` (learned ambiguous-word → product)

## Platform ops
- `idempotency_keys` (PK business+key; written first in each batch), `audit_logs` (actor/source/before/after), `app_events` (outbox), `notifications`, `daily_summaries`, `stock_alerts`, `quote_requests` (website leads)

## Ledger & integrity rules (enforced today)
1. Stock, customer and supplier ledgers are append-only; corrections are reversals/adjustments.
2. Cached balances (`current_stock_milli`, party balances) are projections, recomputable from ledgers.
3. Sale + its line snapshots + payments + inventory movements + customer ledger + audit + outbox commit in **one `db.batch()`** or not at all (`services/engine.ts`).
4. A DB trigger (migration `0001`) blocks negative stock.
5. `idempotency_keys` unique PK makes retries/double-confirm post once.
6. Document numbers are unique via `counters` + unique index inside the same batch.
7. Historical `sale_items`/`purchase_items` values never change when catalogue prices change.

## Proposed additive tables (future phases — none destructive)
- **Phase 1 (AI cost):** `ai_usage_events` (provider, model, task, input/output/cached tokens, audio units, est. cost, currency/price version, latency, status, retries, routing reason), `ai_budgets` (per-business allowance, period, hard cap, kill switch).
- **Later (per IMPLEMENTATION_PLAN):** `purchase_orders`, `purchase_order_lines`, `goods_receipts`, `goods_receipt_lines`; `stock_counts`, `stock_count_lines`; inventory `transfer` movement types; `pos_shifts`; `forecast_runs`, `forecast_values`, `recommendations`.

All changes ship as Drizzle migrations (`pnpm db:generate`), never as a reset/drop.
