# Architecture

## System Overview

단일 Next.js (App Router) 레포지토리 + Supabase. 프론트엔드/백엔드를 분리하지 않고, `src/app`(라우트·UI)과 `src/server`(도메인 로직)의 경계로 관심사를 분리합니다.

```
Browser
  │
  ▼
Next.js (Vercel)
  ├─ src/app/(public)   marketing pages, no auth
  ├─ src/app/(auth)     login / signup
  ├─ src/app/(app)      dashboard, automations, business, billing, settings — auth required
  ├─ src/app/api        webhooks, cron entrypoint (external callers only)
  └─ src/server         AI / automations / connectors / billing / directory / customer-support
                              │
                              ▼
                        Supabase (Postgres + Auth + RLS)
                              ▲
                              │ (thin trigger, no logic)
                  supabase/functions/run-due-automations (Deno, cron)
```

## Domain Boundaries

| Domain | Owner (Section 12) | Location |
|---|---|---|
| AI provider abstraction, prompts | Dev1 | `src/server/ai/` |
| Automation runner, scheduler, handlers | Dev1 | `src/server/automations/` |
| Platform connectors (WordPress, Instagram, Email, YouTube) | Dev1 | `src/server/connectors/` |
| Billing provider, plans, entitlements | Dev1 | `src/server/billing/` |
| Deployment, env config, Supabase functions | Dev1 | `Dockerfile`, `.github/workflows/`, `.env.example`, `supabase/functions/` |
| Routes, pages, UI components | Dev2 | `src/app/`, `src/components/` |
| AI Tool Directory, Guides, Customer Support | Dev3 | `src/server/directory/`, `src/server/customer-support/` |
| Shared types, Supabase clients, migrations | Shared (all) | `src/types/`, `src/lib/`, `supabase/migrations/` |

Business logic never lives inside a UI component — pages/components call a Server Action or a `src/server/` function, never Supabase or an external API directly for anything beyond simple authenticated reads scoped by RLS.

## Request Flow (typical page)

