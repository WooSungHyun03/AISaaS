# Claude Daily Development Progress

The full day-by-day spec (Definition of Done, rules, git procedure) lives in
[`DAILY_ROUTINE_PLAN.md`](DAILY_ROUTINE_PLAN.md). This file only tracks
*which* day is current and a dated history. Read both at the start of every
run.

## Current Day
Day 2 — External Platform Connection Management

## Completed
- Day 1 — Production AI Provider (merged to `main` via PR #1, commit `cea124c`)

## Current
- (none — Day 2 not started yet)

## Blocked External
- OPENAI_API_KEY / GEMINI_API_KEY: not present in this environment. Real
  network calls to OpenAI/Gemini have not been smoke-tested; only mocked
  HTTP behavior (success, 401/429/5xx, network failure, timeout) is verified
  by tests. Set one of these keys and `AI_PROVIDER=openai|gemini` to exercise
  the real adapters.

## Next
- Day 2 — External Platform Connection Management: `integration_connections`
  migration, Supabase Vault-backed secret storage, server-only CRUD. See
  `DAILY_ROUTINE_PLAN.md` Day 2 for the full spec.

## Daily History

### 2026-09-20
Completed:
- Reviewed existing `src/server/ai/` (interface, mock/openai/gemini adapters,
  `generateText`/`generateStructured`) — the vendor-neutral abstraction and
  structured-output validation already existed, so this was extended rather
  than rebuilt.
- Added a standard AI error taxonomy (`src/server/ai/errors.ts`):
  `AIProviderError` with `MISSING_API_KEY`, `TIMEOUT`, `RATE_LIMITED`,
  `PROVIDER_UNAVAILABLE`, `INVALID_STRUCTURED_RESPONSE`, `NETWORK_FAILURE`.
- Added a shared HTTP layer (`src/server/ai/http.ts`) used by both the OpenAI
  and Gemini adapters: per-request timeout via `AbortController`, response
  classification into the error taxonomy above, and bounded retries
  (`AI_MAX_RETRIES`, default 2, exponential backoff) applied only to
  transient failures — never to auth/validation errors, never unbounded.
- Updated `providers/openai.ts` and `providers/gemini.ts` to go through the
  shared HTTP layer and throw `AIProviderError` instead of generic `Error`.
- Updated `generate.ts#generateStructured` to throw
  `AIProviderError("INVALID_STRUCTURED_RESPONSE", ...)` after its existing
  single retry, instead of a generic `Error`.
- Added `AI_REQUEST_TIMEOUT_MS` / `AI_MAX_RETRIES` to `src/lib/env/server.ts`
  (optional, defaulted) and documented them in `.env.example`.
- Documented the reliability design in `docs/ARCHITECTURE.md` (new "AI
  Provider Reliability" section).
- Added unit tests: `src/server/ai/http.test.ts` (retry/timeout/error
  classification against a mocked `fetch`), `src/server/ai/generate.test.ts`
  (structured-output parsing, retry-once behavior, error propagation), and
  `src/server/ai/providers/providers.test.ts` (missing-key errors and
  successful calls for both adapters, network mocked).
- Kept the mock provider and the `AIProvider`/`generateText`/
  `generateStructured` public surface unchanged — the only caller
  (`src/server/automations/handlers/blog.ts`) needed no changes.

Tests:
- lint: pass (`npm run lint`)
- typecheck: pass (`npm run typecheck`)
- test: pass, 18/18 (`npm test`, includes 12 new AI-layer tests)
- build: pass (`npm run build`)

Commit:
- cea124c feat(ai): add bounded timeout/retry and standard error taxonomy to AI provider layer
- 0a7712b Merge pull request #1 from WooSungHyun03/feature/automation-ai

Push:
- origin/main (via PR #1, merged 2026-09-20)

### 2026-09-20 (routine setup)
Completed:
- Owner requested a daily 00:00 KST scheduled routine going forward, working
  directly on `main` (superseding the PR-based flow used for Day 1 — see
  `DAILY_ROUTINE_PLAN.md` header for the explicit scope of that override).
- Replaced the original 17-day roadmap with a 13-item roadmap the owner
  provided directly (P0/P1/P2 prioritized), written out in full detail in
  `docs/DAILY_ROUTINE_PLAN.md` — each Day has its own Definition of Done,
  scoped implementation steps, and required tests.
- No feature code changed in this entry; this is routine/process setup only.

Tests:
- N/A (docs-only change) — verified previous entry's lint/typecheck/test/build
  results still hold since no source files changed here.

Commit:
- (see git log for this file's commit)

Push:
- origin/main
