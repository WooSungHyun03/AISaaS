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

Only `blog-marketing` has a working handler + connector (WordPress) today — the vertical slice used to validate the architecture end to end. The other four templates have handler/connector interfaces in place that throw "not implemented yet"; `AUTOMATION_AVAILABILITY` in `src/types/automation.ts` is the single source of truth the UI reads to show Available/Beta/Coming Soon and to gate what the creation wizard offers.

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

## Billing Flow

```
User clicks "Upgrade" (src/app/(app)/billing/page.tsx)
    │  Server Action: startCheckout(plan)
    ▼
BillingProvider.createCheckout()  — src/server/billing/provider.ts (interface)
    │  mock: returns a URL to /billing/mock-checkout (in-app, no real PG)
    ▼
User confirms → POST /api/billing/webhook  (same route a real PG would call)
    │
    ▼
BillingProvider.handleWebhook() — updates subscriptions (plan, status, period)
    │
    ▼
Entitlements (src/server/billing/entitlements.ts) read the updated row on the
next request — canCreateAutomation() / canExecuteAutomation() are always
re-evaluated server-side, never cached client-side.
```

Swapping `BILLING_PROVIDER=mock` for a real PG later means implementing one more class against `BillingProvider` (`src/server/billing/providers/`) — `plans.ts`, `entitlements.ts`, and every call site stay untouched.

## Database Overview

See `supabase/migrations/` for the authoritative schema (RLS policies in `0012_row_level_security.sql`). Summary:

- `profiles` — 1:1 with `auth.users`, auto-created on signup.
- `businesses` — owned by a profile; the context AI generation reads from.
- `automation_templates` — the catalog (seeded in `supabase/seed.sql`).
- `automations` — a user's configured instance of a template (`schedule`/`config` as jsonb).
- `automation_runs` — one row per execution; a partial unique index blocks a second QUEUED/RUNNING row per automation.
- `content_history` — generated output, used to avoid repeating topics.
- `subscriptions` — one per user, drives entitlements.
- `usage` — one row per user per month (`YYYY-MM`, Asia/Seoul), incremented by the runner.
- `setup_requests` — the "구축 대행" service-request queue.
- `directory_tools` — AI Tool Directory catalog.
- `faqs` — Guides/Support content.
- `integration_connections` — a business's connections to external platforms (WordPress today; Instagram/Resend/YouTube later). See "Integration Connections & Secret Storage" below.

Everything a user can query directly is RLS-scoped to `owner_id`/`user_id`; writes that must bypass RLS (usage counters, subscription updates, cron-driven runs) go through the service-role client in `src/lib/supabase/admin.ts`, which is only ever imported from trusted server code, never from a route a browser can trigger without the secret/entitlement checks in front of it.

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

Note: WordPress credentials today (as of this Day) still go through a separate, pre-existing path — `src/server/connectors/wordpress/credentials.ts` (AES-256-GCM, keyed by `WORDPRESS_CREDENTIALS_KEY`) encrypts the Application Password and `src/app/(app)/automations/actions.ts` stores it *inside* the owning `automations.config.wordpress.encryptedAppPassword`, one copy per automation rather than one shared row per business. That path is not touched by this Day (it already works end to end, and rewiring it is a UI-adjacent Server Action change outside Dev1's minimal-diff rule for `src/app/`). Migrating WordPress's connect flow onto the shared, Vault-backed `integration_connections` table from this Day — via `createConnection()`/`getConnectionSecret()` in `src/server/connectors/integrations.ts` — is explicit Day 3 scope ("WordPress Production Connector" in `DAILY_ROUTINE_PLAN.md`).

## Why these choices (Section 3 rationale)

- **No ORM**: the schema is small and stable enough that hand-written types (`src/types/database.types.ts`) plus Supabase's PostgREST client cover it without Prisma's extra dependency, codegen step, and migration-format lock-in.
- **Vercel over Netlify**: zero-config for Next.js App Router/Server Actions/Route Handlers on the free tier — no build plugin or extra config needed. An earlier iteration targeted Netlify (`@netlify/plugin-nextjs`); that config has been removed now that production runs on Vercel.
- **Supabase Cron (pg_cron) + Edge Function calling back into Next.js, not per-automation jobs**: keeps automation logic in one TypeScript codebase instead of duplicating it in Deno; the Edge Function is intentionally ~15 lines. Vercel's own free-tier Cron Jobs are limited to once/day, too coarse for this app's few-minutes cadence, so scheduling stays on the Supabase side (`supabase/migrations/0014_scheduler_cron.sql`).
- **Provider interfaces for AI and Billing**: an env var change, not a code change, when swapping OpenAI↔Gemini or mock↔a real PG — without speculative abstraction beyond what two real implementations each already need.
- **Docker as a secondary, portable runtime**: production deploys through Vercel's git integration, not the Docker image — the `Dockerfile`/`compose.yaml` exist so the app can be built and run anywhere a container runtime is available (self-hosting, local parity testing) without maintaining a second deployment pipeline.