1. A Server Component under `src/app/(app)/...` calls `createClient()` from `src/lib/supabase/server.ts` (RLS-scoped, acts as the signed-in user).
2. Reads are safe to do directly with that client (RLS guarantees the user only sees their own rows).
3. Writes go through a colocated `actions.ts` (`"use server"`), which re-checks entitlements (`src/server/billing/entitlements.ts`) before mutating — the UI hiding a button is never the only guard.
4. `src/proxy.ts` (Next's Proxy/Middleware convention) refreshes the Supabase session cookie on every request and redirects unauthenticated users away from protected routes before any Server Component runs.

## Automation Flow

```
Scheduler (cron, every few minutes)
    │  findDueAutomations() — one query, not one job per automation
    ▼
Automation Runner (src/server/automations/runner.ts)
    │  loads automation + business + template (service-role client)
    │  refuses a PAUSED/ERROR automation or one over its plan limit
    │  guards against duplicate in-flight runs
    ▼
Automation Handler (src/server/automations/handlers/<slug>.ts)
    │  builds a prompt, calls src/server/ai/generate.ts (provider-agnostic)
    ▼
Platform Connector (src/server/connectors/<platform>/, optional)
    │  publishes if configured, else content stays in content_history only
    ▼
automation_runs + content_history persisted, usage counters incremented,
automations.next_run_at recomputed (cron path only — manual "Run Now" does not
touch the schedule)
```

Two entry points into the same `executeAutomation()` core:

- **Manual**: dashboard "Run Now" button → `triggerRunNow()` Server Action → `runAutomationNow()`. Does not advance `next_run_at`.
- **Scheduled**: Supabase Edge Function (`supabase/functions/run-due-automations`, thin cron trigger) → `POST /api/cron/run-automations` (secret-protected) → `findDueAutomations()` → `runDueAutomation()` for each. Advances `next_run_at` via `computeNextRunAt()`.

A handler only implements "what does this automation actually do" — loading context, persisting results, and duplicate-run protection are the runner's job, shared by every automation type. AI generation (`src/server/ai/`) and platform publishing (`src/server/connectors/`) never call each other directly; a handler orchestrates both.

### Runner Reliability (Day 5)

`executeAutomation()` is the single internal function both `runAutomationNow()` and `runDueAutomation()` call — every guard below applies identically to a manual click and a cron tick, instead of being re-implemented (and potentially missed) at each entry point:

- **Status gate.** A `PAUSED` or `ERROR` automation is refused before the handler ever runs. `findDueAutomations()` already only selects `ACTIVE` automations, so this mainly protects the manual "Run Now" path and closes a race where an automation flips status between being read and actually executing.
- **Entitlement gate.** `canExecuteAutomation()` (`src/server/billing/entitlements.ts`) is re-checked inside the runner itself — not only in the `triggerRunNow()` Server Action — so the cron path is covered too, not just manual runs initiated through the UI.
- **Refused runs are recorded, not silently dropped.** Both gates above insert an already-`FAILED` `automation_runs` row with a human-readable `error_message` (`recordRefusedRun()`), so a refusal shows up in run history like any other outcome instead of vanishing as a no-op. Neither gate touches `automations.status` — being paused or over a plan limit isn't itself a new failure.
- **No retry-storm on a recurring refusal.** If a `SCHEDULED` run is refused for a reason that can repeat on the very next tick (a plan limit — a paused/error automation is already excluded from the due query), `next_run_at` is advanced immediately so the cron loop waits for the next legitimately due slot instead of re-attempting and re-refusing every few minutes.
- **Every status-transition write is error-checked.** The Supabase client resolves a failed query with `{ error }` rather than throwing; `executeAutomation()` explicitly checks and re-throws on every write that transitions a run's lifecycle (marking `SUCCESS`, writing `content_history`, advancing `next_run_at`) so a silently swallowed DB error can never leave a run's `automation_runs` row out of sync with reality, and can never leave it stuck `RUNNING` because the one write meant to close it out failed unnoticed. The final `FAILED`/`ERROR` writes inside the `catch` block are themselves error-checked too (logged as `automation_run_terminal_write_failed` if even that fails) — there is nothing further to safely retry inside the same request, so this is best-effort observability, not a guarantee.
- **`source: "MANUAL" | "SCHEDULED"`** (new column, `0016_automation_run_source.sql`) is stamped on every `automation_runs` row at creation, including refused ones — the one place to answer "was this a dashboard click or a cron tick" without inferring it from `started_at`/`next_run_at` heuristics.
- **On a genuine handler failure**, the automation still flips to `ERROR` (unchanged from before this Day) — a stronger guarantee against a retry storm than merely advancing `next_run_at`, since `findDueAutomations()` only ever selects `status = 'ACTIVE'` and reactivating always recomputes a fresh `next_run_at` anyway.

Tests: `src/server/automations/runner.test.ts` — source tagging on both entry points, `next_run_at` advancing only for a scheduled success (never for manual), refusal on `PAUSED`/`ERROR`/entitlement-denied without calling the handler, the duplicate-run guard for both a manual double-click and a concurrent scheduled tick, an unanticipated handler exception being caught and terminating the run as `FAILED`/the automation as `ERROR`, and a DB write failure on the SUCCESS-marking update itself still resulting in `FAILED` rather than a stuck `RUNNING` row.

`blog-marketing` (WordPress) and, as of Day 7, `newsletter` (Resend) have working handlers + connectors end to end — the other three templates still have handler/connector interfaces in place that throw "not implemented yet". `AUTOMATION_AVAILABILITY` in `src/types/automation.ts` is the single source of truth the UI reads to show Available/Beta/Coming Soon and to gate what the creation wizard offers; `newsletter` is deliberately left `COMING_SOON` there even though the backend is complete — flipping it is a UI/product decision (a subscriber-list management page doesn't exist yet) left for Dev2, same as Day 3 left WordPress's setup-wizard rewiring to Dev2.

### Production Scheduler (Day 6)

`findDueAutomations()` (`src/server/automations/scheduler.ts`) selects only `status = 'ACTIVE'` automations with `next_run_at <= now()`, backed by a partial index (`automations_due_idx`, `0005_automations.sql`) on exactly that predicate. `next_run_at`/`last_run_at` are `timestamptz` columns and every comparison uses `new Date().toISOString()` (UTC) — `computeNextRunAt()` is the only place a schedule's Asia/Seoul (or other IANA) `timeOfDay` gets converted to/from a UTC instant (`src/lib/utils/date.ts#zonedTimeToUtc`); nothing else in the scheduler path touches wall-clock time.

**`next_run_at` now advances at run START, not completion.** Before this Day, `executeAutomation()` only wrote the next `next_run_at` after the handler finished successfully. Since `findDueAutomations()` re-polls on a fixed interval independent of how long a run takes, a slow run left the automation "due" (old, already-past `next_run_at`, still `ACTIVE`) for every tick until it finished — each of those ticks would reach the in-flight guard and get rejected there instead of not seeing the automation as due at all. The schedule is now advanced immediately after the `RUNNING` row is inserted, before the handler is even invoked (still inside the same `try` Day 5 already wrapped everything in — a failure to advance it is caught exactly like any other lifecycle-write failure, marking the run `FAILED`/automation `ERROR`). `last_run_at` still only updates on completion, since it genuinely means "the last time this finished".

**Concurrent-tick safety is two layers, both verified by tests.** The app-level check (`SELECT ... WHERE status IN ('QUEUED','RUNNING')` before inserting) is a check-then-act race on its own — two near-simultaneous ticks could both read "no in-flight run" before either has inserted. The actual backstop is the DB partial unique index `automation_runs_one_inflight_idx` (`0006_automation_runs.sql`): the losing INSERT fails with a unique-violation error, which propagates out of `executeAutomation()` before the handler is ever called (mirrored in `runner.test.ts` by asserting a bare app-level in-flight hit *and*, separately, a DB unique-violation error on insert both result in "handler never called").

**Cron auth was a real deployment gap, now fixed.** `POST /api/cron/run-automations` (`src/app/api/cron/run-automations/route.ts`) already rejected a missing/mismatched `x-cron-secret` header before calling `findDueAutomations()` — that was correct from the start. But the *first* hop — `pg_cron` (`0014_scheduler_cron.sql`) calling the Supabase Edge Function `run-due-automations` via `net.http_post()` — sent no `Authorization` header at all. Supabase Edge Functions reject unauthenticated requests by default (`verify_jwt`), so in a real deployment the cron trigger could never fire even once; this was invisible in this environment because there is no live Supabase project to smoke-test pg_cron against. `0018_scheduler_cron_auth.sql` reschedules the same job with `Authorization: Bearer <service_role_key>`, the key read at execution time from a database-level setting (`current_setting('app.settings.service_role_key', true)`) rather than committed to git — see README.md "Deployment" for the one-time `alter database ... set` step. The Edge Function itself stays exactly as thin as before: it still only exists to forward `CRON_SECRET` to the Next.js route, which remains the actual authorization boundary for running automations.

Tests: `src/server/automations/scheduler.test.ts` (year/month-boundary rollovers for DAILY and WEEKLY schedules in the default Asia/Seoul timezone — no DST there, so no gap/ambiguous-time cases exist on the production path; two documentation-only tests lock in `zonedTimeToUtc`'s current gap/ambiguous-time resolution for a DST-observing timezone, since `AutomationSchedule.timezone` is a generic IANA field even though the product only schedules in KST today). `src/server/automations/runner.test.ts` — `next_run_at` provably advances before the handler is invoked (asserted from inside the mocked handler itself), and the two concurrent-tick cases above.

### Newsletter Automation & Resend Connector (Day 7)

The second real automation vertical, alongside blog: `subscribers` (new
migration `0026_subscribers.sql`) → `NewsletterAutomationHandler`
(`src/server/automations/handlers/newsletter.ts`) → `ResendConnector`
(`src/server/connectors/email/resend.ts`).

- **`subscribers` table.** `business_id`, `email`, `name`, `status`
  (`ACTIVE`/`UNSUBSCRIBED`), `subscribed_at`/`unsubscribed_at`. Unique on
  `(business_id, email)` so re-subscribing the same address updates the
  existing row instead of duplicating it. RLS follows `business_faqs`'
  pattern exactly (`0022_business_faqs.sql`): every policy re-checks
  `businesses.owner_id = auth.uid()` via a subquery, full CRUD for the
  owner. The newsletter handler itself always reads through the
  service-role client (`listActiveSubscribers()`,
  `src/server/connectors/email/subscribers.ts`) and bypasses RLS
  entirely — these policies exist for a future owner-facing subscriber
  management page (not built this Day; out of scope, see below).
- **`EmailConnector` interface** (`src/server/connectors/email/provider.ts`)
  mirrors the `AIProvider`/`BillingProvider` pattern — vendor-neutral,
  `isConfigured()` + `send(params)` for one recipient at a time — and is
  deliberately not `PlatformConnector`: that interface publishes one piece
  of content to one external account (WordPress, Instagram), while a
  newsletter send is one email per subscriber, a different shape.
  `ResendConnector` is the only implementation. `RESEND_API_KEY`/
  `RESEND_FROM_EMAIL` stay server-only (`src/lib/env/server.ts`, already
  documented in `.env.example` from before this Day).
- **Idempotent sends.** Every `send()` call carries an `Idempotency-Key`
  header derived from `${automation_runs.id}:${subscriber.id}` (added to
  `AutomationRunContext` as `runId`, threaded through by `runner.ts` —
  see `types/automation.ts`). Resend dedupes a repeated request carrying
  the same key instead of delivering twice, which is what makes
  `ResendConnector`'s own bounded one-retry-on-transient-failure loop
  (mirroring `src/server/ai/http.ts`'s shape, scoped to `ConnectorError`)
  safe — a retried attempt for the same run + recipient can't double-send.
  The key is stable across a re-invocation of the *same* run (verified by
  a test calling the handler twice with the same `runId`); a fresh manual
  "Run Now" gets a new `automation_runs` row and therefore a new key by
  design — that's a deliberate new send, not a retry.
- **Per-recipient vs. systemic failure.** A per-recipient failure
  (`UPSTREAM_CLIENT_ERROR` — e.g. a malformed address, `TIMEOUT`/
  `NETWORK_FAILURE`/`UPSTREAM_SERVER_ERROR` already exhausted their own
  retry) is recorded and the loop continues to the next subscriber. A
  systemic failure (`AUTH_FAILED`/`PERMISSION_DENIED`/`NOT_CONFIGURED` —
  every remaining send would fail identically) aborts the whole run
  immediately instead of burning through the rest of the list, and
  propagates so the runner marks the run `FAILED`.
- **Per-run counts persisted on `automation_runs.output`**: `subject`,
  `previewText`, `totalSubscribers`, `successCount`, `failureCount`,
  `messageIds` (Resend's own per-send id), and `failures` (subscriber id +
  email + error message for anything that didn't send) — same shape
  philosophy as blog.ts's unified output object.
- **Subject dedup reuses Day 4's `isNearDuplicateTopic()`** the same way
  `blog.ts#generateTopic()` does: regenerate once (never a loop) if the
  first subject is a near-duplicate of a recently sent one
  (`content_history.topic` for this automation), then accept whatever
  comes back regardless of its own similarity.
- **`stripHtml()`** (rendering the generated HTML body down to
  `content_history.content`'s plain-text convention) was extracted from
  `blog.ts` into `src/server/shared/html.ts` once newsletter became a
  second real call site (Rule 10). **`classifyHttpStatus()`** (HTTP status →
  `ConnectorError` code) was likewise extracted from
  `wordpress/index.ts` into `src/server/shared/errors.ts` for the same
  reason — both connectors now share it.
- **Out of scope this Day, left for Dev2**: an owner-facing subscriber
  list/import/unsubscribe management page — `src/app/`/`src/components/`
  are UI-owned directories this routine's safety rules don't touch beyond
  the minimum needed to keep the build compiling. `listActiveSubscribers()`
  and the RLS policies above are ready for that page to be built against.

Tests: `src/server/connectors/email/resend.test.ts` +
`resend.send.test.ts` (not-configured, send success incl. exact request
body/headers, 401/422 never retried, a single 5xx retried once and
succeeding, repeated 5xx exhausting the bound, network failure, timeout).
`src/server/automations/handlers/newsletter.test.ts` (only ACTIVE
subscribers reached, per-run success/failure counts, a stable idempotency
key derived from `runId` + subscriber id — including across two calls with
the same `runId` — partial failure continuing the loop, a systemic failure
aborting it, not-configured failing before any generation/send, zero
subscribers still succeeding, and the near-duplicate-subject regeneration
path). `src/server/automations/runner.test.ts` gained an assertion that
the handler receives `runId`.

### Instagram Professional Account Connection (Day 8)

A `feature/directory-cs` merge (2026-09-26, before this Day started) had
already landed a working Meta OAuth flow — `src/server/connectors/
instagram/oauth.ts`, `src/app/api/integrations/instagram/{connect,
callback}/route.ts`, and the Settings page's "Connect Instagram"/disconnect
UI (`src/components/settings/integration-settings.tsx`). Per this routine's
own rule 1 ("search before creating a new file... verify against the
Definition of Done before rebuilding"), this Day verified that flow against
Day 8's DoD instead of re-implementing it, and closed the two real gaps
found:

1. **No tests covering the actual OAuth orchestration** — only
   `oauth.ts`'s three low-level helpers (`buildInstagramAuthorizationUrl`/
   `exchangeInstagramCode`/`getInstagramProfile`) had unit tests; the state
   generation, CSRF cookie packing, constant-time state comparison, and the
   exchange → professional-check → persist-or-mark-ERROR orchestration all
   lived inline in the two Next.js route handlers, untestable without
   mocking `NextRequest`/`NextResponse` — a pattern this repo doesn't use
   anywhere else (the cron route, WordPress, and newsletter are all tested
   by testing their `src/server/` functions directly, never the route
   layer). Extracted that orchestration into a new
   `src/server/connectors/instagram/connect.ts` (mirroring Day 3's
   `wordpress/connect.ts` bridge):
   ```
   src/server/connectors/instagram/connect.ts (server-only)
       startInstagramOAuth()       — fresh CSRF state + Meta authorization URL
                                      + the packed OAuth cookie value
       parseInstagramOAuthCookie() — unpacks/validates the cookie back to {state, businessId}
       isMatchingOAuthState()      — constant-time state comparison (timingSafeEqual)
       completeInstagramOAuth()    — code exchange -> professional-account check
                                      -> createConnection() (Vault-backed, Day 2) on
                                      success; any failure marks a pre-existing
                                      connection for this business ERROR via
                                      updateConnectionStatus(), never silently
                                      leaves it looking CONNECTED
   ```
   Both route handlers were reduced to thin wrappers around this module —
   same URLs, same cookie name/path/maxAge, same `?instagram=<result>`
   query-param contract the Settings page already reads, so this is a
   mechanical extraction, not a redesign. `connect.test.ts` (10 cases)
   covers state round-tripping, a malformed/incomplete cookie, state
   mismatch, the success path (mocked Instagram API responses via a
   stubbed `fetch`, asserting the exact `createConnection()` payload —
   secret never touches the row itself, only Vault), a personal account
   being rejected without persisting anything, a failed code exchange and
   a failed profile fetch each marking a pre-existing connection `ERROR`,
   and the no-pre-existing-connection / lookup-itself-fails cases never
   throwing out of `completeInstagramOAuth()`.
2. **Inconsistent error handling** — `oauth.ts`'s three Graph/Instagram API
   calls threw a bare `Error` on a non-2xx response and let a raw
   network/timeout exception propagate unclassified, unlike every other
   connector (WordPress, Resend) which throws `ConnectorError` via the
   shared `classifyHttpStatus()` taxonomy (`src/server/shared/errors.ts`).
   Fixed by routing all three calls through one `fetchJson()` helper that
   classifies a non-2xx response (`classifyHttpStatus`), a timed-out
   request (`AbortSignal.timeout(12_000)` rejecting with a `TimeoutError`
   `DOMException` → `TIMEOUT`), and a raw network failure (→
   `NETWORK_FAILURE`) the same way `WordPressConnector`/`ResendConnector`
   do — 6 new test cases in `oauth.test.ts` lock in the classification
   (`AUTH_FAILED`/`PERMISSION_DENIED`/`UPSTREAM_SERVER_ERROR`/
   `NETWORK_FAILURE`/`TIMEOUT`, plus an incomplete-profile-on-HTTP-200
   case).

**Already satisfied, verified rather than rebuilt:**
`buildInstagramAuthorizationUrl()` requests
`instagram_business_basic,instagram_business_content_publish` (current
Meta scopes for Instagram Login for Professional accounts);
`exchangeInstagramCode()` upgrades the short-lived token to a long-lived
one and never returns the short-lived token to the caller;
`isProfessionalInstagramAccount()` accepts only `BUSINESS`/`CREATOR`/
`MEDIA_CREATOR`, rejecting `PERSONAL` with a distinct `professional_
required` result the Settings page surfaces as a clear message (never
silently connected as if supported); the callback route distinguishes
`state_error` (CSRF mismatch), `denied` (the user declined **or** Meta
returned an `error` query param — both mean "no code to exchange"),
`invalid_business` (the state's business isn't owned by the signed-in
user), `not_configured` (no `INSTAGRAM_APP_ID`/`SECRET`), `professional_
required`, `connected`, and a generic `error` for anything else — each a
distinct, user-visible outcome, never a single undifferentiated failure;
the access token is stored exclusively through Day 2's
`createConnection()` (Vault `secret_reference`), never in a plaintext
column; `disconnectIntegration()` (`src/app/(app)/settings/actions.ts`,
already generic across every provider) and the account-expiry display
(`integration-settings.tsx#displayStatus()`, comparing the stored
`expiresAt` metadata against `Date.now()`) both already worked for
Instagram with no change needed.

**Deliberately out of scope this Day (Day 9's territory):** actively
detecting a *stored* token going bad — e.g. the user revokes access on
Meta's side without ever visiting this app's Settings page again — needs a
live Graph API call with that token, which nothing calls yet
(`InstagramConnector.publish()`, `src/server/connectors/instagram/
index.ts`, is still the Day 9 placeholder that throws "not implemented").
When Day 9 adds the real publish call and it gets a `ConnectorError` with
`AUTH_FAILED`/`PERMISSION_DENIED` from Meta, it should call Day 2's
`updateConnectionStatus(admin, connection.id, "ERROR")` — the helper
already exists and needs no changes; there is deliberately no speculative
polling/health-check job added here with no caller yet (project rule 10).

Tests: `src/server/connectors/instagram/oauth.test.ts` (10 cases, 6 new —
see above). `src/server/connectors/instagram/connect.test.ts` (10 cases,
new file — see above). Did not touch `src/server/connectors/instagram/
index.ts` (the Day 9 `PlatformConnector` placeholder), `src/server/
directory/`, or `src/server/customer-support/`; touched `src/app/api/
integrations/instagram/{connect,callback}/route.ts` only to the minimum
needed to delegate to the new `src/server/` module (no URL/behavior/UI
change) — `src/components/settings/integration-settings.tsx` and
`src/app/(app)/settings/actions.ts` needed no change at all.

### Instagram Publishing (Day 9)

Replaces `InstagramConnector.publish()`'s Day 8 placeholder (which threw
"not implemented yet") with a real single-image Content Publishing flow,
wired into the same `AutomationRunner` core every other handler uses.

```
src/server/ai/prompts/instagram.ts      buildInstagramCaptionPrompt() + instagramCaptionSchema
                                         { topic, caption, hashtags[] } — generateStructured()
                                         only, per Day 1's constraint (never a vendor SDK).

src/server/connectors/instagram/
  assets/marketing-card.ts              base64 PNG constant (see below)
  media.ts                              ensureMarketingCardImageUrl() — Storage upload/lookup
  index.ts#InstagramConnector.publish() container-create -> status-poll -> media_publish
  connect.ts#loadInstagramConnector()   business's Vault-backed connection -> InstagramConnector

src/server/automations/handlers/instagram.ts
  instagramAutomationHandler            generateCaption() -> ensureMarketingCardImageUrl()
                                         -> connector.publish() -> persists mediaId
```

**MVP media — a single static marketing-card image, not per-post
rendering.** The roadmap's own wording ("a single static marketing-card
image") is taken literally: every Instagram post this handler makes uses
the *exact same* image; per-post differentiation comes entirely from the
AI-generated caption/hashtags, not from dynamically composing text into a
picture. This sidesteps a real constraint — the repo has no image-rendering
or raster-graphics library (`package.json` was checked first, per project
rule 2/3; the closest thing, `lucide-react`, is UI icons, not a server-side
renderer), and the roadmap explicitly forbids adding one for this Day. The
image itself — a 1080x1080 RGB PNG, a vertical indigo→teal brand gradient
with a dark band along the bottom edge — was generated once with a small
standalone Python script using only `zlib`/`struct` (both stdlib; the
script is not part of the app or its dependency tree, exactly like a
designer handing over a finished asset) and embedded as a base64 string
constant in `assets/marketing-card.ts` rather than read from disk at
request time: a Netlify serverless function's deployment doesn't reliably
include arbitrary repo files outside Next.js's own file-tracing, so a
string literal is the only form guaranteed to survive every deploy target.

**Storage.** `ensureMarketingCardImageUrl()` (`media.ts`) uploads that PNG
to a new public Supabase Storage bucket, `marketing-assets` (migration
`0027_instagram_marketing_assets_bucket.sql` — `storage.buckets` insert +
a `storage.objects` RLS policy granting public `select` only; writes stay
service-role-only, matching every other table's write pattern in this
repo), so Meta's Graph API can fetch it by URL with no auth of its own. It
checks for the object first and only uploads when missing — self-healing if
the bucket is ever emptied, without re-uploading the same bytes on every
run.

**Publish sequence** (`InstagramConnector.publish()`, mirrors
`WordPressConnector`'s constructor shape — an explicit
`{ accessToken, igUserId }` from `loadInstagramConnector()` takes priority,
falling back to the legacy env-configured single-account path
(`META_ACCESS_TOKEN`/`META_IG_USER_ID`) when a business has no shared
connection):
1. `POST /{ig-user-id}/media` with `image_url` + `caption` → a creation id.
2. Poll `GET /{creation-id}?fields=status_code` up to 5 times (bounded —
   never unbounded, Rule 29) until `FINISHED`; `ERROR`/`EXPIRED` fails
   immediately, exhausting the bound without `FINISHED` throws `TIMEOUT`
   ("stuck"). A single static image is normally processed near-instantly,
   but Meta's API contract still requires checking status before
   `media_publish` rather than assuming it.
3. `POST /{ig-user-id}/media_publish` with the creation id → the published
   media id, persisted on `automation_runs.output.mediaId` (alongside
   `topic`/`caption`/`hashtags`/`imageUrl`) via the runner's existing
   `result.output` write — no runner change needed.

Every non-2xx response, timeout, and raw network failure is classified
through the same `ConnectorError`/`classifyHttpStatus()` taxonomy every
other connector uses (`src/server/shared/errors.ts`) — this Day's own
mocked-HTTP tests cover all three named failure modes (container creation
failure, stuck/failed status, publish failure) plus timeout/network/
not-configured/missing-image-url. A publish failure classified
`AUTH_FAILED`/`PERMISSION_DENIED` — a stored token Meta has since
revoked — calls Day 2's `updateConnectionStatus(admin, connection.id,
"EXPIRED")`; any other failure marks it `ERROR`; this closes the item Day
8 explicitly deferred ("detecting a *stored* token going bad needs a live
Graph API call, which nothing calls yet").

**Availability.** `AUTOMATION_AVAILABILITY["instagram-marketing"]` flipped
`COMING_SOON` → `BETA` (`src/types/automation.ts`) — the same const
comment's own rule ("update this the same release a handler stops throwing
'not implemented yet'"). No new automation-creation wizard was needed: the
generic `AutomationForm` (used by every non-blog template already) needs no
per-automation config for this handler, since the image is fixed and the
connection comes from Settings (Day 8's UI, unchanged). A user who enables
this automation without ever connecting Instagram in Settings gets the
same graceful-degradation UX WordPress's legacy path already has: the
handler throws a clear Korean message the runner records on the run, not a
broken page.

**Out of scope this Day (by the roadmap's own instruction):** carousels
and Reels — single static image only.

Tests: `src/server/connectors/instagram/index.test.ts` (12 cases, new —
full container→status→publish success, IN_PROGRESS polling to FINISHED,
container-creation failure, an ERROR status_code, a stuck-IN_PROGRESS
timeout after exactly the bounded attempt count, a `media_publish`
failure, missing `imageUrl`, not-configured, timeout, network failure).
`src/server/connectors/instagram/media.test.ts` (5 cases, new — uploads
when missing, skips upload when already present, and classifies a list/
upload/missing-public-URL failure). `src/server/connectors/instagram/
connect.test.ts` gained a `loadInstagramConnector` suite (5 cases,
mirroring `wordpress/connect.test.ts#loadWordPressConnector`'s four
branches plus a missing-`accountId`-metadata case).
`src/server/automations/handlers/instagram.test.ts` (10 cases, new) — the
shared-connection and legacy-env-fallback paths, a CONNECTED-but-unusable
connection marked `ERROR` without ever calling the AI/connector, an
`AUTH_FAILED` publish failure marking the connection `EXPIRED` vs. any
other failure marking it `ERROR`, the regenerate-once-on-near-duplicate
topic pattern (same bounded-once rule as blog.ts/newsletter.ts), and both
a caption-generation failure and a marketing-card-upload failure
propagating without ever calling `publish()`.

Did not touch `src/app/`, `src/components/`, `src/server/directory/`, or
`src/server/customer-support/` — `AUTOMATION_AVAILABILITY` lives in
`src/types/automation.ts` (a shared domain type, not a UI file), and the
existing `AutomationForm`/marketplace UI already reads it generically.

## Shared Error Handling & Logging

Every server domain reports failures through `src/server/shared/errors.ts`
instead of throwing a bare `Error`:

- `AppError(domain, code, message)` — the common base. `.domain` names the
  subsystem (an AI provider name, a connector name, ...), `.code` is a
  short machine-readable reason, `.retryable` says whether the runner/caller
  may safely retry it.
- `AIProviderError` (`src/server/ai/errors.ts`) and `ConnectorError` (used by
  platform connectors, e.g. `src/server/connectors/wordpress/`) both extend
  it — a caller can `isAppError(err)` and log `{ domain, code, retryable }`
  the same way regardless of which domain failed.
- `src/server/automations/runner.ts` logs this structured info on every
  failed run (`logger.error("automation_run_failed", { errorDomain,
  errorCode, ... })`) in addition to the human-readable message.
- `describeAutomationRunError()` (same file) is the one place a raw
  `automation_runs.error_message` string gets turned into a Korean,
  secret-free explanation for the dashboard — every page that shows a run's
  failure reason calls this instead of re-implementing its own mapping.

`src/lib/logger` (`info`/`warn`/`error`, structured JSON) is the only
logging entry point across the codebase — no domain calls `console.*`
directly.

## WordPress Connector

`src/server/connectors/wordpress/index.ts`'s `WordPressConnector` talks to a
site's REST API (`/wp-json/wp/v2/users/me` to verify, `/wp-json/wp/v2/posts`
to publish) over raw `node:https` rather than `fetch`, so it can pin the TLS
connection to a DNS-validated address:

- **SSRF guard.** `normalizeWordPressSiteUrl()` rejects anything that isn't a
  plain `https://host/path` (no port/credentials/query/fragment, no literal
  IP, no `localhost`/`.local`/`.internal`). `publicHostAddress()` then
  resolves the hostname and rejects a result with no addresses or any
  private/link-local/loopback/CGNAT address (`ConnectorError` `INVALID_TARGET`
  either way — including a DNS lookup that fails outright, e.g. `ENOTFOUND`).
  The resolved address is pinned into the actual request's `lookup` option so
  a second DNS answer between validation and connection can't retarget the
  request to a private host (DNS-rebinding).
- **Failure classification.** Every failure — HTTP status, timeout, and raw
  transport error — becomes a `ConnectorError` with one of `NOT_CONFIGURED`,
  `INVALID_TARGET`, `AUTH_FAILED` (401), `PERMISSION_DENIED` (403),
  `UPSTREAM_CLIENT_ERROR` (other 4xx), `UPSTREAM_SERVER_ERROR` (5xx),
  `TIMEOUT` (12s request timeout), or `NETWORK_FAILURE` (connection-level
  error, or a response body over the 1MB cap) — never a bare `Error`, so
  `runner.ts`/`describeAutomationRunError()` can classify it precisely
  instead of string-matching. Publish requests are never retried — retrying
  a `POST /wp-json/wp/v2/posts` on a timeout risks creating a duplicate post.
- **Verify-then-persist.** `connect.ts#verifyAndConnectWordPress()` is the
  Day 2/Day 3 bridge: it calls `testConnection()` first and only calls
  `createConnection()` (persisting a `CONNECTED` row, Application Password in
  Vault) once that succeeds — a bad credential never gets written as
  "connected."

## AI Provider Reliability

`src/server/ai/` exposes `generateText()` / `generateStructured()` — automation
handlers never touch a vendor SDK or fetch call directly. The real adapters
(`providers/openai.ts`, `providers/gemini.ts`) share one HTTP layer
(`src/server/ai/http.ts`) that:

- enforces a per-request timeout (`AI_REQUEST_TIMEOUT_MS`, default 30s),
- classifies every failure into `AIErrorCode` (`src/server/ai/errors.ts`):
  `MISSING_API_KEY`, `TIMEOUT`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`,
  `INVALID_STRUCTURED_RESPONSE`, `NETWORK_FAILURE`,
- retries only the transient codes (timeout/429/5xx/network) up to
  `AI_MAX_RETRIES` (default 2) with exponential backoff — auth/validation
  failures never retry, and retries are always bounded, never infinite.

`generateStructured()` layers JSON-schema (zod) validation on top and retries
at most once if the model's response doesn't parse or validate, throwing
`AIProviderError("INVALID_STRUCTURED_RESPONSE", ...)` if it still fails.

## Blog AI Pipeline (Day 4)

`src/server/automations/handlers/blog.ts` runs a two-stage pipeline instead
of one single-shot generation:

- **Stage 1 — topic.** `buildBlogTopicPrompt()` (`src/server/ai/prompts/blog.ts`)
  asks for just `{ topic, title }` (cheap, small `maxTokens`), fed with the
  business's `name`/`industry`/`location`/`description`/`target_customer`/
  `brand_tone`/`keywords` plus the automation's own `objective`/`tone`/
  `keywords` and the last 5 `content_history` topics for this automation
  (`ctx.recentTopics`, loaded by `runner.ts`).
- **Near-duplicate check.** `src/server/ai/similarity.ts#isNearDuplicateTopic()`
  compares the candidate topic against `recentTopics` with character-bigram
  Jaccard similarity on normalized text (lowercased, NFKC, punctuation/
  whitespace stripped) — no embeddings/vector infra. Bigrams (not
  whitespace-tokenized words) were chosen because Korean topic phrases often
  have no natural word boundaries. Default threshold `0.5`
  (`NEAR_DUPLICATE_THRESHOLD`). If the candidate is a near-duplicate,
  `generateTopic()` regenerates **exactly once** (passing the rejected topic
  back in the prompt's avoid-list) and accepts whatever comes back — bounded,
  never a loop.
- **Stage 2 — body.** `buildBlogBodyPrompt()` takes the accepted topic+title
  and asks for `{ excerpt, bodyHtml, keywords, callToAction }`.
- **Unified shape.** `blogContentSchema` (`blogTopicSchema.merge(blogBodySchema)`)
  is `{ topic, title, excerpt, bodyHtml, keywords, callToAction }` — the
  single source of truth for what "AI blog content" looks like, replacing
  the old single-stage `{ topic, title, content }` shape. `PublishContentParams`
  gained an optional `excerpt` field so `WordPressConnector.publish()` can
  send it through to `/wp-json/wp/v2/posts`; other connectors ignore it.
  `content_history.content` (a plain-text column, rendered with
  `whitespace-pre-line` by the automation detail page) stores a tags-stripped
  rendering of `bodyHtml`, not the raw HTML — `automation_runs.output` keeps
  the full structured object (including raw `bodyHtml`) for any future
  consumer that wants it.
- **Success-only persistence.** Unchanged from before this Day:
  `runner.ts#executeAutomation()` only inserts into `content_history` after
  `handler.run()` resolves; any throw from either generation stage (or from
  a configured WordPress publish) is caught by the runner, marks the run
  `FAILED`, and never writes a partial/corrupt history row.

## Billing Flow

```
User clicks "Upgrade" (src/app/(app)/billing/page.tsx)
    │  Server Action: startCheckout(plan)  — src/app/(app)/billing/actions.ts
    ▼
BillingProvider.createCheckout()  — src/server/billing/provider.ts (interface)
    │  creates a billing_checkout_sessions row (PENDING, opaque customerKey/orderId)
    │  mock: redirects to in-app /billing/mock-checkout
    │  toss:  redirects to in-app /billing/toss-checkout, which loads Toss's
    │         hosted billing-auth widget (client key only, never the secret key)
    ▼
User authorizes a payment method
    │  mock: confirms on the in-app page → POST /api/billing/mock/complete
    │  toss: Toss redirects the browser to GET /api/billing/toss/success
    │         (authKey + customerKey query params) or .../toss/fail (a
    │         declined/canceled auth)
    ▼
BillingProvider.completeCheckout() — the single trusted boundary both
providers' callbacks funnel through:
    1. claimCheckoutSession() — PENDING/FAILED → PROCESSING, atomically (a DB
       partial update guarded by `.in("status", ["PENDING","FAILED"])`, so a
       concurrent/duplicate callback for the same session gets
       CHECKOUT_IN_PROGRESS instead of double-processing). Already-SUCCEEDED
       is returned idempotently without calling the provider again.
    2. toss only: issue a billing key from the one-time authKey (skipped if
       a session already has one, e.g. a retried callback), charge it for
       exactly `getPlanConfig(plan).priceMonthlyKrw` (plans.ts remains the
       only source of price), and verify Toss's response echoes the same
       orderId/amount/status=DONE before trusting it.
    3. activateSubscription() — upserts `subscriptions` (ACTIVE, one-month
       period) keyed by user_id; markCheckoutSucceeded()/markCheckoutFailed()
       records the outcome on the session row.
    ▼
Entitlements (src/server/billing/entitlements.ts) read the updated
subscriptions row on the next request — canCreateAutomation() /
canExecuteAutomation() are always re-evaluated server-side, never cached
client-side.
```

**No plaintext PG callback ever reaches the client-visible flow.** `POST
/api/billing/webhook` still exists as a provider-agnostic receiver
(`getBillingProvider().handleWebhook()`), but neither provider currently
uses it for the initial charge: `MockBillingProvider.handleWebhook()` throws
(mock completion is only authenticated through `completeCheckout()`'s own
user-session check, not an unsigned POST), and
`TossBillingProvider.handleWebhook()` is a documented no-op — this
integration completes entirely through the authenticated GET callback above,
so there is no Toss webhook signature to verify yet. If a later Toss feature
needs recurring/async billing events, signature verification belongs inside
`TossBillingProvider.handleWebhook()`, using the raw `payload`/`headers`
`HandleWebhookParams` already carries for exactly that purpose.

**Cancellation vs. a genuine payment failure are distinguished explicitly**,
not inferred from a generic error: Toss's failure redirect
(`/api/billing/toss/fail`) checks the callback's `code` param —
`PAY_PROCESS_CANCELED` calls `markCheckoutCanceled()` (status `CANCELED`),
anything else calls `markCheckoutFailed()` (status `FAILED`) — so a
dashboard or support flow reading `billing_checkout_sessions.status` later
can tell "the user backed out" from "the charge was rejected" without
parsing the error message.

**Secrets never reach the client.** `TOSS_SECRET_KEY` is read only inside
`src/server/billing/providers/toss.ts`/`toss-api.ts` (both `"server-only"`);
the browser only ever sees `NEXT_PUBLIC_TOSS_CLIENT_KEY` (Toss's own
public/client key, safe to expose by design — it authorizes the billing-auth
widget, not a charge). `getTestKeys()` requires both configured keys to
start with `test_`, and `createCheckout()`/`completeCheckout()` call it
before doing anything else — a missing `TOSS_SECRET_KEY` throws
synchronously with a "Missing required environment variable" message
instead of silently falling back to the mock provider or a live key. The
issued Toss `billingKey`/`paymentKey` are stored only in
`billing_checkout_sessions` (`supabase/migrations/0017_billing_checkout_sessions.sql`),
a table with RLS enabled and **no** authenticated-user policy at all — every
read/write goes through the service-role client in
`src/server/billing/checkout-sessions.ts`, the same "server-only table"
pattern Day 2 established for `integration_connections` (Vault wasn't
needed here since nothing outside billing server code ever needs to decrypt
these values back out — they're write-once, read-only-by-the-same-flow).
`subscriptions` (which a user *can* read via RLS) only ever stores the
opaque `billing_checkout_sessions.id` as `provider_customer_id`/
`provider_subscription_id`, never the real Toss identifiers.

Swapping `BILLING_PROVIDER=mock` for `toss` is one env var
(`src/lib/env/server.ts`'s `BILLING_PROVIDER` enum, picked in
`src/server/billing/index.ts#getBillingProvider()`) — `plans.ts`,
`entitlements.ts`, and every call site stay untouched. A third provider
later means one more class against `BillingProvider`
(`src/server/billing/providers/`), nothing else.

## Database Overview

See `supabase/migrations/` for the authoritative schema (RLS policies in `0012_row_level_security.sql`). Summary:

- `profiles` — 1:1 with `auth.users`, auto-created on signup.
- `businesses` — owned by a profile; the context AI generation reads from.
- `automation_templates` — the catalog (seeded in `supabase/seed.sql`).
- `automations` — a user's configured instance of a template (`schedule`/`config` as jsonb).
- `automation_runs` — one row per execution attempt (including a refused one); a partial unique index blocks a second QUEUED/RUNNING row per automation; `source` (`MANUAL` | `SCHEDULED`, `0016_automation_run_source.sql`) records how it was triggered.
- `content_history` — generated output, used to avoid repeating topics.
- `subscriptions` — one per user, drives entitlements.
- `billing_checkout_sessions` — server-only checkout/payment state (opaque `customerKey`/`orderId`, and Toss's `billingKey`/`paymentKey` when applicable); no user-facing RLS policy at all. See "Billing Flow" above.
- `usage` — one row per user per month (`YYYY-MM`, Asia/Seoul), incremented by the runner.
- `setup_requests` — the "구축 대행" service-request queue.
- `directory_tools` — AI Tool Directory catalog.
- `faqs` — Guides/Support content.
- `integration_connections` — a business's connections to external platforms (WordPress today; Instagram/Resend/YouTube later). See "Integration Connections & Secret Storage" below.
- `subscribers` — a business's own newsletter list (`ACTIVE`/`UNSUBSCRIBED`), read by the newsletter automation handler. See "Newsletter Automation & Resend Connector (Day 7)" above.
- Storage bucket `marketing-assets` (public, `0027_instagram_marketing_assets_bucket.sql`) — not a table; holds the single static Instagram marketing-card image so Meta's Graph API can fetch it by URL. See "Instagram Publishing (Day 9)" above.

Everything a user can query directly is RLS-scoped to `owner_id`/`user_id`; writes that must bypass RLS (usage counters, subscription updates, cron-driven runs) go through the service-role client in `src/lib/supabase/admin.ts`, which is only ever imported from trusted server code, never from a route a browser can trigger without the secret/entitlement checks in front of it.

Automation Guides content (title/description shown on `/guides`) is a static TS array in `src/app/(public)/guides/page.tsx` — not a database table, MDX, or CMS. Only the FAQ accordion on that page comes from `faqs`. Keep this static until the content volume or a non-developer editing need actually justifies a database-backed or CMS approach.

## Integration Connections & Secret Storage

`integration_connections` (one row per `(business_id, provider)`) is how an automation handler answers "is this business connected to WordPress/Instagram/etc, and to what" without ever touching a raw credential outside server code:

```
src/server/connectors/integrations.ts (server-only, service-role client)
    createConnection()          — upserts the row; stores/rotates the secret in Vault first
    getConnection()              — user_id + business_id + provider -> row (or null)
    getConnectionSecret()        — decrypts through Vault; null if the connection has no secret
    updateConnectionStatus()     — CONNECTED -> EXPIRED/ERROR/DISCONNECTED transitions
    disconnectConnection()       — deletes the Vault secret, marks DISCONNECTED
```

The table itself only ever stores a `secret_reference` (a Vault secret id) — never the token/application password. The actual secret lives in Supabase Vault (`vault.secrets`, encrypted at rest with `pgsodium`), reached through four `SECURITY DEFINER` wrapper functions added by `0015_integration_connections.sql` (`integration_secret_create/update/read/delete`), each granted to `service_role` only and revoked from `anon`/`authenticated`/`public`. The wrappers exist because PostgREST doesn't expose the `vault` schema directly, and because only trusted server code (never a client-side Supabase call) should ever be able to read a decrypted secret.

RLS on `integration_connections` allows a user to `select` their own rows (to show "connected to https://..."), and grants no `insert`/`update`/`delete` policy at all — every write goes through `src/server/connectors/integrations.ts`, matching the `subscriptions`/`usage`/`automation_runs` pattern of "read via RLS, write via service role."

**Vault availability.** Vault (the `supabase_vault` extension) is provided by the Supabase platform and is expected to be present on any Supabase-hosted project. The migration attempts `create extension if not exists "supabase_vault"` inside an exception-handling block: if the extension genuinely can't be created in a given Postgres instance (e.g. some local/self-hosted setups), the migration still applies — the table, RLS, and indexes are created either way — but the four wrapper functions will raise a clear Postgres error the first time `integration_secret_create/update/read/delete` is actually called, rather than ever silently storing a secret in a plaintext column. If a target project's tier genuinely lacks Vault, the fix is to enable it (Supabase dashboard → Database → Vault, or `create extension supabase_vault`) — there is intentionally no plaintext fallback path in application code for this table.

Note: WordPress credentials today still go through two coexisting paths. The original, pre-existing one — `src/server/connectors/wordpress/credentials.ts` (AES-256-GCM, keyed by `WORDPRESS_CREDENTIALS_KEY`) — encrypts the Application Password and `src/app/(app)/automations/actions.ts` stores it *inside* the owning `automations.config.wordpress.encryptedAppPassword`, one copy per automation rather than one shared row per business; `blog.ts` still reads from it by default and needed no change for Day 3. Day 3 ("WordPress Production Connector") added the Vault-backed bridge described below (`src/server/connectors/wordpress/connect.ts`), but did not rewire `src/app/(app)/automations/actions.ts` to call it — that's a UI-adjacent Server Action change outside Dev1's minimal-diff rule for `src/app/` (see `docs/TEAM_GUIDE.md` file ownership), left for Dev2 coordination. Both paths ultimately construct the same `WordPressConnector`, so switching the UI's connect flow over later is additive, not a rewrite.

```
src/server/connectors/wordpress/connect.ts (server-only, service-role client)
    verifyAndConnectWordPress()  — testConnection() first; only on success calls
                                    createConnection() to persist a CONNECTED row
                                    with the Application Password in Vault
    loadWordPressConnector()     — getConnection() + getConnectionSecret() ->
                                    a ready-to-use WordPressConnector, or null
                                    if the business has no CONNECTED row
```

## Why these choices (Section 3 rationale)

- **No ORM**: the schema is small and stable enough that hand-written types (`src/types/database.types.ts`) plus Supabase's PostgREST client cover it without Prisma's extra dependency, codegen step, and migration-format lock-in.
- **Vercel over Netlify**: zero-config for Next.js App Router/Server Actions/Route Handlers on the free tier — no build plugin or extra config needed. An earlier iteration targeted Netlify (`@netlify/plugin-nextjs`); that config has been removed now that production runs on Vercel.
- **Supabase Cron (pg_cron) + Edge Function calling back into Next.js, not per-automation jobs**: keeps automation logic in one TypeScript codebase instead of duplicating it in Deno; the Edge Function is intentionally ~15 lines. Vercel's own free-tier Cron Jobs are limited to once/day, too coarse for this app's few-minutes cadence, so scheduling stays on the Supabase side (`supabase/migrations/0014_scheduler_cron.sql`).
- **Provider interfaces for AI and Billing**: an env var change, not a code change, when swapping OpenAI↔Gemini or mock↔a real PG — without speculative abstraction beyond what two real implementations each already need.
- **Docker as a secondary, portable runtime**: production deploys through Vercel's git integration, not the Docker image — the `Dockerfile`/`compose.yaml` exist so the app can be built and run anywhere a container runtime is available (self-hosting, local parity testing) without maintaining a second deployment pipeline.
