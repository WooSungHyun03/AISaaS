# Claude Daily Development Progress

## Current Day
Day 2

## Completed
- Day 1 — Production AI Provider

## Current
- (none — Day 2 not started yet)

## Blocked External
- OPENAI_API_KEY / GEMINI_API_KEY: not present in this environment. Real
  network calls to OpenAI/Gemini have not been smoke-tested; only mocked
  HTTP behavior (success, 401/429/5xx, network failure, timeout) is verified
  by tests. Set one of these keys and `AI_PROVIDER=openai|gemini` to exercise
  the real adapters.

## Next
- Day 2 — Blog AI Pipeline (business context → duplicate-topic check →
  content generation → validation → content_history), building on the
  provider layer finished today.

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
- (recorded after this file is committed — see git log)
