# Claude Daily Development Progress

The full day-by-day spec (Definition of Done, rules, git procedure) lives in
[`DAILY_ROUTINE_PLAN.md`](DAILY_ROUTINE_PLAN.md). This file only tracks
*which* day is current and a dated history. Read both at the start of every
run.

## Current Day
Day 11 — Usage, Entitlements & Cost Protection

## Completed
- Day 1 — Production AI Provider (merged to `main` via PR #1, commit `cea124c`)
- Day 2 — External Platform Connection Management (2026-09-23)
- Day 3 — WordPress Production Connector (2026-09-23)
- Day 4 — Blog AI Pipeline Upgrade (2026-09-24)
- Day 5 — Automation Runner Reliability (2026-09-25)
- Day 6 — Production Scheduler (2026-09-26)
- Day 7 — Newsletter Automation + Resend Connector (2026-09-27)
- Day 8 — Instagram Professional Account Connection (2026-09-28)
- Day 9 — Instagram Publishing (2026-09-29)
- Day 10 — Toss Payments Billing Provider (2026-09-30)

## Current
- (none — Day 11 not started yet)

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
- No live Supabase project in this environment (unchanged from Day 2): Day
  6's `0018_scheduler_cron_auth.sql` (pg_cron → Edge Function Authorization
  header) and the `alter database ... set app.settings.service_role_key`
  one-time step it depends on have not been smoke-tested against a real
  `pg_cron`/`pg_net` install — verified by reading Supabase's documented
  `verify_jwt`/pg_net behavior and by the existing scheduler/runner unit
  tests, not by an actual cron tick firing. Confirm on first real deploy that
  `select * from cron.job_run_details order by start_time desc limit 5;`
  shows successful (200) runs, not 401s.
- RESEND_API_KEY / RESEND_FROM_EMAIL: not present in this environment.
  `ResendConnector` (`src/server/connectors/email/resend.ts`) is only
  verified against a mocked global `fetch` (success incl. exact request
  body/headers, 401/422 non-retryable, a single 5xx retried once then
  succeeding, repeated 5xx exhausting the bound, network failure, timeout —
  `src/server/connectors/email/resend.test.ts` +
  `resend.send.test.ts`), never against the real Resend API. Set both env
  vars to smoke-test a real send.
- No live Supabase project in this environment (same root cause as above):
  the new `subscribers` table + RLS (`0026_subscribers.sql`) have only been
  exercised through a mocked Supabase client
  (`src/server/automations/handlers/newsletter.test.ts` mocks
  `listActiveSubscribers()` directly), not against a real Postgres
  instance with RLS actually enforced.
- META_ACCESS_TOKEN / META_IG_USER_ID / INSTAGRAM_APP_ID /
  INSTAGRAM_APP_SECRET: no Meta app or test Instagram Professional account
  exists in this environment. The full OAuth flow (`src/server/connectors/
  instagram/oauth.ts` + `connect.ts`, `src/app/api/integrations/instagram/
  {connect,callback}/route.ts`) is only verified against a mocked `fetch`
  (state validation, non-professional rejection, token-exchange/
  profile-fetch failure classification, the success path persisting a
  Vault-backed connection) — never against the real Meta Graph API. Set
  `INSTAGRAM_APP_ID`/`INSTAGRAM_APP_SECRET` and register the callback URL
  (`${NEXT_PUBLIC_SITE_URL}/api/integrations/instagram/callback`) in the
  Meta App Dashboard to smoke-test a real connection end to end.
