# Easy Marketing: Claude Sonnet 5.5 Quality Harness

> **Purpose:** Fix and verify the existing three-person student SaaS; do not invent enterprise features. This is an **agent-operated** loop, not a self-modifying agent. The script is an evaluator; **Claude must read failures, change code, rerun and provide evidence**.
>
> Based on the GitHub `main` snapshot inspected **2026-10-21**: Next.js 16.3.5, React 19, Supabase/Auth/RLS, Vercel, Vitest, existing local browser E2E. Re-check against the live branch before changing code.

## 0. Nonnegotiables

1. On entry, read `AGENTS.md`, `docs/TEAM_GUIDE.md`, `docs/ARCHITECTURE.md`, this document and `docs/harness/ACCEPTANCE.md`.
2. Inspect `git status`, `git fetch origin`, then integrate current `origin/main` **without discarding uncommitted or teammate work**. Work on a short-lived branch and submit a PR per `docs/TEAM_GUIDE.md`. No force push.
3. Read Next 16 local docs at `node_modules/next/dist/docs/` before making Next.js API/convention changes.
4. Prioritize **P0 and evidenced P1**. Fix actual failures; do not refactor a working file based on style alone. Use existing domain boundaries, providers, Supabase clients, types and components.
5. No uncontrolled paid AI/video calls, actual payments, production DB writes/migrations, real OAuth credentials, production scraping, business verification bypass or destructive testing. Local mock fixtures only unless explicitly authorized for a particular live check.
6. Production must never show `[MOCK AI RESPONSE]` as a real result. Never fabricate publicly unavailable YouTube Analytics or blog traffic. Official APIs, RSS, robots and terms must be respected; don't bypass access restrictions.
7. Preserve real accounts, credits, history, uploads and prior metrics. A changed DB schema needs a **new migration** + compatible code + a rollback plan; **never rewrite an applied migration**.
8. Explicitly label evidence: `STATIC` (code/read), `UNIT`, `LOCAL_E2E`, `PERF_LOCAL`, `PROD_READ_ONLY`, `NOT_VERIFIED`. An endpoint 200 or green mock test is not proof of a completed live AI generation.

## 1. Scope chosen for this project

**P0: blocking demo/data/security** — auth/admin/user isolation/RLS; uploading business photos → AI reference → history; blog and video generation/credits/budget/AI mock guard; selected-KST-weekday scheduling/deferred run/duplicate prevention; daily 06:00 KST public-channel collection, error recovery, truthful growth charts; critical page/navigation regressions; deploy env and new migrations.

**P1: usability and maintainability** — 7/30/90-day and daily/weekly/monthly growth interactions; startup and navigation latency; loading/empty/error feedback; local PC/mobile browser journey; file boundaries, meaningful duplication and risky dependency chains; guide screenshot/content consistency.

**Out of scope unless a P0 bug proves relevance:** actual merchant registration, real settlement/refunds, enterprise orgs/roles, Kubernetes, microservices, expensive infra, dark mode, visual redesign for its own sake, speculative abstractions, marketing acquisition, detailed accounting/tax systems.

## 2. Agent loop — repeat for each failure

**0. Baseline.** Record `git status`, SHA, affected page/API, steps to reproduce, expected vs actual, source of evidence. Run `npm run harness:audit` and the appropriate focused tests BEFORE editing. Update `docs/harness/ISSUES.md` for every finding; assign `P0/P1/P2` and an owner.

**1. Reproduce.** Follow input → auth/validation → backend/API/cron → DB/storage/provider → output and browser. Capture a failing test, console/network trace or read-only log. Isolate root cause, not just symptoms.

**2. Small fix.** Use existing files/abstractions if possible. Preserve unrelated code and DB. Add a regression test that fails pre-fix and passes afterward; test normal/failure/idempotency cases. No new library unless clearly necessary.

**3. Local verify.** Run `npm run harness:focus -- <scope>` for the domain, then `npm run harness:verify` (lint, TS, Vitest, build), then `npm run harness:demo` and `npm run harness:perf` when the local stack/Chrome are available. If the test requires a live provider, label it `NOT_VERIFIED` instead of generating fake success.

**4. Review.** Inspect changed files, user/tenant security, error states, mobile UX, duplicate requests, price/credits, environment mismatch, stale migrations and performance. Re-run the previously failing reproduction and record new numbers.

**5. Decide.** If **any P0 fails**, continue the next minimal fix loop. If P1 is evidenced and materially affects demo, fix and rerun. If a test is blocked by external credentials/sandbox, record the exact blocker, don't pretend it passed. Avoid endless loops: after three unsuccessful hypotheses on one failure, stop changing unrelated code, escalate with evidence and a targeted next action.

**6. Finish.** `git diff --check` → status/secret scan → latest main integration → rerun gates → PR per team rules → verify CI, deploy and production via read-only checks when access exists. Record SHA and exactly what was **not** tested.

## 3. Execute the harness

Install/wire once after copying files into the repo:

```bash
node scripts/harness/install.mjs
npm run harness:test
```

Then:

```bash
npm run harness:audit                  # fast static integrity and secret-filename checks
npm run harness:focus -- schedule      # schedule | assets | growth | ai | billing | security | ui | performance
npm run harness:verify                 # audit → lint → typecheck → Vitest → build → diff check
```

For browser E2E and performance, **first** set up only the local seeded Supabase/Next environment (`docs/LOCAL_DATABASE.md`), Chrome, port 3100 and mock providers. The E2E scripts **mutate the local database**; never run them against production. The runner requires an explicit local-only opt-in:

