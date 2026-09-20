# AISaaS Daily Autonomous Development Routine (Dev1 seat)

This file is the standing "constitution" for the scheduled daily routine that
develops the Dev1 area of this repository (AI / Automation / Connectors /
Billing / Usage / Scheduler / Deployment). It is read by the automated agent
at the start of every run, together with [`CLAUDE_DAILY_PROGRESS.md`](CLAUDE_DAILY_PROGRESS.md)
(which tracks *which day is current*). General project rules still apply —
[`AGENTS.md`](../AGENTS.md), [`README.md`](../README.md), [`ARCHITECTURE.md`](ARCHITECTURE.md),
[`TEAM_GUIDE.md`](TEAM_GUIDE.md).

**Repository:** https://github.com/WooSungHyun03/AISaaS
**Target branch:** `main` — by explicit owner instruction (2026-09-20), this
routine commits and pushes directly to `main`, superseding the "PR only"
branch policy in `TEAM_GUIDE.md` for this specific automated Dev1 workflow.
That policy still governs any manual/other-seat work in this repo. Because
`main` auto-deploys to Netlify production on every push (see README
"Deployment"), the safeguards in section 6 (never push on a failing
lint/typecheck/test/build) are non-negotiable, not optional style.

## 0. Absolute Objective

Every run ships one visibly complete, production-ready piece of the roadmap
below — implemented, tested, integrated, documented, and pushed to `main`.
Never end a run having only analyzed, planned, or scaffolded. The full loop
every single day:

```
git pull (main) → read today's task → implement → test → fix → full
regression → update progress doc → git add/commit/push (main)
```

## 1. Every Run Starts With a Main Sync

Before touching any code:

```bash
git status
git checkout main
git fetch origin
git pull --rebase origin main
```

Confirm you are on `main` and it is up to date. Do not assume yesterday's
file layout — another session (human or agent) may have changed things.
Skim recent history before writing code:

```bash
git log --oneline -15
```

Then check, in order: `README.md`, `docs/ARCHITECTURE.md`,
`docs/TEAM_GUIDE.md`, `docs/CLAUDE_DAILY_PROGRESS.md`, `package.json`,
`.env.example`, and the specific `src/server/...` area today's task touches.
**If today's feature (or part of it) already exists, do not rebuild it** —
verify it against the Definition of Done below and extend/finish only what's
missing.

## 2. Progress File

`docs/CLAUDE_DAILY_PROGRESS.md` is the long-term state store: `Current Day`,
`Completed`, `Current`, `Blocked External`, `Next`, and a `Daily History`
entry per calendar date. Read it first. Work the **first incomplete Day** —
never skip ahead just because the calendar date advanced, and never redo a
Day another session already finished and verified. If a Day is only
partially done, continue that same Day tomorrow instead of moving on.

## 3. Daily Workload Principle

Each Day below is a full day of senior-engineer work, not a single function.
Cover, as applicable: schema/migration, implementation, input validation,
error handling, integration with the runner/connectors, tests (unit +
integration), documentation, and a full regression pass. If a bug in
existing code blocks today's feature, fix it directly (in scope, minimal
diff). If today's primary task finishes with time/budget left, keep working
the *same area* — integration tests, edge cases, error handling, security
hardening, refactoring, docs — rather than stopping early or wandering into
another Day's scope. Never end a run with a half-finished feature or a
failing test/build.

## 4. Daily Roadmap

### Day 1 — Production AI Provider ✅ Completed 2026-09-20 (merged to `main` via PR #1)