- META_ACCESS_TOKEN / META_IG_USER_ID / a connected Instagram Professional
  account (same root cause as above, Day 9): the full container-create →
  status-check → `media_publish` sequence
  (`src/server/connectors/instagram/index.ts#InstagramConnector.publish()`)
  and the `marketing-assets` Storage bucket upload
  (`src/server/connectors/instagram/media.ts`) are only verified against a
  mocked `fetch`/mocked Supabase Storage client, never against the real
  Meta Graph API or a real Supabase project. Also unverified: whether
  Meta's Content Publishing API accepts the marketing card as PNG in
  practice — Meta's documented spec for `image_url` names JPEG; this Day
  used PNG (built with pure Python `zlib`, no new image-generation
  dependency per the roadmap's own constraint) since hand-rolling a JPEG
  encoder without a library was judged out of proportion for a single
  static asset. If a real smoke test shows Meta rejects PNG, re-encode the
  same asset as JPEG (still no new dependency needed for a one-time
  conversion) — everything else in the pipeline (Storage bucket, URL
  construction, publish sequence) is format-agnostic and needs no change.
- TOSS_SECRET_KEY / NEXT_PUBLIC_TOSS_CLIENT_KEY: no live Toss Payments test
  merchant account exists in this environment. `TossBillingProvider`
  (`src/server/billing/providers/toss.ts`) and the low-level
  `TossApiClient` (`src/server/billing/providers/toss-api.ts`) — billing-key
  issuance, billing-key charge, billing-key deletion — are only verified
  against a mocked `fetch`/mocked `TossApiClient` (`toss-api.test.ts`,
  `toss.test.ts`: success, a declined-card `TossApiError`, a payment/amount
  verification mismatch, a customer-key mismatch, a network failure, and
  the best-effort billing-key-delete-on-cancel path), never against Toss's
  real test-mode API. Set both env vars with a Toss test key pair (from the
  Toss Payments developer center) and complete a real `/billing/toss-checkout`
  flow to smoke-test end to end; confirm the resulting `billing_checkout_sessions`
  row shows `status = 'SUCCEEDED'` with a real `provider_payment_key`.

## Next
- Day 11 — Usage, Entitlements & Cost Protection: see `DAILY_ROUTINE_PLAN.md`
  Day 11 for the full spec (server-side enforcement of `canExecuteAutomation()`
  before both automation execution and any AI call inside a handler,
  exactly-once usage increment per attempt regardless of success/failure,
  standard `LIMIT_EXCEEDED`/`FEATURE_NOT_AVAILABLE`/`PLAN_REQUIRED` error
  codes returned before any connector/external API call, and month-boundary
  correctness tests around `Asia/Seoul` `YYYY-MM` usage keys — including the
  first run of a new month creating a fresh usage row rather than erroring).

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

### 2026-09-26 (Day 6)
Completed Day 6 — Production Scheduler:
- Verified (no code change needed) `findDueAutomations()`
  (`src/server/automations/scheduler.ts`): selects only `status = 'ACTIVE'`
  with `next_run_at <= now()`, both stored/compared as UTC `timestamptz`,
  backed by the existing `automations_due_idx` partial index. KST conversion
  happens only inside `computeNextRunAt()`/`zonedTimeToUtc()`
  (`src/lib/utils/date.ts`) — confirmed nothing else in the scheduler path
  touches wall-clock time.
- `src/server/automations/runner.ts`: moved the `next_run_at` advance
  (`computeNextRunAt()` + write) from *after* the handler completes to
  *immediately after* the `RUNNING` row is inserted, before the handler is
  ever called — still inside Day 5's existing `try`, so a write failure here
  is caught exactly like any other lifecycle-write failure (run `FAILED`,
  automation `ERROR`). Before this change, a slow run left the automation
  looking "due" (old, already-past `next_run_at`, still `ACTIVE`) for every
  cron tick until it finished, relying entirely on the in-flight guard to
  reject each repeat attempt instead of the automation simply not being
  selected as due again. The success-path completion write now only touches
  `last_run_at`; `next_run_at` is never written twice.
- Found and fixed a real production gap while verifying "the cron route
  rejects a missing/mismatched CRON_SECRET before doing anything else"
  (already true) one hop earlier: `0014_scheduler_cron.sql`'s pg_cron job
  called the Supabase Edge Function via `net.http_post()` with no
  `Authorization` header at all. Supabase Edge Functions reject
  unauthenticated requests by default (`verify_jwt`), so on a real
  deployment the scheduler could never fire a single tick — invisible here
  since there's no live Supabase project to smoke-test pg_cron against. New
  migration `supabase/migrations/0018_scheduler_cron_auth.sql` (never edited
  0014, per the never-edit-a-migration rule) reschedules the same job with
  `Authorization: Bearer <service_role_key>`, the key read at execution time
  from `current_setting('app.settings.service_role_key', true)` — a
  database-level setting configured once directly on the live database, not
  committed to git (documented as a new required manual step in README.md
  "Deployment", alongside the existing `supabase secrets set` step). If that
  setting is never configured, the job keeps failing with 401 exactly as it
  silently did before — fail-closed, no-worse-than-before, never a silent
  security downgrade. The Edge Function itself is untouched and stays exactly
  as thin as before; `CRON_SECRET` (checked by the Next.js route) remains the
  actual authorization boundary for running automations, not this new header.
- Verified (no code change) the two-layer concurrent-tick protection: the
  app-level `SELECT ... WHERE status IN ('QUEUED','RUNNING')` check is a
  check-then-act race on its own, but the DB partial unique index
  `automation_runs_one_inflight_idx` (`0006_automation_runs.sql`, existing
  from before Day 5) is the real backstop — a losing INSERT fails with a
  unique-violation error that propagates before the handler is ever called.
  Added a test exercising that DB-level path directly (not just the
  app-level check a concurrent tick would normally hit first).
- Checked `computeNextRunAt`'s DST/timezone-boundary coverage
  (`scheduler.test.ts`) for gaps per this Day's own instruction: found none
  in the actual product path (Asia/Seoul has no DST, so no gap/ambiguous-time
  case exists there) but the existing tests had zero year-boundary or
  month-boundary coverage even for the no-DST case, and zero coverage of
  `zonedTimeToUtc`'s gap/ambiguous-time resolution for a schedule that *did*
  specify a DST-observing timezone (the type is a generic IANA string,
  `types/automation.ts`, even though the product only ever schedules in
  KST today). Added both: year/month-boundary DAILY+WEEKLY rollovers (all
  passed unchanged — no bug found, so `computeNextRunAt` itself was not
  modified, per this Day's own "don't change passing expectations without a
  demonstrated bug" rule) and two documentation-only tests locking in the
  current spring-forward-gap and fall-back-ambiguous-hour resolution for
  `America/New_York` as an explicit, visible contract instead of undefined
  behavior nobody had actually checked.
- Documented all of the above in `docs/ARCHITECTURE.md` (new "Production
  Scheduler (Day 6)" subsection under Automation Flow).
- Did not touch `src/app/`, `src/components/`, `src/server/directory/`, or
  `src/server/customer-support/`.

Tests: `src/server/automations/runner.test.ts` (12 cases, 3 new: `next_run_at`
provably advances before the handler is invoked — asserted from inside the
mocked handler itself — a DB unique-violation insert error rejecting a
concurrent tick before the handler runs, and the manual-run assertion updated
to reflect that a manual completion write no longer touches `next_run_at` at
all instead of redundantly re-writing its unchanged value).
`src/server/automations/scheduler.test.ts` (8 cases, 5 new: year-boundary
DAILY/WEEKLY, a non-leap-February month boundary, and the two DST
documentation cases above).

Tests:
- lint: pass (`npm run lint`)
- typecheck: pass (`npm run typecheck`)
- test: pass, 104/104 (`npm test`)
- build: pass (`npm run build`) — required the same local-only `.env.local`
  placeholder values as Days 4/5 to get past static page collection;
  not committed (gitignored).

Blocked External:
- No live Supabase project in this environment: `0018_scheduler_cron_auth.sql`
  and its required `app.settings.service_role_key` one-time setup have not
  been smoke-tested against a real `pg_cron`/`pg_net` install. See "Blocked
  External" above for the exact verification step to run on first real
  deploy.

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

### 2026-09-27 (Day 7)
Completed Day 7 — Newsletter Automation + Resend Connector:
- New migration `supabase/migrations/0026_subscribers.sql` (next sequential
  number — the repo currently has two files numbered `0018`, from parallel
  work; picked `0026` after `0025_directory_tools_classification_source.sql`,
  the highest existing number, never edited an existing file): `subscribers`
  (`business_id`, `email`, `name`, `status` check-constrained to
  `ACTIVE|UNSUBSCRIBED`, `subscribed_at`, `unsubscribed_at`), unique on
  `(business_id, email)` so re-subscribing updates the same row instead of
  duplicating it, `updated_at` trigger. RLS follows `business_faqs`'
  exact pattern (`0022_business_faqs.sql`) — every policy re-checks
  `businesses.owner_id = auth.uid()` via subquery, full owner CRUD (the
  newsletter handler itself always reads through the service-role client
  and bypasses RLS; these policies are for a future owner-facing
  subscriber management page, not built this Day).
- `src/types/database.types.ts`/`domain.ts`: `subscribers` table Row/
  Insert/Update, `SubscriberStatus` type, `Subscriber` alias.
- `src/server/ai/prompts/newsletter.ts`: `newsletterContentSchema`
  (`{ subject, previewText, htmlBody }`) + `buildNewsletterPrompt()`,
  following `prompts/blog.ts`'s shape (business-profile context, an
  `avoid these recent subjects` steer).
- `src/server/connectors/email/provider.ts`: new `EmailConnector`
  interface (`isConfigured()` + `send(params)`) mirroring the
  `AIProvider`/`BillingProvider` vendor-neutral pattern — deliberately not
  `PlatformConnector` (one email per subscriber is a different shape than
  "publish one thing to one account"). `src/server/connectors/email/
  resend.ts`: `ResendConnector` implementation — plain `fetch` (not
  WordPress's raw `node:https`; a fixed trusted endpoint has no SSRF
  surface to validate), a bounded one-retry loop for transient failures
  only (`TIMEOUT`/`UPSTREAM_SERVER_ERROR`/`NETWORK_FAILURE`), and an
  `Idempotency-Key` header on every request derived from
  `${automation_runs.id}:${subscriber.id}` so a retried attempt for the
  same run + recipient is deduped by Resend instead of delivering twice.
  `src/server/connectors/email/subscribers.ts`: `listActiveSubscribers()`
  (service-role read, status = ACTIVE only).
- Added `runId: string` to `AutomationRunContext`
  (`src/types/automation.ts`) and threaded `run.id` into it from
  `runner.ts` (the row the runner already inserts before calling
  `handler.run()`) — the one piece newsletter's idempotency key needed
  that no existing handler had a reason to ask for. Verified this doesn't
  change any other handler's behavior (structural typing; only blog.ts's
  test needed a `runId` added to its hand-built context fixture).
- `src/server/automations/handlers/newsletter.ts`: business profile +
  recent subjects → `generateStructured()`, regenerating the subject
  exactly once on a near-duplicate (reused Day 4's
  `isNearDuplicateTopic()` — same bounded-once pattern as
  `blog.ts#generateTopic()`, never a loop) → send to every ACTIVE
  subscriber. A per-recipient failure (bad address, exhausted transient
  retry) is recorded and the loop continues; an auth/permission/
  not-configured failure aborts the whole run immediately (every
  remaining send would fail identically) and propagates so the runner
  marks the run `FAILED`. Persists `subject`, `previewText`,
  `totalSubscribers`, `successCount`, `failureCount`, `messageIds`, and
  `failures` on `automation_runs.output`.
- Extracted two small pieces of duplicated logic once a second real call
  site needed them (Rule 10): `stripHtml()` (blog.ts → new
  `src/server/shared/html.ts`) and `classifyHttpStatus()`
  (wordpress/index.ts → `src/server/shared/errors.ts`, now shared by both
  the WordPress and Resend connectors).
- Left `newsletter` as `COMING_SOON` in `AUTOMATION_AVAILABILITY`
  (`src/types/automation.ts`) even though the backend is fully done —
  flipping it needs a subscriber-list management UI that doesn't exist
  yet (Dev2/UI scope, `src/app/`/`src/components/`), same reasoning Day 3
  used for WordPress's setup-wizard rewiring.
- `.env.example` already documented `RESEND_API_KEY`/`RESEND_FROM_EMAIL`
  from earlier scaffolding — no change needed there.
- Documented the full design in `docs/ARCHITECTURE.md` (new "Newsletter
  Automation & Resend Connector (Day 7)" subsection under Automation
  Flow, plus a `subscribers` line in "Database Overview").
- Did not touch `src/app/`, `src/components/`, `src/server/directory/`,
  or `src/server/customer-support/`.

Tests: `src/server/connectors/email/resend.test.ts` (not-configured →
`NOT_CONFIGURED`, no `serverEnv` mock needed — same pattern as
WordPress's not-configured test, relying on the real empty test env) +
`resend.send.test.ts` (7 cases, `serverEnv` mocked: send success incl.
exact request body/headers/idempotency key, 401 and 422 never retried,
a single 5xx retried once and succeeding with the same idempotency key
reused, repeated 5xx exhausting the bound at exactly 2 attempts, network
failure, timeout/abort). `src/server/automations/handlers/
newsletter.test.ts` (10 cases): only ACTIVE subscribers reached, per-run
success/failure counts and message ids, a stable idempotency key derived
from `runId` + subscriber id, identical keys across two calls with the
same `runId` (the "retried run" scenario), a partial per-recipient
failure continuing the loop without failing the run, a systemic failure
aborting the run immediately, not-configured failing before any
generation/send call, zero subscribers still succeeding with zero
counts, and both the regenerate-once-on-near-duplicate and
no-regeneration paths. `src/server/automations/runner.test.ts` gained an
assertion that the handler receives `runId` matching the inserted run's
id.

Tests:
- lint: pass (`npm run lint`)
- typecheck: pass (`npm run typecheck`)
- test: pass, 262/262 (`npm test`, includes 19 new Day 7 tests: 9 connector
  + 10 handler)
- build: pass (`npm run build`) — required the same local-only `.env.local`
  placeholder values as Days 4/5/6 to get past static page collection;
  not committed (gitignored). Also required a fresh `npm ci` — this
  session's container had no `node_modules/` at all; installed cleanly
  with 0 vulnerabilities.

Blocked External:
- RESEND_API_KEY / RESEND_FROM_EMAIL and the live Supabase RLS
  round-trip for `subscribers` — see "Blocked External" above for detail.

Commit:
- (see git log for this file's commit)

Push:
- origin/main

### 2026-09-28 (Day 8)
Completed Day 8 — Instagram Professional Account Connection:
- A `feature/directory-cs` merge (2026-09-26, commit `c0e9e6e`, before this
  routine ever reached Day 8) had already landed a working Meta OAuth
  connection flow: `src/server/connectors/instagram/oauth.ts` (authorization
  URL, code exchange + short→long token upgrade, profile fetch,
  professional-account check), `src/app/api/integrations/instagram/
  {connect,callback}/route.ts` (state/CSRF cookie, business-ownership check,
  distinct `state_error`/`denied`/`invalid_business`/`not_configured`/
  `professional_required`/`connected`/`error` outcomes), and the Settings
  page's Connect/reconnect/disconnect UI
  (`src/components/settings/integration-settings.tsx`,
  `src/app/(app)/settings/actions.ts`'s already-generic
  `disconnectIntegration()`). Per this routine's rule 1 and Day 8's own
  progress note, verified this against Day 8's Definition of Done instead of
  rebuilding it — all three DoD criteria (OAuth flow, non-professional
  rejection, no plaintext tokens) were already met by the existing code.
- Found and closed two real gaps rather than declaring the Day complete on
  someone else's unverified work:
  1. **No tests over the actual OAuth orchestration.** The CSRF state
     generation/packing/comparison and the exchange → professional-check →
     persist-or-mark-ERROR sequence lived inline in the two Next.js route
     handlers — untestable without mocking `NextRequest`, a pattern this
     repo doesn't use anywhere else (cron/WordPress/newsletter are all
     tested at the `src/server/` layer). Extracted it into new
     `src/server/connectors/instagram/connect.ts` (mirrors Day 3's
     `wordpress/connect.ts` bridge exactly): `startInstagramOAuth()`,
     `parseInstagramOAuthCookie()`, `isMatchingOAuthState()`,
     `completeInstagramOAuth()`. Both route handlers became thin wrappers
     with the exact same URLs/cookie/query-param contract — a mechanical
     extraction, not a redesign, so this stayed within the minimal-diff
     rule for `src/app/`.
  2. **Inconsistent error handling.** `oauth.ts`'s three Graph/Instagram API
     calls threw a bare `Error` instead of the shared `ConnectorError`/
     `classifyHttpStatus()` taxonomy every other connector (WordPress,
     Resend) uses. Fixed via one `fetchJson()` helper classifying non-2xx
     responses, `AbortSignal.timeout()` timeouts, and raw network failures
     the same way.
- Full design + the explicit Day 9 deferral (detecting an already-stored
  token going bad requires a live Graph API call, which nothing makes yet)
  documented in `docs/ARCHITECTURE.md` (new "Instagram Professional Account
  Connection (Day 8)" subsection under Automation Flow).
- Did not touch `src/server/directory/` or `src/server/customer-support/`.
  Touched `src/app/api/integrations/instagram/{connect,callback}/route.ts`
  only to delegate to the new `src/server/` module (no behavior/URL/UI
  change); `src/components/settings/integration-settings.tsx` and
  `src/app/(app)/settings/actions.ts` needed no change at all.

Tests: `src/server/connectors/instagram/oauth.test.ts` (10 cases, 6 new —
AUTH_FAILED/PERMISSION_DENIED/UPSTREAM_SERVER_ERROR/NETWORK_FAILURE/TIMEOUT
classification plus an incomplete-profile-on-200 case).
`src/server/connectors/instagram/connect.test.ts` (10 cases, new file) —
state round-trip + uniqueness, a malformed/incomplete OAuth cookie, state
mismatch, the success path asserting the exact Vault-backed
`createConnection()` payload, a personal account rejected without
persisting anything, a failed code exchange and a failed profile fetch each
marking a pre-existing connection `ERROR`, and both the
no-pre-existing-connection and the ERROR-marking-lookup-itself-fails cases
never throwing out of `completeInstagramOAuth()`.

Tests:
- lint: pass (`npm run lint`)
- typecheck: pass (`npm run typecheck`)
- test: pass, 279/279 (`npm test`, includes 17 new Day 8 tests: 6 oauth +
  10 connect, net of one pre-existing oauth test unchanged)
- build: pass (`npm run build`) — required the same local-only `.env.local`
  placeholder values as Days 4/5/6/7 to get past static page collection;
  not committed (gitignored). Also required a fresh `npm ci` — this
  session's container had no `node_modules/` at all; installed cleanly with
  0 vulnerabilities.

Blocked External:
- META_ACCESS_TOKEN / META_IG_USER_ID / INSTAGRAM_APP_ID /
  INSTAGRAM_APP_SECRET — see "Blocked External" above for detail.

Commit:
- (see git log for this file's commit)

Push:
- origin/main

### 2026-09-29 (Day 9)
Completed Day 9 — Instagram Publishing:
- Replaced `InstagramConnector.publish()`'s Day 8 placeholder
  (`src/server/connectors/instagram/index.ts`, threw "not implemented
  yet") with the real container-create → status-poll → `media_publish`
  sequence against Meta's Graph API (`graph.instagram.com`, matching
  Day 8's `oauth.ts`): `POST /{ig-user-id}/media` (image_url + caption) →
  bounded polling of `GET /{creation-id}?fields=status_code` (max 5
  attempts, never unbounded) until `FINISHED` → `POST
  /{ig-user-id}/media_publish`. Every non-2xx response, timeout, and raw
  network failure is classified through the shared `ConnectorError`/
  `classifyHttpStatus()` taxonomy, same as WordPress/Resend/Instagram
  OAuth. Constructor mirrors `WordPressConnector`'s shape: an explicit
  `{ accessToken, igUserId }` (from a business's Vault-backed connection)
  takes priority over the legacy env-configured single-account path
  (`META_ACCESS_TOKEN`/`META_IG_USER_ID`).
- New `src/server/connectors/instagram/connect.ts#loadInstagramConnector()`
  — mirrors `wordpress/connect.ts#loadWordPressConnector()` exactly:
  builds an `InstagramConnector` from a business's `integration_connections`
  row (Day 2/8), decrypting the access token through Vault, returning null
  for anything not usably `CONNECTED`.
- **MVP media, taken literally from the roadmap's own wording ("a single
  static marketing-card image"):** every Instagram post uses the exact
  same image — per-post differentiation comes entirely from the
  AI-generated caption/hashtags, not from per-post image rendering. This
  was the only proportionate approach given the constraint (checked
  `package.json` first, per project rule 2/3: no image-rendering/raster
  library exists in this repo, and the roadmap explicitly forbids adding
  one for this Day). Generated a 1080x1080 RGB PNG (indigo→teal brand
  gradient) once with a standalone Python script using only stdlib
  `zlib`/`struct` — not part of the app's dependency tree, the same as a
  designer handing over a finished asset — and embedded it as a base64
  string constant (`src/server/connectors/instagram/assets/
  marketing-card.ts`) rather than reading it from disk at request time, so
  it's guaranteed to be bundled regardless of a Netlify serverless
  function's file-tracing behavior.
- New `src/server/connectors/instagram/media.ts#ensureMarketingCardImageUrl()`
  uploads that PNG to a new public Supabase Storage bucket
  (`marketing-assets`, migration
  `0027_instagram_marketing_assets_bucket.sql` — bucket insert + a
  `storage.objects` RLS policy granting public `select` only, writes stay
  service-role-only) so Meta's API can fetch it by URL; checks for the
  object first and only uploads when missing.
- `src/server/connectors/types.ts`: added an optional `imageUrl?: string`
  to the shared `PublishContentParams` (additive, non-breaking for
  WordPress/other implementers — same pattern Day 4 used for `excerpt`).
- New `src/server/ai/prompts/instagram.ts`: `instagramCaptionSchema`
  (`{ topic, caption, hashtags[] }`) + `buildInstagramCaptionPrompt()`,
  following `prompts/blog.ts`'s business-context + "avoid these recent
  topics" shape.
- `src/server/automations/handlers/instagram.ts` rewritten around:
  generate caption (regenerating once on a near-duplicate topic — same
  bounded-once pattern as `blog.ts#generateTopic()`/`newsletter.ts`, never
  a loop) → `ensureMarketingCardImageUrl()` → resolve a connector (shared
  Day 8 connection, else the legacy env path) → `connector.publish()` →
  persist `topic`/`caption`/`hashtags`/`imageUrl`/`mediaId` on
  `automation_runs.output`. A publish failure classified
  `AUTH_FAILED`/`PERMISSION_DENIED` marks the connection `EXPIRED`; any
  other failure marks it `ERROR` — closing the item Day 8 explicitly
  deferred ("detecting a *stored* token going bad needs a live Graph API
  call, which nothing calls yet").
- Wired into the same `AutomationRunner` core as every other handler — no
  runner change needed; `result.output` already persists to
  `automation_runs.output` generically.
- Flipped `AUTOMATION_AVAILABILITY["instagram-marketing"]`
  (`src/types/automation.ts`) from `COMING_SOON` to `BETA` — the same
  const comment's own rule ("update this the same release a handler stops
  throwing 'not implemented yet'"). No automation-creation wizard change
  needed: the existing generic `AutomationForm` (already used by every
  non-blog template) needs no per-automation config for this handler.
- Added an Instagram branch to `describeAutomationRunError()`
  (`src/server/shared/errors.ts`), mirroring the existing WordPress
  branch, so a failed run surfaces a clear Korean message instead of the
  generic fallback.
- Carousel/Reels explicitly out of scope this Day, per the roadmap.
- Documented the full design in `docs/ARCHITECTURE.md` (new "Instagram
  Publishing (Day 9)" subsection under Automation Flow, plus a Storage
  bucket line in "Database Overview") and added a short Instagram
  deployment note to `README.md` (the bucket is created automatically by
  the migration — no manual Supabase Storage setup needed).
- Did not touch `src/app/`, `src/components/`, `src/server/directory/`,
  or `src/server/customer-support/` — `AUTOMATION_AVAILABILITY` lives in
  `src/types/automation.ts` (a shared domain type), and the existing
  marketplace/automation-creation UI already reads it generically.

Tests: `src/server/connectors/instagram/index.test.ts` (12 cases, new) —
full success sequence, IN_PROGRESS polling to FINISHED, container-creation
failure, an `ERROR` status_code, a stuck-IN_PROGRESS timeout after exactly
the bounded attempt count, a `media_publish` failure, missing `imageUrl`,
not-configured, timeout, network failure.
`src/server/connectors/instagram/media.test.ts` (5 cases, new) — uploads
when missing, skips upload when already present, classifies a list/
upload/missing-public-URL failure.
`src/server/connectors/instagram/connect.test.ts` gained a
`loadInstagramConnector` suite (5 cases): no connection, not `CONNECTED`,
missing secret, missing `accountId` metadata, and the success path.
`src/server/automations/handlers/instagram.test.ts` (10 cases, new) —
shared-connection and legacy-env-fallback paths, a `CONNECTED`-but-unusable
connection marked `ERROR` without calling the AI/connector, an
`AUTH_FAILED` failure marking the connection `EXPIRED` vs. any other
failure marking it `ERROR`, the regenerate-once-on-near-duplicate pattern,
and both a caption-generation failure and a marketing-card-upload failure
propagating without ever calling `publish()`.

Tests:
- lint: pass (`npm run lint`)
- typecheck: pass (`npm run typecheck`)
- test: pass, 311/311 (`npm test`, includes 32 new Day 9 tests: 12
  connector + 5 media + 5 loadInstagramConnector + 10 handler)
- build: pass (`npm run build`) — required a fresh `npm ci` (this
  session's container had no `node_modules/` at all; installed cleanly
  with 0 vulnerabilities) and the same local-only `.env.local` placeholder
  values as prior Days to get past static page collection; not committed
  (gitignored).

Blocked External:
- META_ACCESS_TOKEN / META_IG_USER_ID / a connected Instagram Professional
  account, and whether Meta accepts the marketing card as PNG in
  practice — see "Blocked External" above for detail.

Commit:
- (see git log for this file's commit)

Push:
- origin/main

### 2026-09-30 (Day 10)
Completed Day 10 — Toss Payments Billing Provider:
- Found this Day's core implementation already on `main` from an earlier
  teammate commit (`04b324d`, 2026-09-26, predating this routine's Day 10
  turn) rather than starting from nothing — per this routine's rule 1,
  verified it against the Day 10 Definition of Done instead of rebuilding
  it: `TossBillingProvider` (`src/server/billing/providers/toss.ts`)
  implementing the existing `BillingProvider` interface unchanged,
  `BILLING_PROVIDER=mock|toss` (`src/lib/env/server.ts`, documented in
  `.env.example`), a low-level `TossApiClient`
  (`src/server/billing/providers/toss-api.ts`, Basic-auth + idempotency-key
  headers, `TossApiError` classification), a server-only
  `billing_checkout_sessions` table (`0017_billing_checkout_sessions.sql`,
  RLS enabled with **no** authenticated-user policy — matching Day 2's
  "read via RLS, write via service role" pattern used for
  `integration_connections`) and its CRUD layer
  (`src/server/billing/checkout-sessions.ts`), and the full UI-side flow
  (`src/app/(app)/billing/`, `src/components/billing/`,
  `src/app/api/billing/`) — all already using `plans.ts` for pricing,
  already storing `billingKey`/`paymentKey` server-side only, and already
  distinguishing a user cancellation (`PAY_PROCESS_CANCELED` →
  `markCheckoutCanceled()`) from a genuine payment failure
  (`markCheckoutFailed()`) in `/api/billing/toss/fail/route.ts`. All four
  DoD criteria were substantively met by the existing code.
- Found and closed the one real gap: **zero test coverage over the actual
  billing flow.** Only the low-level `TossApiClient` had tests
  (`toss-api.test.ts`, pre-existing) — `TossBillingProvider` itself,
  `MockBillingProvider`, and the `checkout-sessions.ts` state-machine layer
  they both sit on had none, despite being exactly the kind of
  money-adjacent logic this Day's own DoD says must be "covered by tests."
  Added three new suites instead of rebuilding the implementation:
  - `src/server/billing/checkout-sessions.test.ts` (19 cases) — the
    `claimCheckoutSession()` state machine (PENDING→PROCESSING, idempotent
    on already-SUCCEEDED, rejects PROCESSING/CANCELED/expired, and a
    concurrent-claim race caught at the DB `.in(status, [...])` update
    itself), `activateSubscription()`'s upsert payload (one-month period,
    only the opaque session id stored, never a raw Toss key),
    `markCheckoutFailed()`'s 500-char message truncation, and
    `getLatestSuccessfulCheckout()`.
  - `src/server/billing/providers/toss.test.ts` (15 cases) — fail-closed
    on a missing `TOSS_SECRET_KEY` (asserted it never falls back to mock
    and never creates a session), the full success path (issues a billing
    key, charges exactly `getPlanConfig(plan).priceMonthlyKrw`, verifies
    Toss's response echoes the same orderId/amount/`status=DONE`,
    activates the subscription), reusing an already-issued billing key on
    a retried callback instead of re-issuing, a billing-key
    customer-key mismatch, a payment-verification mismatch, a declined-card
    `TossApiError` and a network failure each propagating and marking the
    checkout `FAILED` with the provider's own code (never silently
    retrying a possible charge), `cancelSubscription()`'s best-effort
    billing-key deletion (cancels locally even when the Toss delete call
    fails; skips the call entirely when no billing key was ever issued),
    and `handleWebhook()`'s documented no-op.
  - `src/server/billing/providers/mock.test.ts` (6 cases) — checkout
    creation, idempotent-on-already-succeeded completion, a failed
    `activateSubscription()` call marking the checkout failed and
    rethrowing, cancellation, and `handleWebhook()` rejecting an
    unauthenticated external call (mock completion is only reachable
    through the authenticated `completeCheckout()` path).
- Documentation was the other real gap: `docs/ARCHITECTURE.md`'s "Billing
  Flow" section still described the pre-Toss design (a single generic
  webhook-driven completion), which no longer matched either provider's
  actual code path. Rewrote it to describe the real flow — `createCheckout()`
  → provider-hosted/in-app auth → an authenticated GET callback (not the
  webhook route) → `completeCheckout()`'s claim → issue/charge →
  verify → activate sequence — and added explicit subsections on why
  `handleWebhook()` is a no-op for both providers today, the
  cancellation-vs-failure distinction, and where secrets live (server-only
  env vars, `billing_checkout_sessions`' RLS-free table, never the client
  bundle or the RLS-readable `subscriptions` row). Added
  `billing_checkout_sessions` to the "Database Overview" table list, which
  had been missing it since Day 2/Day 7's equivalent entries were added for
  their own new tables.
- Did not touch `src/app/`, `src/components/`, `src/server/directory/`, or
  `src/server/customer-support/` — the existing UI flow needed no changes
  to satisfy this Day's DoD.
- Did not add a new migration: `0017_billing_checkout_sessions.sql`
  already existed with correct RLS (reviewed, not modified) from the
  earlier teammate commit; Day 10's safety rules only require a new
  migration when schema actually needs to change.

Tests:
- lint: pass (`npm run lint`)
- typecheck: pass (`npm run typecheck`)
- test: pass, 351/351 (`npm test`, includes 40 new Day 10 tests: 19
  checkout-sessions + 15 TossBillingProvider + 6 MockBillingProvider)
- build: pass (`npm run build`) — required a fresh `npm ci` (this
  session's container had no `node_modules/` at all; installed cleanly
  with 0 vulnerabilities) and the same local-only `.env.local` placeholder
  values as prior Days to get past static page collection; not committed
  (gitignored).

Blocked External:
- TOSS_SECRET_KEY / NEXT_PUBLIC_TOSS_CLIENT_KEY — see "Blocked External"
  above for detail.

Commit:
- (see git log for this file's commit)

Push:
- origin/main
