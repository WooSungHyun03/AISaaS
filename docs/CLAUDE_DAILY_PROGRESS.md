# Claude Daily Development Progress

The full day-by-day spec (Definition of Done, rules, git procedure) lives in
[`DAILY_ROUTINE_PLAN.md`](DAILY_ROUTINE_PLAN.md). This file only tracks
*which* day is current and a dated history. Read both at the start of every
run.

## Current Day
Day 6 — Production Scheduler

## Completed
- Day 1 — Production AI Provider (merged to `main` via PR #1, commit `cea124c`)
- Day 2 — External Platform Connection Management (2026-09-23)
- Day 3 — WordPress Production Connector (2026-09-23)
- Day 4 — Blog AI Pipeline Upgrade (2026-09-24)
- Day 5 — Automation Runner Reliability (2026-09-25)

## Current
- (none — Day 6 not started yet)

## Blocked External
- OPENAI_API_KEY / GEMINI_API_KEY: not present in this environment. Real
  network calls to OpenAI/Gemini have not been smoke-tested; only mocked
  HTTP behavior (success, 401/429/5xx, network failure, timeout) is verified
  by tests. Set one of these keys and `AI_PROVIDER=openai|gemini` to exercise
  the real adapters.
- Supabase Vault (`integration_secret_create/update/read/delete` in
  `0015_integration_connections.sql`): this environment has no live Supabase
  project, so the Vault-backed RPCs have only been verified against a
  mocked Supabase client (`src/server/connectors/integrations.test.ts`), not
  against a real `vault.secrets` table. The migration's `supabase_vault`
  extension bootstrap is wrapped to fail soft (table/RLS still get created)
  if Vault genuinely isn't installable in a given Postgres instance, but the
  actual secret create/read/rotate/delete round-trip needs a real Supabase
  project to smoke-test end to end.
- No real WordPress site/Application Password in this environment:
  `WordPressConnector`'s `testConnection()`/`publish()` and the new
  `verifyAndConnectWordPress()` bridge are only verified against a mocked
  `node:https`/`node:dns` layer (`src/server/connectors/wordpress/*.test.ts`),
  not a live WordPress REST API. Set `WORDPRESS_SITE_URL`/`WORDPRESS_USERNAME`/
  `WORDPRESS_APP_PASSWORD` to smoke-test the legacy env-based connector path
  for real.

## Next
- Day 6 — Production Scheduler: verify `findDueAutomations()` selects only
  `ACTIVE` automations with `next_run_at <= now()` in UTC consistently
  (KST conversion only at the user-facing edges), confirm the Supabase Edge
  Function stays a thin secret-forwarding trigger and the cron route
  rejects a missing/mismatched `CRON_SECRET` before doing anything else,
  confirm `next_run_at` is recomputed/persisted at run *start* (not
  completion) so a slow run isn't picked up twice, add/verify a
  concurrent-tick test (two near-simultaneous due-automation passes only
  run the automation once — combines with Day 5's duplicate-run guard),
  and check `computeNextRunAt`'s existing DST/timezone-boundary coverage in
  `scheduler.test.ts` for gaps. See `DAILY_ROUTINE_PLAN.md` Day 6 for the
  full spec.

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

### 2026-09-23
Completed Day 2 — External Platform Connection Management:
- New migration `supabase/migrations/0015_integration_connections.sql`:
  `integration_connections` table (`user_id`, `business_id`, `provider`
  check-constrained to `wordpress|instagram|email|youtube`,
  `account_identifier`, `status` check-constrained to
  `CONNECTED|EXPIRED|ERROR|DISCONNECTED`, `secret_reference`, `metadata`
  jsonb, `connected_at`/`updated_at`), unique on `(business_id, provider)`
  so a reconnect updates the same row instead of duplicating it, RLS with a
  select-only-your-own-rows policy (no insert/update/delete policy — all
  writes go through the service-role client, matching the
  `subscriptions`/`usage`/`automation_runs` pattern).
- Same migration attempts to enable the `supabase_vault` extension (wrapped
  in an exception-handling `do $$ ... $$` block so table/RLS creation still
  succeeds if Vault genuinely can't be installed) and adds four
  `SECURITY DEFINER` wrapper functions —
  `integration_secret_create/update/read/delete` — granted to `service_role`
  only, revoked from `anon`/`authenticated`/`public`. These are the only way
  application code touches Vault; the `vault` schema itself isn't exposed to
  PostgREST.
- `src/server/connectors/integrations.ts` (server-only, `"server-only"`
  guard): `createConnection()` (stores/rotates the secret in Vault, then
  upserts the row — reconnecting the same business+provider rotates the
  existing Vault secret instead of orphaning it), `getConnection()`,
  `getConnectionSecret()` (decrypts through Vault; null without a Vault call
  when there's no secret), `updateConnectionStatus()`,
  `disconnectConnection()` (deletes the Vault secret, marks `DISCONNECTED`,
  preserves the row for history instead of deleting it).
- `src/types/database.types.ts` / `src/types/domain.ts`: added the
  `integration_connections` table Row/Insert/Update types, typed the four
  new RPC functions (`Database["public"]["Functions"]`, previously an empty
  placeholder), and `IntegrationProvider`/`ConnectionStatus` union types,
  following the existing `AutomationStatus`-style pattern.
- Tests: `src/server/connectors/integrations.test.ts` (10 tests) — Vault
  secret creation and rotation-on-reconnect, secret material never appearing
  in the row written to `integration_connections` (asserted against the
  actual upsert payload, not just the mocked return value), Vault-error
  propagation, `getConnectionSecret` skipping the Vault RPC entirely when
  there's no `secret_reference`, status/metadata updates scoped by id, and
  `disconnectConnection`'s three paths (has a secret / never had one /
  connection doesn't exist).
- Documented the design in `docs/ARCHITECTURE.md` (new "Integration
  Connections & Secret Storage" section): the Vault-wrapper-function
  approach, the fail-closed behavior if Vault is unavailable (no plaintext
  fallback), and an explicit note that WordPress's existing credential path
  (`src/server/connectors/wordpress/credentials.ts`, AES-256-GCM, storing
  `encryptedAppPassword` inside `automations.config` per-automation) is a
  separate, already-working mechanism not touched by this Day — migrating
  it onto this new shared table is Day 3 scope, not Day 2's.
- Did not touch `src/app/`, `src/components/`, `src/server/directory/`, or
  `src/server/customer-support/` — this Day's diff is fully contained to
  `supabase/migrations/`, `src/types/`, and a new
  `src/server/connectors/integrations.ts` module.

Tests:
- lint: pass (`npm run lint`)
- typecheck: pass (`npm run typecheck`)
- test: pass, 35/35 (`npm test`, includes 10 new integration-connection tests)
- build: pass (`npm run build`)

Blocked External:
- No live Supabase project in this environment, so Vault's real
  create/read/rotate/delete round-trip is only verified against a mocked
  Supabase client, not a real `vault.secrets` table. See "Blocked External"
  above for detail.

Commit:
- (see git log for this file's commit)

Push:
- origin/main

### 2026-09-23 (Day 3)
Completed Day 3 — WordPress Production Connector:
- `src/server/connectors/wordpress/index.ts`: closed two failure-classification
  gaps found while implementing this Day's mocked-HTTP test suite —
  (1) a request/response timeout, a raw connection error (e.g. refused/reset),
  and an oversized response body previously rejected with a bare `Error`
  instead of a classified `ConnectorError`; now `TIMEOUT` and
  `NETWORK_FAILURE` are distinguished (a `timedOut` flag set only by the
  timeout callback) and both are always a `ConnectorError`. (2) a DNS lookup
  that fails outright (e.g. `ENOTFOUND`) previously threw the raw Node DNS
  error instead of `ConnectorError` `INVALID_TARGET`; `publicHostAddress()`
  now catches and reclassifies it. HTTP status classification
  (401/403/4xx/5xx → `AUTH_FAILED`/`PERMISSION_DENIED`/
  `UPSTREAM_CLIENT_ERROR`/`UPSTREAM_SERVER_ERROR`) and the SSRF guard
  (public-HTTPS-only URL validation, private/loopback/link-local/CGNAT
  address rejection, DNS-rebinding-safe address pinning on the actual
  request) already existed from earlier work and needed no change — verified
  against the Day 3 spec rather than rebuilt.
- New `src/server/connectors/wordpress/connect.ts`: the Day 2 → Day 3 bridge.
  `verifyAndConnectWordPress()` calls `testConnection()` first and only calls
  Day 2's `createConnection()` (Vault-backed `CONNECTED` row) on success — a
  bad credential is never persisted as connected. `loadWordPressConnector()`
  reads a business's `integration_connections` row + Vault secret back into a
  ready-to-use `WordPressConnector`, returning `null` for any connection
  that isn't `CONNECTED` or has no secret/username on record.
- Did not touch `blog.ts` or `src/app/(app)/automations/actions.ts`: per this
  Day's own Definition of Done, the handler needs no behavior change beyond
  what the connector already returns (`publish()` already returned
  `{ externalUrl, externalId }`, already persisted onto
  `automation_runs.output` and `content_history.external_url` via the
  existing runner pipeline from earlier work), and rewiring the connect-flow
  Server Action in `src/app/` to call the new `connect.ts` bridge instead of
  the legacy per-automation `encryptedAppPassword` path is UI-adjacent work
  outside Dev1's minimal-diff rule for that directory (`docs/TEAM_GUIDE.md`
  file ownership) — left for Dev2 coordination, documented in
  `docs/ARCHITECTURE.md`.
- Deliberately did not rename `PublishResult.externalId` to
  `externalPostId` (as the roadmap's prose names it): it's a shared type
  used by every connector (WordPress/Instagram/Email/YouTube), the field
  already carries the right information, and `blog.ts` doesn't read it —
  renaming would touch every connector for no behavioral gain.
- Tests: expanded `src/server/connectors/wordpress/index.test.ts` from 2 to
  19 cases — happy-path verify+publish (draft and default-publish status),
  every HTTP status classification for both `testConnection()` and
  `publish()`, timeout, raw connection error, oversized response body, DNS
  lookup failure, private-address resolution, and the unconfigured
  (`NOT_CONFIGURED`) case. New `connect.test.ts` (7 cases): persists only
  after successful verification, never persists on verification failure,
  and all four `loadWordPressConnector()` branches (no connection / not
  CONNECTED / secret missing / builds a working connector).
- Documented the design in `docs/ARCHITECTURE.md`: a new "WordPress
  Connector" section (SSRF guard, failure classification, verify-then-persist)
  and an updated "Integration Connections & Secret Storage" note describing
  the two coexisting WordPress credential paths and why only one was
  rewired this Day.
- Did not touch `src/app/`, `src/components/`, `src/server/directory/`, or
  `src/server/customer-support/`.

Tests:
- lint: pass (`npm run lint`)
- typecheck: pass (`npm run typecheck`)
- test: pass, 61/61 (`npm test`, includes 26 new/expanded WordPress
  connector tests)
- build: pass (`npm run build`)

Blocked External:
- No real WordPress site/Application Password in this environment — see
  "Blocked External" above for detail.

Commit:
- (see git log for this file's commit)

Push:
- origin/main

### 2026-09-24 (Day 4)
Completed Day 4 — Blog AI Pipeline Upgrade:
- Checked `businesses` (`supabase/migrations/0003_businesses.sql`) first per
  this Day's own instruction to verify before adding a migration:
  `location` already existed as a column and on `Business`/`database.types.ts`
  — no new migration needed.
- `src/server/ai/prompts/blog.ts`: split the old single-stage
  `buildBlogPrompt()`/`blogContentSchema` into `blogTopicSchema`
  (`{ topic, title }`) + `blogBodySchema`
  (`{ excerpt, bodyHtml, keywords, callToAction }`), with
  `blogContentSchema = blogTopicSchema.merge(blogBodySchema)` as the unified
  `{ topic, title, excerpt, bodyHtml, keywords, callToAction }` shape the
  spec asked for. `buildBlogTopicPrompt()` and `buildBlogBodyPrompt()` both
  feed the business's `name`/`industry`/`location`/`description`/
  `target_customer`/`brand_tone`/`keywords` plus the automation's own
  `objective`/`tone`/`keywords`; the topic prompt also takes the recent
  `content_history` topics (already threaded through as `ctx.recentTopics`
  by `runner.ts`) and an optional `rejectedTopic` to steer a regeneration
  away from what was just rejected.
- New `src/server/ai/similarity.ts`: character-bigram Jaccard similarity on
  normalized text (lowercase, NFKC, `\p{L}\p{N}` filter strips
  punctuation/whitespace) — deliberately not whitespace/word tokenization,
  since Korean topic phrases often have no spaces to split on, and
  deliberately not embeddings (no new vector infra for one similarity
  check). `isNearDuplicateTopic(candidate, recentTopics, threshold = 0.5)`.
  Threshold picked empirically: a real near-duplicate pair in the test
  suite (differently-phrased same idea) scored ~0.58, a genuinely distinct
  pair scored well under 0.3.
- `src/server/automations/handlers/blog.ts` rewritten around the two-stage
  pipeline: `generateTopic()` calls stage 1, checks
  `isNearDuplicateTopic()`, and — bounded, never a loop — regenerates stage
  1 **exactly once** if it's a near-duplicate, accepting whatever comes
  back from that single retry regardless of its own similarity. Stage 2
  (body) always runs once, against the accepted topic/title. Any throw from
  either stage (or from a configured WordPress publish) propagates out of
  `run()` unchanged — `runner.ts`'s existing try/catch (unmodified this
  Day) already only inserts into `content_history` after `handler.run()`
  resolves, so a mid-pipeline failure was already guaranteed to leave no
  partial/corrupt history row; this Day added tests proving both failure
  points (topic stage, body stage) actually throw instead of silently
  returning partial content.
- Reconciled the two parallel content shapes instead of leaving them:
  `PublishContentParams` (`src/server/connectors/types.ts`) gained an
  optional `excerpt` field, `WordPressConnector.publish()`
  (`src/server/connectors/wordpress/index.ts`) now sends it to
  `/wp-json/wp/v2/posts` when present (other connectors already destructure
  an unused `_params`, so this is additive/non-breaking for them).
  `content_history.content` (a plain-text column rendered with
  `whitespace-pre-line` in `src/app/(app)/automations/[id]/page.tsx`) now
  gets a small in-handler `stripHtml()` rendering of `bodyHtml` rather than
  raw HTML tags — `automation_runs.output` still keeps the full structured
  object with the raw `bodyHtml` for any future consumer. Did not touch
  `src/app/` itself: the existing detail-page rendering of
  `output.title`/`output.topic`/`output.externalUrl`/`item.content` all
  keep working unchanged with the new shape, so per this routine's minimal-
  diff rule for that directory there was nothing there that needed editing.
- Tests: `src/server/ai/similarity.test.ts` (9 cases — exact match,
  punctuation/case/whitespace-only differences, a real near-duplicate pair,
  genuinely distinct topics, empty-string edge case, and the
  `isNearDuplicateTopic` wrapper including the empty-recent-topics case).
  `src/server/automations/handlers/blog.test.ts` (10 cases, `generateStructured`
  and `WordPressConnector` mocked) — the two-stage pipeline producing the
  unified shape, the regenerate-once-on-near-duplicate path, no regeneration
  when the first topic is already distinct, WordPress publish receiving
  `title`/`bodyHtml`/`excerpt`, both the wizard-configured and legacy
  env-configured WordPress paths (including the "not configured" skip
  case), and both failure points propagating instead of returning partial
  output.
- Documented the design in `docs/ARCHITECTURE.md` (new "Blog AI Pipeline
  (Day 4)" section).
- Did not touch `src/components/`, `src/server/directory/`, or
  `src/server/customer-support/`.

Tests:
- lint: pass (`npm run lint`)
- typecheck: pass (`npm run typecheck`)
- test: pass, 78/78 (`npm test`, includes 19 new Day 4 tests)
- build: pass (`npm run build`) — required a local-only `.env.local` with
  placeholder Supabase/public values to get past static page collection for
  `/api/cron/run-automations`; not committed (already gitignored), no real
  credentials involved.

Blocked External:
- OPENAI_API_KEY / GEMINI_API_KEY / WordPress credentials: unchanged from
  above — this Day's new prompts/schemas run through the same mocked
  provider path as before, no new live-credential surface was added.

Commit:
- (see git log for this file's commit)

Push:
- origin/main

### 2026-09-25 (Day 5)
Completed Day 5 — Automation Runner Reliability:
- New migration `supabase/migrations/0016_automation_run_source.sql`: adds
  `automation_runs.source text not null default 'SCHEDULED' check (source in
  ('MANUAL','SCHEDULED'))`. Default backfills existing rows (all
  cron-triggered in practice before this Day) without a separate UPDATE.
  `src/types/database.types.ts`/`src/types/domain.ts` gained the matching
  `AutomationRunSource` type and `Row`/`Insert` field.
- `src/server/automations/runner.ts` rewritten around a single
  `executeAutomation(automationId, source)` core (was
  `executeAutomation(automationId, { advanceSchedule })`) so `source` drives
  both the stamped column and whether the schedule advances, removing a
  second implicit parameter that had to stay in sync with it:
  - **Status gate**: a `PAUSED`/`ERROR` automation is refused before the
    handler runs — closes a real gap where the existing manual "Run Now"
    Server Action (`src/app/(app)/automations/actions.ts`, not touched this
    Day per the minimal-diff rule) checked ownership and entitlement but
    never re-checked automation status, so a paused automation could still
    be manually triggered. Verified by re-reading `triggerRunNow()` before
    writing the fix rather than assuming.
  - **Entitlement gate**: `canExecuteAutomation()` (already existed from
    prior work, not reimplemented — checked `src/server/billing/
    entitlements.ts` first per project rule 9) is now re-checked inside the
    runner itself, closing the matching gap on the cron path
    (`runDueAutomation()` had no entitlement check at all before this Day).
  - **Refused runs are recorded** via a new `recordRefusedRun()` helper — an
    already-`FAILED` `automation_runs` row with a Korean, secret-free
    `error_message`, never touching `automations.status` (a refusal isn't a
    new failure). A refused `SCHEDULED` run advances `next_run_at` when the
    reason can recur next tick (a plan limit) so the cron loop doesn't
    re-attempt and re-refuse the same slot every few minutes; a paused/error
    refusal doesn't need to (already excluded from `findDueAutomations()`).
  - **Every lifecycle-transition write is now error-checked** — the
    Supabase client resolves `{ error }` on a failed query rather than
    throwing, so the pre-existing code silently ignored a failed
    mark-`SUCCESS`/`content_history`-insert/`next_run_at`-advance write; a
    run could end up permanently stuck `RUNNING` if the one update meant to
    close it out failed and nobody noticed. Fixed by checking `error` and
    throwing into the existing `catch`, which then marks the run `FAILED`
    and the automation `ERROR` as it already did for handler exceptions.
    The final catch-block writes are themselves error-checked and logged
    (`automation_run_terminal_write_failed`) as a last-resort observability
    measure — there is nothing further to safely retry in the same request.
  - Confirmed (did not need to change) the pre-existing duplicate-run guard:
    the app-level in-flight check plus the DB partial unique index
    (`automation_runs_one_inflight_idx`, `0006_automation_runs.sql`) already
    cover both the manual double-click case and a concurrent scheduled tick
    — added tests for both instead of re-implementing.
  - Confirmed (did not need to change) that a genuine handler failure
    already flips the automation to `ERROR`, which is a strictly stronger
    "never retry-storm" guarantee than merely advancing `next_run_at`, since
    `findDueAutomations()` only ever selects `status = 'ACTIVE'`.
- `src/server/shared/errors.ts#describeAutomationRunError()`: added a
  passthrough for the runner's own refusal reasons (already complete,
  secret-free Korean sentences) instead of flattening them into the generic
  fallback message.
- Tests: new `src/server/automations/runner.test.ts` (10 cases) — a
  table-name-dispatched mock Supabase admin client (queued per-table
  results, since `automation_runs`/`automations` are each queried multiple
  times per execution for different purposes) covering: `source` tagging on
  both entry points, `next_run_at` advancing only for a scheduled success
  (never manual), refusal on `PAUSED`/`ERROR`/entitlement-denied without
  ever calling the handler, the duplicate-run guard for both a manual
  double-click and a concurrent scheduled tick, an unanticipated handler
  exception being caught and terminating the run as `FAILED`/the automation
  as `ERROR`, and a DB write failure on the SUCCESS-marking update itself
  still resulting in `FAILED` rather than a silently stuck `RUNNING` row.
- Documented the design in `docs/ARCHITECTURE.md` (new "Runner Reliability
  (Day 5)" subsection under Automation Flow, updated the `automation_runs`
  DB summary line and the flow diagram).
- Did not touch `src/app/`, `src/components/`, `src/server/directory/`, or
  `src/server/customer-support/` — the manual "Run Now" Server Action needed
  no change since the new guards live in the shared runner core both entry
  points already call through.

Tests:
- lint: pass (`npm run lint`)
- typecheck: pass (`npm run typecheck`)
- test: pass, 88/88 (`npm test`, includes 10 new runner-reliability tests)
- build: pass (`npm run build`) — required the same local-only `.env.local`
  placeholder values as Day 4 to get past static page collection for
  `/api/cron/run-automations`; not committed (gitignored).

Blocked External:
- None new — this Day's work is entirely internal runner logic and a schema
  addition; no new external credential surface.

Commit:
- (see git log for this file's commit)

Push:
- origin/main
