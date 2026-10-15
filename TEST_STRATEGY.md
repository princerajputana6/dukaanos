# Suvakta — Test Strategy (Phase 0)

## What exists today (verified this phase)
- **Unit (vitest, Node):** `tests/unit/` — `money`, `pricing`, `matching`, `rules-parser`, `contract`, `speech-fallback`, `utils`.
- **Integration (`@cloudflare/vitest-pool-workers`, real D1):** `tests/integration/` — `auth`, `isolation-authz`, `sales-purchases`, `products-inventory`, `ai`, `platform`, `smoke`.
- **E2E (Playwright, production build on port 8790):** `tests/e2e/` — `auth.spec`, `core.spec`, `mobile.spec`.
- **Runtime results:** `tsc --noEmit` pass · `eslint .` clean · `pnpm test` **14 files / 139 passed** · E2E **12 passed** · `pnpm build` succeeds.

## Coverage mapped to plan §26
**Covered:** money/rounding, tax (inclusive/exclusive, CGST/SGST/IGST), unit conversions (crate→bottle), product resolution + ambiguity (Coke 250/500 asks), stock checks, idempotency (double-confirm posts once), permissions/tenant isolation (Business A ≠ B; staff ≠ profit/export), AI schema + revalidation, atomic sale (lines+payments+movements+ledger+audit), purchase receipt → stock/payable, customer payment → receivable, return/reversal preserves history, failed mutation leaves no partial records, voice sale preview→confirm, Devanagari transcript, offline fallback (STT), mobile viewport smoke.

**Gaps to add as features land:**
- COGS/profit edge cases with partial cost data (label-as-estimate assertion).
- Branch **transfer** moves stock (feature not built yet).
- **Stock count** expected-vs-counted reconciliation (not built).
- Offline **finalize-sale** syncs exactly once end-to-end (queue exists; add E2E).
- **AI budget cap** leaves core POS working (Phase 1 target).
- **Forecast** refuses to fabricate on insufficient history (Release C).
- CSV import row-error reporting E2E; export respects permission/tenant scope E2E.
- Keyboard-only sale completion; no horizontal overflow at 320–1440px (expand `mobile.spec`).

## Policy
- A phase is **not done** until `tsc`, `eslint`, `pnpm test`, E2E and `pnpm build` pass, migrations are reviewed, and relevant permissions are tested.
- Server validation is authoritative; client validation is UX only — test both layers.
- Each new domain service ships with an integration test proving its mutation is atomic + idempotent + tenant-scoped before its UI is enabled.
- Run `pnpm check` (typecheck + lint + test + build) as the phase gate.

## Commands
```bash
pnpm test        # unit + integration (real D1)
pnpm test:e2e    # Playwright against the production build
pnpm check       # typecheck + lint + test + build
```