```bash
# In a SEPARATE terminal, start the seeded local stack from the existing instructions.
# In the harness terminal:
HARNESS_ALLOW_LOCAL_E2E=1 E2E_BASE_URL=http://localhost:3100 \
  AI_PROVIDER=mock BILLING_PROVIDER=mock CHANNEL_DATA_PROVIDER=mock \
  npm run harness:demo
HARNESS_ALLOW_LOCAL_E2E=1 E2E_BASE_URL=http://localhost:3100 \
  npm run harness:perf
```

**Which server for which gate (learned on 2026-10-21):** `harness:demo` needs the mock providers, which a production build refuses by design (mock channel data and the placeholder Shorts video are blocked when `NODE_ENV=production`), so run it against `next dev` started with `CHANNEL_DATA_PROVIDER=mock AI_PROVIDER=mock BILLING_PROVIDER=mock ALLOW_MOCK_AI=true`. `harness:perf` measures a **production build** (`npm run build` with the local env, then `next start` with `CHANNEL_DATA_PROVIDER=live ALLOW_MOCK_AI=true AI_PROVIDER=mock`). The guard also reads `.env.local`: it must point at the local Supabase (back up your own file and restore it afterwards).

The suite runs: scheduled blog/shorts, reference photos, channel collection, admin access, guide pages, new-user journey (signup → first blog post → credits → logout/login), PC/mobile page sweep, monkey sweeps (click every safe control), local credit-ledger and selected RLS/cron/channel/budget database checks. It refuses to run unless `.env.local` explicitly points to **localhost Supabase** and the test server is local; keep the service-role key for production out of this environment. Performance uses the existing `scripts/perf/measure.mjs` and fails if any of six growth controls are not measured, exceed 250ms selected state or create network requests. Adjust by `HARNESS_GROWTH_SELECT_MS` / `HARNESS_GROWTH_REQUESTS` only with evidence. The benchmark depends on hardware/load: compare like for like, recording warm/cold conditions. All gates report JSON+Markdown to ignored `.tmp/harness/` and return nonzero on failure.

Optional checks existing in repository: `npm run test:credits-db`, domain-specific DB tests (with approved LOCAL settings), `npm run check:providers`, `npm run guide:capture`. Do not automatically invoke operations against live services.

**Note:** `npm run harness:verify` needs installed packages and build environment variables; failure caused by missing external configuration is a blocker, not proof the app logic is broken. Never copy secrets into CI.

## 3.5. Targeted architecture / maintenance check (performed by Claude)

This repository already has a single Next App Router app and domain-based `src/server/` services; **do not introduce a microservice framework or rewrite architecture**. For each P0/P1 change, check these concrete risks:

- **UI → API boundary:** UI components may read RLS-scoped user data, but server-only secrets, paid AI calls, privileged DB writes and cron execution must stay behind Server Actions/Route Handlers/`src/server`. Reuse `src/lib/env/server.ts` and existing auth helpers.
- **Single truth for billing and scheduling:** avoid parallel custom credit counters, alternative cron loops, divergent `getNextRunAt` implementations, or new storage bucket helpers. Locate existing behavior with `rg` first.
- **RLS and idempotency:** for any new write, verify ownership with a server-side test and add unique constraints/atomic claims where races are possible. Failed external providers must not leave credits or runs in inconsistent states.
- **Mock versus real:** local fixtures are allowed but must be explicitly labelled; no demo should claim live channel metrics, valid paid checkout, or completed Shorts render based on a placeholder.
- **Change pressure:** inspect repeated branches, identical error mappings and repeated Supabase queries in the touched domain only. Refactor only when it reduces real duplication without adding coupling. Reuse existing UI atoms and validation schemas.
- **User flow:** check mobile and desktop, loading/empty/error states, keyboard access, action confirmation, and whether a task can be completed from input through persisted output.
- **Response performance:** compare the same browser/device/data before and after; avoid per-click data recollection or full reloads to switch an already loaded growth chart aggregation.

Suggested searches: `rg -n 'getUser\(|getClaims\(|AI_PROVIDER|CHANNEL_DATA_PROVIDER|MOCK AI RESPONSE|next_run_at|reserve.*credit|createSignedUploadUrl' src` (inspect matches, do not blanket-replace). If a command or grep match is inconclusive, treat it as **hypothesis**, not a confirmed bug.

## 4. Prioritize findings without scope creep

| Severity | Example | Exit requirement |
|---|---|---|
| P0 | Cross-tenant file access, wrong credits, mock in production, scheduled run never fires, paid call without cap, fake channel metric, corrupt data, crashing core flow | Fix or explicitly block release with evidence |
| P1 | Growth filters 2s, broken image preview, confusing failure state, duplicate DB reads, broken mobile layout/guide | Fix if evidenced; measurable regression test |
| P2 | Cosmetic duplication, comment style, unneeded abstraction, advanced filtering/dark mode | Record only unless trivially safe and relevant |

Read `docs/harness/ACCEPTANCE.md` for the **specific verifiable contract per feature**. Use `scripts/harness/scopes.json` to identify focused tests. Status lives in `docs/harness/ISSUES.md`; a green command is necessary but does not override a failing real user flow.

## 5. Reporting contract for Claude

For each iteration: changed files; root cause; reproduction; new regression test; commands and pass/fail; metrics (if performance); unaffected product flows; risks. At end provide 1) P0/P1 open vs fixed, 2) audit/focus/verify/demo/perf status, 3) local vs live evidence, 4) unresolved blockers, 5) PR/commit SHA and deployment outcome. Do **not** claim all real external APIs work without live evidence. Never describe ongoing/background work unless a real scheduler was configured and verified.
