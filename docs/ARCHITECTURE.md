# Architecture

## System Overview

단일 Next.js (App Router) 레포지토리 + Supabase. 프론트엔드/백엔드를 분리하지 않고, `src/app`(라우트·UI)과 `src/server`(도메인 로직)의 경계로 관심사를 분리합니다.

```
Browser
  │
  ▼
Next.js (Netlify)
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
| Deployment, env config, Supabase functions | Dev1 | `netlify.toml`, `.env.example`, `supabase/functions/` |
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

Everything a user can query directly is RLS-scoped to `owner_id`/`user_id`; writes that must bypass RLS (usage counters, subscription updates, cron-driven runs) go through the service-role client in `src/lib/supabase/admin.ts`, which is only ever imported from trusted server code, never from a route a browser can trigger without the secret/entitlement checks in front of it.

## Why these choices (Section 3 rationale)

- **No ORM**: the schema is small and stable enough that hand-written types (`src/types/database.types.ts`) plus Supabase's PostgREST client cover it without Prisma's extra dependency, codegen step, and migration-format lock-in.
- **Netlify over Vercel**: explicit product requirement; `@netlify/plugin-nextjs` handles App Router/Server Actions/Route Handlers on Netlify Free.
- **Supabase Cron + Edge Function calling back into Next.js, not per-automation jobs**: keeps automation logic in one TypeScript codebase instead of duplicating it in Deno; the Edge Function is intentionally ~15 lines.
- **Provider interfaces for AI and Billing**: an env var change, not a code change, when swapping OpenAI↔Gemini or mock↔a real PG — without speculative abstraction beyond what two real implementations each already need.
