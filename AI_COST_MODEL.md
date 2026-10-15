# Suvakta — AI Cost Model (Phase 0)

## Status: Phase 1 shipped (15 Oct 2026)
Metering, budgets and the admin usage screen are **implemented**. `ai_usage_events` records one row per provider call (LLM intent + Whisper STT) with tokens/audio/est-cost/price-version/latency/status/retries (`src/server/services/ai-usage.ts`, `src/server/ai/pricing.ts`, migration `0006`). `ai_budgets` holds a per-shop monthly cap + kill switch; `checkAiBudget` gates the paid model in `assistant.parseIntent` and **fails open** / degrades to the deterministic rules parser when a cap is hit — core POS/stock never call this path (test: `tests/integration/ai-usage.test.ts`). Super admins see spend by task/model/shop and set caps at `/admin/ai-usage`.

Owner-facing usage view (`/settings/ai-usage`, `GET /business/ai-usage`) and **daily spend-alert notifications** (the daily cron raises an `AI_BUDGET` notification when a shop crosses its `alert_bp` threshold or hits the cap, deduped per month) are now implemented. Remaining (ops, not code): reconcile estimated costs against actual Cloudflare Neuron billing.

## Current reality (audited, pre-Phase-1 baseline)
- AI runs on the **Cloudflare Workers AI binding** (`@cf/meta/llama-3.3-70b-instruct-fp8-fast` for intent JSON, `@cf/openai/whisper-large-v3-turbo` for STT). No third-party API keys; billed in Cloudflare **Neurons**, not per-token invoices.
- A **deterministic rules parser** (`src/server/ai/rules-parser.ts`) handles most everyday commands for **zero model cost**; the LLM is a fallback only when confidence < 0.85.
- `ai_interactions` logs `parser`, `model`, `intent`, `confidence_pct`, `latency_ms`, `status`, `error_code` per request.
- Rate limits exist: `AI_LIMITER` (30/min/user) on `/api/ai/interpret` and `/api/ai/voice` (`api/middleware.ts`).

## Gaps vs plan §17 ("required feature")
Not yet implemented: token counts, STT audio-duration/units, per-call **estimated cost**, a **usage ledger**, **per-business budgets**, **daily spend alerts / hard cap**, **provider kill switch**, and an **admin AI-usage screen**. "One command ≠ one model call" is true here (rules parser short-circuits), which makes real metering more important than command counting.

## Proposed model (additive, Phase 1)
**Routing policy (mostly already true):** normalize → deterministic match → direct domain query for reads → small model for ambiguous intent → escalate only on validation failure → **never** an LLM for money/tax/stock/ledger/report arithmetic → cache only safe read-only results → cap tokens/timeouts/retries.

**`ai_usage_events`** (one row per provider call): business_id, user_id, request_id, provider, model, task_category (`stt` | `intent` | `answer` | `insight`), input_tokens, output_tokens, cached_tokens, audio_ms, est_cost_micros, currency, price_version, latency_ms, status, retry_count, routing_reason, created_at. Never log keys, secrets, or raw audio.

**`ai_budgets`**: business_id, period, allowance (cost or task credits), hard_cap, alert_thresholds, kill_switch, updated_by.

**Enforcement principles:**
- Record a usage event in the existing AI path (`server/ai/assistant.ts` / voice route) for every provider call, including retries.
- **Core POS/stock must keep working** when the AI allowance is exhausted; only AI features degrade, with a clear message.
- Admin kill switch per provider/model; budgets measured by **actual provider cost**, not command count.

**Admin usage screen (future):** total monthly AI cost, cost per active business, cost/1,000 commands, provider/model/task split, STT vs LLM, avg prompt size, retry/error cost, top businesses, budget vs actual, escalation rate.

**Pricing table:** keep a versioned Neuron/token→₹ map in config (`price_version`) so historical estimates stay stable when pricing changes.