Delivered: `AIProviderError` taxonomy (`MISSING_API_KEY`, `TIMEOUT`,
`RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `INVALID_STRUCTURED_RESPONSE`,
`NETWORK_FAILURE`), a shared timeout+bounded-retry HTTP layer
(`src/server/ai/http.ts`) used by both `OpenAIProvider` and `GeminiProvider`,
`generateStructured()` throwing typed errors, `.env.example` updates
(`AI_REQUEST_TIMEOUT_MS`, `AI_MAX_RETRIES`), and 18 unit tests. Any future
handler (Instagram, Newsletter, etc.) MUST call `generateText`/
`generateStructured` from `src/server/ai/` — never a vendor SDK or raw
`fetch` to an AI endpoint directly. Re-verify this constraint whenever a new
handler is added in a later Day.

### Day 2 — External Platform Connection Management

**Goal:** a safe, reusable foundation for storing a user's external platform
connections (WordPress today; Instagram/others later) so automations can
look up "is this business connected, and to what" without ever handling raw
credentials outside server code.

Do:
1. Inspect `supabase/migrations/` for the last migration number; add a new
   migration `00XX_integration_connections.sql` (never edit an existing
   migration file). Table `integration_connections`: `id`, `user_id`
   (→ `auth.users`), `business_id` (→ `businesses`), `provider` (text/enum:
   `wordpress`, `instagram`, ... — extensible), `account_identifier` (text,
   e.g. site URL or IG username, non-secret), `status` (`CONNECTED` |
   `EXPIRED` | `ERROR` | `DISCONNECTED`), `secret_reference` (text — see
   below, never the raw secret), `metadata` (jsonb), `connected_at`,
   `updated_at`. Add RLS: owner (`user_id = auth.uid()`) can `SELECT` their
   own rows; all writes go through server-only code using the service-role
   client, never a direct client-side insert/update.
2. **Never store an access token / application password in a plaintext
   table column.** Use Supabase Vault (`vault.create_secret` /
   `vault.update_secret`, queried via `vault.decrypted_secrets` from
   server-only code) to hold the actual secret; `secret_reference` stores
   only the Vault secret UUID. If Vault is unavailable in the target
   Supabase project tier, document the fallback clearly in
   `docs/ARCHITECTURE.md` and in this Day's history — do not silently
   downgrade to plaintext.
3. Implement `src/server/connectors/integrations.ts` (or a small module per
   provider under `src/server/connectors/`) with server-only functions:
   `createConnection()`, `getConnection(userId, businessId, provider)`,
   `updateConnectionStatus()`, `disconnectConnection()` (deletes the Vault
   secret and marks `DISCONNECTED`). All of it behind `"server-only"` and
   the service-role client from `src/lib/supabase/admin.ts` — never expose
   service-role usage to a path a browser can hit without an auth check in
   front of it.
4. Add `src/types/` entries for `IntegrationConnection` /
   `IntegrationProvider` /`ConnectionStatus` if not already present — check
   `src/types/` first per project rule 9.
5. Unit/integration tests: connection CRUD against a mocked Supabase client
   (this repo doesn't run a live Supabase instance in CI), status
   transitions, and that secrets never appear in a `metadata`/plain column.

**Definition of Done:** a business can have zero-or-more
`integration_connections` rows; secrets never sit in a plaintext DB column;
server-only CRUD exists and compiles; RLS reviewed; tests pass.

### Day 3 — WordPress Production Connector

**Goal:** Blog Automation can publish to a real WordPress site using the
Day 2 connection foundation.

Do:
1. Server function to **verify** a WordPress connection: given site URL +
   username + Application Password, call a lightweight authenticated GET
   (e.g. `/wp-json/wp/v2/users/me`) to confirm the credentials work and the
   REST API is reachable, before persisting a `CONNECTED` row via Day 2's
   `createConnection()`.
2. `WordPressConnector.publish()` (extend the existing
   `src/server/connectors/wordpress.ts` if present) posts to
   `/wp-json/wp/v2/posts` with `title`, `content`, `excerpt`, and
   `status: "draft" | "publish"` (read from the automation's `config`, not
   hard-coded). On success, return `{ externalPostId, externalUrl }` and
   persist them onto `automation_runs.output` and
   `content_history.external_url`.
3. Classify failures distinctly: invalid/unreachable URL, `401`/`403`
   (auth/permission), timeout, WordPress `4xx` (validation), WordPress
   `5xx`, raw network failure — reuse or mirror the `AIProviderError`-style
   taxonomy pattern from Day 1 (a `ConnectorError` with a `code`), so the
   runner can log a precise `error_message`.
4. Validate the site URL server-side before making any outbound request
   (must be `http`/`https`, reject obviously-internal targets) — this is
   also a basic SSRF guard; a full audit lands on the Security Day, but
   don't ship a blog connector with zero URL validation in the meantime.
5. No real WordPress credentials are available in this environment: build a
   thorough mocked-HTTP integration test suite (verification success/failure,
   publish success/each error class above). If credentials are ever added to
   `.env.local`, a smoke test may run for real, but never publish to a
   production site without the user's explicit say-so.

**Definition of Done:** connection verification + publish both implemented
and covered by mocked HTTP tests; `blog.ts` handler already wired to
`WordPressConnector` needs no behavior change beyond what the connector now
returns; draft vs. publish is user-configurable.

### Day 4 — Blog AI Pipeline Upgrade

**Goal:** move the blog vertical slice from "generate one blob of content"
to a real marketing pipeline.

Do:
1. Prompt input: business `name`, `industry`, `location` (check whether
   `location` exists on the business type — add the column/type field via a
   new migration only if it's genuinely missing), `target_customer`,
   `brand_tone`, `keywords`, plus the last N `content_history` topics for
   this business.
2. Two-stage generation: (a) `generateStructured()` a topic+title candidate
   first, (b) compare it against recent topics with a **normalized string
   comparison** (lowercase, strip punctuation/whitespace, maybe token
   overlap ratio) — no embeddings/vector infra. If too similar, regenerate
   the topic once (bounded, not a loop). Then (c) generate the full body.
3. Unify the structured result shape to `{ title, topic, excerpt, bodyHtml,
   keywords, callToAction }` — update `blogContentSchema` in
   `src/server/ai/prompts/blog.ts` and the handler/connector call sites that
   consume it (`excerpt`/`bodyHtml` naming may currently differ — reconcile
   deliberately, not by leaving two parallel shapes).
4. Only write to `content_history` when the full pipeline succeeds
   end-to-end (topic accepted, body generated and schema-valid). A failure
   at any stage must not leave a partial/corrupt history row.
5. Tests: normalized-similarity comparison (exact dup, near dup with
   punctuation/case differences, genuinely distinct topics), the
   regenerate-once-then-accept path, and "only persist on full success".

**Definition of Done:** blog pipeline produces the unified structured shape,
avoids near-duplicate topics without embedding infra, and only records
history on success; tests cover the similarity logic and the success-only
persistence rule.

### Day 5 — Automation Runner Reliability

**Goal:** the runner cannot double-run an automation or spin forever on
failure.

Do:
1. Before starting a run, check for an existing `QUEUED`/`RUNNING` row for
   the same automation; if one exists, refuse the new run (this may already
   be partially enforced by a DB partial unique index per
   `docs/ARCHITECTURE.md` — verify it actually prevents both the "Run Now"
   double-click case and a concurrent cron tick, and close any gap with an
   application-level check + the DB constraint as a backstop, not one or
   the other).
2. Enforce the `QUEUED → RUNNING → SUCCESS|FAILED` lifecycle strictly; wrap
   the handler call so **any** exception (including ones the handler didn't
   anticipate) is caught, classified, and written to
   `automation_runs.error_message`, and the run is marked `FAILED` — never
   left `RUNNING` forever.
3. Record `source: MANUAL | SCHEDULED` on every run.
4. Refuse to run (and record why) when the automation is `PAUSED`/`ERROR`,
   or when the plan's entitlement check fails (`canExecuteAutomation()` —
   coordinate with Day 11 if it doesn't exist yet; if it doesn't, add a
   minimal version now and let Day 11 harden it further, don't duplicate).
5. On failure, `next_run_at` still advances normally for scheduled runs
   (don't retry-storm the same slot) — confirm no code path retries a
   failed automation run automatically/unboundedly.
6. Tests: duplicate-run rejection (manual double-click, concurrent
   scheduled+manual), exception-in-handler isolation, `PAUSED` automation
   refusal, correct `source` tagging.

**Definition of Done:** no code path can produce two simultaneous
RUNNING/QUEUED rows for one automation, every failure is recorded with a
reason and terminates cleanly, and paused/limited automations never
execute.

### Day 6 — Production Scheduler

**Goal:** the cron path is correct and cannot double-fire a tick.

Do:
1. Verify `findDueAutomations()` selects only `enabled`/`ACTIVE` automations
   with `next_run_at <= now()` (UTC) — confirm timestamps are stored and
   compared in UTC consistently; user-facing schedule input/display converts
   to/from `Asia/Seoul`.
2. Confirm the Supabase Edge Function (`supabase/functions/run-due-automations`)
   stays a thin, ~15-line trigger that calls
   `POST /api/cron/run-automations` with the `CRON_SECRET` header, and that
   the Next.js route rejects any request missing/mismatching that secret
   before doing anything else.
3. `next_run_at` must be recomputed and persisted **immediately** when a
   scheduled run starts (not after it finishes) so a slow run doesn't get
   picked up again by the next tick, and two ticks arriving close together
   can't both grab the same automation — combine with Day 5's
   duplicate-run guard as the backstop.
4. Daylight-saving/timezone edge cases: confirm `computeNextRunAt` (already
   has unit tests in `scheduler.test.ts`) handles a WEEKLY schedule crossing
   a KST offset boundary correctly; add cases if any gap is found — do not
   modify existing passing test expectations without a clearly demonstrated
   bug.
5. Tests: concurrent-tick simulation (two calls to the due-automations path
   in quick succession only run the automation once), disabled/paused
   automations never appear in `findDueAutomations()`.

**Definition of Done:** due-query correctness, cron auth, and
double-tick/duplicate-run safety are all covered by tests; timezone handling
documented and verified.

### Day 7 — Newsletter Automation + Resend Connector

**Goal:** newsletters are a second real automation vertical (not just blog).

Do:
1. New migration for `subscribers` (or extend an existing table if one
   already fits — check first): `id`, `business_id`, `email`, `name`,
   `status` (`ACTIVE`/`UNSUBSCRIBED`), `subscribed_at`, `unsubscribed_at`.
   RLS scoped to the owning business's `owner_id`.
2. `NewsletterAutomationHandler` (new file under
   `src/server/automations/handlers/`, following the `blog.ts` shape):
   Business Profile + recent content → `generateStructured()` a `{ subject,
   previewText, htmlBody }`.
3. `EmailConnector` interface (mirror the `AIProvider`/`BillingProvider`
   pattern — vendor-neutral) with a `ResendConnector` implementation.
   `RESEND_API_KEY` stays server-only (`src/lib/env/server.ts`), documented
   in `.env.example`.
4. Send only to `ACTIVE` subscribers. Use an idempotency key (e.g. derived
   from `automation_run.id`) so a retried/re-triggered run of the same
   automation run doesn't re-send to everyone.
5. Persist per-run send counts (success/failure) and the provider's message
   id(s) on `automation_runs.output`.
6. No `RESEND_API_KEY` available here — build complete mocked-HTTP
   integration tests (send success, partial failure, provider error,
   idempotent re-run).

**Definition of Done:** newsletter automation runs end-to-end against the
mock, only reaches `ACTIVE` subscribers, never double-sends on retry, and
records success/failure counts; `.env.example` documents `RESEND_API_KEY`.

### Day 8 — Instagram Professional Account Connection

**Goal:** Meta OAuth connection flow, Professional accounts only.

Do:
1. OAuth flow using the connection foundation from Day 2: authorization URL
   → callback route validates `state` (CSRF), exchanges code for a token,
   confirms the account is Business/Creator (Professional) — **reject and
   clearly message on a personal account**, never silently treat it as
   supported.
2. Store `account_id`/`username` (non-secret) in `integration_connections`
   metadata; the access token goes to Vault via Day 2's helpers, never a
   plaintext column.
3. Handle callback errors (user denies, Meta returns an error param,
   state mismatch) distinctly and surface a clear status.
4. Reconnect/disconnect flows; token expiry or a revoked-permission error
   from Meta should flip status to `EXPIRED`/`ERROR`, not silently keep
   showing `CONNECTED`.
5. No Meta app credentials available here — implement the full flow behind
   the interface, and cover it with mocked OAuth/HTTP integration tests
   (state validation, non-professional rejection, token exchange failure,
   success path).

**Definition of Done:** OAuth flow implemented end-to-end against mocks;
non-professional accounts are rejected with a clear error; tokens never sit
in plaintext.

### Day 9 — Instagram Publishing

**Goal:** publish AI-generated content to a connected Professional account.

Do:
1. `InstagramAutomationHandler` generates caption + hashtags via the common
   `AIProvider` (never a vendor SDK directly, per Day 1's constraint).
2. MVP media: a single static marketing-card image (server-rendered
   template, or reuse whatever image generation already exists in the repo
   — check first) uploaded to Supabase Storage so Meta's API can fetch it
   by URL. Do not add a new image-generation dependency for this.
3. Publish sequence: create media container → poll/check status if the API
   requires it → `media_publish`. Persist the resulting Instagram media id
   on `automation_runs.output`.
4. Wire `InstagramAutomationHandler` into the same `AutomationRunner` core
   used by blog/newsletter — no automation-type-specific forking of the
   runner lifecycle.
5. Carousel/Reels are explicitly out of scope for this Day — single image
   post only.
6. Mocked HTTP integration tests for the full container→publish sequence
   and its failure modes (container creation failure, stuck/failed status,
   publish failure).

**Definition of Done:** a single-image Instagram post can be generated and
"published" against mocks end-to-end through the standard runner; media id
recorded; no scope creep into carousel/reels.

### Day 10 — Toss Payments Billing Provider

**Goal:** a real (test-mode) payment provider alongside `MockBillingProvider`.

Do:
1. Add `TossBillingProvider` implementing the existing `BillingProvider`
   interface (`src/server/billing/provider.ts`) — do not change that
   interface's shape unless a real gap is found, and if so, keep
   `MockBillingProvider` working too.
2. `BILLING_PROVIDER=mock|toss` env switch (extend the zod enum in
   `src/lib/env/server.ts`), documented in `.env.example`. Toss **test**
   keys only — if no key is configured, `toss` mode should fail closed with
   a clear `MISSING_API_KEY`-style error, not silently fall back to mock.
3. Flow: plan selection → Toss checkout/billing-key auth → server-side
   callback → payment approval call → `subscriptions` row updated →
   entitlements re-evaluated on next read (never cached client-side, per
   `ARCHITECTURE.md`'s existing billing flow).
4. Store `customerKey`/`paymentKey`/`billingKey` server-side only (Vault or
   a server-only table per Day 2's pattern — never client-visible).
5. Distinguish a genuine Toss API error from a user-initiated cancellation
   in both the return value and any logging/`automation`-adjacent state.
6. Prices/limits always come from `plans.ts` — never hard-code a price or
   limit inside the Toss handler.
7. No live Toss merchant credentials exist — implement fully against Toss's
   documented test-mode contract with thorough mocked-HTTP tests (success,
   declined, cancelled, network failure, webhook/callback signature
   mismatch if applicable). Never attempt a real charge.

**Definition of Done:** `TossBillingProvider` satisfies `BillingProvider`,
switches in via env var, test-mode flow covered by tests, secrets never
reach the client, and `plans.ts` remains the single source of truth for
pricing/limits.

### Day 11 — Usage, Entitlements & Cost Protection

**Goal:** plan limits are enforced server-side, not just hidden in the UI.

Do:
1. Before any automation execution (manual or scheduled) and before any AI
   call inside a handler, check `canExecuteAutomation()`/monthly usage
   against `plans.ts` limits (automation count, monthly runs, AI generation
   count) for the user's current plan.
2. Increment usage exactly once per attempt regardless of success/failure
   (an AI call that fails after being made still cost money) — verify no
   code path double-increments on retry or under concurrent requests.
3. Return a standard error code — `LIMIT_EXCEEDED`, `FEATURE_NOT_AVAILABLE`,
   `PLAN_REQUIRED` — and stop **before** any connector/external API call is
   made, never after.
4. Month-boundary correctness: usage keys off `YYYY-MM` in `Asia/Seoul` per
   `ARCHITECTURE.md` — add tests for a run at 23:59 vs 00:01 KST around a
   month boundary, and for the first run of a new month creating a fresh
   usage row rather than erroring on a missing one.
5. Tests: limit-exceeded blocks execution before any connector call,
   correct single-increment semantics, month-boundary rollover.

**Definition of Done:** every plan limit named above is enforced
server-side with a standard error code, usage increments exactly once per
attempt, and month-boundary behavior is tested.

### Day 12 — Production Deployment & Operational Hardening

**Goal:** `main` stays genuinely deployable, and the deploy path is
verified end to end.

Do:
1. Enumerate every env var this app now needs (cross-reference
   `.env.example` against actual `serverEnv`/client env usage) and confirm
   Netlify + Supabase Edge Function secrets docs (`README.md`) list all of
   them, including anything added in Days 2–11 (Vault-related config,
   `RESEND_API_KEY`, Toss keys, Meta app credentials, etc.).
2. Confirm every externally-callable endpoint (cron trigger, billing
   webhook/callback, OAuth callbacks) validates a secret/signature before
   doing any work, and returns a generic error to unauthenticated callers
   (no internal detail leakage).
3. Grep for any accidental client-bundle import of
   `SUPABASE_SERVICE_ROLE_KEY` or other server-only secrets; confirm the
   `"server-only"` guard actually covers every server-secret module added
   this week.
4. If a GitHub Actions workflow doesn't exist yet, add a minimal one:
   install → lint → typecheck → test → build, running on every push to
   `main` (this becomes the safety net for a routine that no longer goes
   through PR review).
5. Update `README.md`/deployment docs for anything genuinely new (new env
   vars, new Supabase secrets, new callback URLs) — don't rewrite sections
   that are still accurate.
6. Full local smoke test with `AI_PROVIDER=mock`, `BILLING_PROVIDER=mock`:
   signup → business → automation → run → history, to the extent runnable
   without a live Supabase project; document precisely what could and
   couldn't be exercised.

**Definition of Done:** env var/secrets documentation is complete and
accurate, every external entrypoint is authenticated, no server secret
reaches the client bundle, and CI runs the same checks this routine runs
locally before every push.

### Day 13 — YouTube Upload Connector (P2 — do not let this jump the queue)

Only start this Day once Days 2–12 are genuinely done. Scope is deliberately
narrow:

Do:
1. AI-generated script/title/description/hashtags via the common
   `AIProvider` — text only.
2. YouTube OAuth + `videos.insert` upload connector for an **existing** MP4
   (user-uploaded or produced elsewhere) — title, description, hashtags,
   privacy status (default `private` since an unverified API project's
   uploads may be restricted anyway).
3. Explicitly do not add FFmpeg, video rendering, or Shorts-generation
   infrastructure — that's out of scope for Netlify's runtime and for this
   Day.
4. No YouTube credentials available here — mocked OAuth/upload integration
   tests covering success, auth failure, and upload/network failure.

**Definition of Done:** a connector exists that can take an already-produced
MP4 and metadata and upload it to YouTube (mocked), nothing more.

## 5. After Day 13 — Maintenance Mode

Once Day 13 is genuinely complete, stop adding new large features on a
fixed schedule. Every run instead:

1. `git pull --rebase origin main`.
2. Review the last ~20 commits for anything relevant to Dev1's area.
3. Run `npm run lint && npm run typecheck && npm test && npm run build`.
4. Grep for `TODO`/`FIXME`/`HACK`/`console.log`/`any`/`eslint-disable` inside
   Dev1's directories.
5. Look for a security or reliability gap (auth, RLS, secret handling,
   unbounded retries, unvalidated input, SSRF, unbounded request size).
6. Pick the single most valuable fix/improvement, implement it fully with
   tests, and avoid speculative new features.
7. Update `docs/CLAUDE_DAILY_PROGRESS.md`, commit, push to `main`.

Do not unilaterally start a large new feature in maintenance mode — this
routine's job at that point is stability and polish, not net-new scope.

## 6. Non-Negotiable Safety Rules

**External credentials.** Missing `OPENAI_API_KEY` / `GEMINI_API_KEY` /
`WORDPRESS_*` / `RESEND_API_KEY` / `META_*` / `TOSS_*` / `YOUTUBE_*` is never
a reason to stop. Build the adapter, validation, error handling, and
mocked-HTTP tests fully; only run a real smoke test if the credential is
actually present; never claim something was verified live when it wasn't.
Record precisely what's blocked in `docs/CLAUDE_DAILY_PROGRESS.md` under
`Blocked External`.

**Database.** Never edit an existing migration file. Always add a new
`supabase/migrations/00XX_description.sql` with the next sequential number.
Review RLS on every new table. Update `src/types/database.types.ts` to
match.

**Team safety.** Do not unnecessarily modify `src/app/`, `src/components/`,
`src/server/directory/`, or `src/server/customer-support/` — those are other
seats' areas per `docs/TEAM_GUIDE.md`. Touch them only for the minimum
change needed to keep the build compiling after a Dev1 API change, never for
redesign. Never delete or revert another session's work without
understanding it first — if you find unfamiliar in-progress state,
investigate, don't overwrite.

**No overengineering.** No microservices, Kafka, Kubernetes, Redis without
an actual proven need, a second backend language/framework, GraphQL, a new
ORM, custom auth, a large event bus, a duplicate AI SDK abstraction, or a
new state-management library. Stay on Next.js + Supabase. A new abstraction
is only justified once two real call sites need it (project rule 10).

**Testing.** Before ending any run: `npm run lint`, `npm run typecheck`,
`npm test`, `npm run build` must all pass (confirm the actual script names
in `package.json` if they ever change). Never commit on a failing state. If
a failure is pre-existing and unrelated to today's area, fix it if safe,
otherwise record the exact failure in the progress file rather than papering
over it.

**Secrets.** Never commit `.env`, `.env.local`, an API key, a password, or
the Supabase service-role key. Before every commit:

```bash
git add -A
git status
git diff --cached --check
git diff --cached --stat
```

Inspect anything unexpected in the staged diff — including files that don't
look secret by name — before committing.

## 7. End-of-Day Git Procedure (direct to `main`)

Do not commit the moment the work "feels" done — resync first:

```bash
git fetch origin
git pull --rebase origin main
```

If this produces conflicts: preserve any newer work already on `main`
(don't blindly take "ours" or "theirs"), merge it semantically with today's
changes, and re-run the full test suite after resolving. Never force-push,
never delete another commit's work to make a conflict go away.

Once resolved and green:

```bash
git add -A
git status
git diff --cached --check
git commit -m "<specific description of what was actually implemented today>"
git push origin main
```

`git push --force` / `--force-with-lease` are never used. If the push is
rejected as non-fast-forward, someone else pushed to `main` in the
meantime — `git fetch && git pull --rebase origin main`, resolve, re-run
tests, and push again. Never delete someone else's commits to resolve this.

Update `docs/CLAUDE_DAILY_PROGRESS.md` **before** this final push (it should
be part of the same commit): mark the Day `Completed` only if its Definition
of Done is genuinely met; otherwise leave it as `Current` and continue the
same Day on the next run rather than advancing.

## 8. Final Report Format

End every run with:

```
Date:
Day:

Implemented:
- ...

Modified:
- ...

Database:
- ...

Tests:
- lint / typecheck / test / build: pass|fail (details if fail)

External verification:
- ...

Blocked:
- ...

Commit:
- <sha> <message>

Push:
- origin/main

Next:
- ...
```

## 9. Most Important Rule

The goal of each run is one visibly more production-ready feature by the
time it ends — not a little code, not a plan, not a placeholder. Implement,
test, integrate, document, and push to `main` every single run.
