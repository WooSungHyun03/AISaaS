# Claude Daily Quality Audit

Scheduled routine (2026-10-10 ~ 2026-10-26 KST). Each run reviews the latest
`main`, fixes what it finds, verifies, and pushes. The next run starts its
"new changes" review from the **last reviewed SHA** below.

**Last reviewed SHA:** `fdccbe1` (2026-10-11 run — update the line on every run)

## Open findings (carry over until fixed)

| ID | Sev | Area / owner | Finding | Status |
|---|---|---|---|---|
| F-001 | P2 | layout / 팀원 2 | `/business` is no longer in `APP_NAV`; on that page no sidebar item is active. Pages still link to it (diagnosis, blog, shorts, growth report). Decide whether it lives under 설정 or 마케팅 진단 (`activePaths`). | open |
| F-002 | P2 | usage / 팀원 2 | `/usage` re-exports the history page's default only, so it has no `metadata` title (tab shows the site default). `/settings` also has no title. | open |
| F-003 | P1 | support / 팀원 2 | `/support` shows FAQ only — no way to send an inquiry. Terms/privacy now tell users to request refunds and account deletion via 문의, so the inquiry form is needed. | open (teammate ticket in progress) |
| F-004 | P2 | dashboard / 팀원 2 | Dashboard still shows "진행 중인 만들기 설정 / 다음 제작 예정" stats from `automations`, but every `/automations` entry point was removed from navigation. | open |
| F-005 | P1 | account | No self-service account deletion (privacy policy promises deletion on request). | **fixed 2026-10-11** (설정 > 회원 탈퇴) |
| F-006 | P1 | migrations / 팀원 1·2 | 팀원 1 used `0040`–`0042` (ticket 1-5/1-7), which is 팀원 2's reserved range (0040–0049). 팀원 2's next migration must start at **0043** or later; check `ls supabase/migrations \| sort -V \| tail` before numbering. Claude uses 0050+. | open — tell both teammates |
| F-007 | P2 | channels / 팀원 1 | A tracked channel can never be removed: `tracked_channels` has no delete policy and there is no UI. A mistyped channel stays on /diagnosis and the daily cron keeps spending YouTube/Naver quota on it. Needs a "채널 삭제" action (owner check + admin delete, or a delete policy). | open |
| F-008 | P2 | channels / 팀원 1 | Growth narratives cache the rule-based fallback for the whole KST day when the AI call fails (`getOrCreateGrowthNarrative`), so one AI outage hides the AI text until tomorrow. | open (low) |

## Run log

### 2026-10-11 (run 2)

- **Start SHA:** `fdccbe1` (pulled 28 commits: 팀원 1 tickets 1-1~1-7 — channel domain model, YouTube/Tistory/Naver collectors + scoring, snapshot pipeline + cron route, `/diagnosis` channel screen, rate limit, growth report + SVG chart + AI narratives; the user's character-Shorts work).
- **Reviewed:** migrations 0034–0042 (RLS), `src/server/channels/*` (register, diagnose, snapshot, collect-now, collect-pipeline, rate limit, narratives, Tistory RSS fetch via the SSRF-guarded `fetchPublicXml`, URL parser), `/api/cron/collect-metrics` (CRON_SECRET + `safeEqual` — OK), `/diagnosis` and `/growth-report` pages, auth/settings for F-005.
- **Findings & fixes**
  - P1 (fixed) **Every channel snapshot write was rejected by RLS.** `saveMetricSnapshot` used the user-scoped client, but `marketing_metric_snapshots` deliberately has no insert/update policy (0036). Reproduced locally: `42501 new row violates row-level security policy`. Effect: "채널 추가"/"다시 진단하기" saved the diagnosis and then showed an error, "지금 수집" always failed, and real channels never got growth data. Now writes with the service-role client; every caller passes a channel id it already read through RLS (or runs behind CRON_SECRET).
  - P1 (fixed) **The daily metrics cron could never collect anything.** `processDueChannels`/`cleanupOldSnapshots` used the cookie-based client with no session (reads 0 rows under RLS — reproduced), and `next_snapshot_at` was never set, so no channel was ever due. Cron paths now use the service-role client, new channels get `next_snapshot_at = now + 24h` on insert, rows with a null schedule count as due, and one tick reads at most 200 channels.
  - P1 (fixed) `/diagnosis` called the AI once per channel on **every page load** (`buildChannelNarrative` uncached) — real token cost and slow renders with AI_PROVIDER=anthropic. Added `getChannelNarrative`: Next `unstable_cache` keyed by the diagnosis (incl. `collectedAt`) + business name/industry, 24h; the rule-based fallback is not cached so the next load retries the AI. (`unstable_cache` is the non-Cache-Components API; the app does not opt into `cacheComponents`.)
  - P1 (fixed, F-005) Self-service account deletion: 설정 > 회원 탈퇴 (current password re-check + typed phrase '탈퇴합니다'). `src/server/account/delete-account.ts` deletes Vault-held integration secrets (`disconnectConnection`), the user's Shorts reference images/frames in Storage, then the auth user (everything else cascades). Login page confirms; privacy policy now points to the self-service path.
  - P2 (fixed) Migration `0050_channel_rows_match_business.sql`: `channel_diagnoses`/`channel_growth_narratives` insert policies also require the channel to belong to the same business (previously a user could file rows against another business's channel id).
  - P2 (fixed) `src/server/shared/ai-number-guard.ts` contained a literal NUL byte, so git treated it as binary (diffs unreviewable). Replaced with the `"\u0000"` escape — same value.
  - Noted: F-006 migration range collision, F-007 no channel removal, F-008 fallback narrative cached for a day.
- **Tests added/updated:** `src/server/account/delete-account.test.ts`, `deleteAccount` cases in `src/app/(auth)/actions.test.ts`, cache cases in `channel-narrative.test.ts`, null-schedule case in `collect-pipeline.test.ts`, `next_snapshot_at` assertion in `register.test.ts`; snapshot/diagnose tests now mock the admin client.
- **Verification:** `npm run lint` ✅, `npm run typecheck` ✅, `npm test` ✅ (111 files / 946 tests), `npm run build` ✅. Local Supabase (`scripts/dev-db.sh`) + `next dev` with `CHANNEL_DATA_PROVIDER=mock`: added `youtube.com/@auditchannel` on /diagnosis → no error, 3 snapshots saved, `next_snapshot_at` ≈ +24h; `/growth-report` shows the channel; `POST /api/cron/collect-metrics` with the secret → `{"processed":1,"failed":0}` (401 without it); account deletion with a throwaway user → auth user, business and Storage object all gone, redirect to `/login?accountDeleted=1`; 0050 applied locally — mismatched business/channel insert → 42501, matching → ok.
- **User-only actions**
  1. Production DB: apply 0034–0042 (팀원 1) and 0050 — `supabase db push --linked --dry-run` to review, then `supabase db push --linked`. Until 0034+ are applied in production, `/diagnosis` channel features fail there.
  2. Register the daily metrics cron when ready (`docs/person1/METRICS_COLLECTION_CRON.md`): needs the Edge Function `?job=metrics` branch deployed and the `cron.schedule(...)` SQL run. The route itself now works.
  3. Vercel: account deletion and snapshot writes need `SUPABASE_SERVICE_ROLE_KEY` (already required by billing/cron — confirm it is set).
- **Next run priorities:** F-006 (confirm teammates know), F-007 channel removal (팀원 1) or a minimal fix if still missing; review new 팀원 2 commits (credits, refunds/inquiry, Admin `requireAdmin`); F-001..F-004 follow-up; mobile check of /diagnosis and /growth-report charts.
- **Commit:** see git log (`fix(channels)…` 2026-10-11)

### 2026-10-10 (run 1)

- **Start SHA:** `24e1e31` (pulled `ae5a29e`, `24e1e31` from 팀원 2: nav restructure, `/usage`, `/support`, dev-db scripts).
- **Reviewed:** the full `18e1351..24e1e31` diff (nav-config, sidebar/header, usage/support pages, middleware, dev-db scripts); auth actions and forms; middleware route gating; billing webhook + mock/toss providers (mock webhook refuses external calls, toss enforces `test_` keys — OK); public layout/footer; SEO files.
- **Findings & fixes**
  - P1 (fixed) No password reset at all, and no `/auth/callback` route — Supabase email links (sign-up confirmation, recovery) could not establish a session in the app. Added `src/app/auth/callback/route.ts` (PKCE `code` and `token_hash` links, same-site `next` only), `/forgot-password` (same reply whether or not the account exists), `/reset-password` (only accepted with an httpOnly 15-min marker cookie minted by the callback, so a stolen session cookie can't change the password without the current one), and a "비밀번호 변경" section in 설정 that re-checks the current password.
  - P2 (fixed) Sign-up showed raw English Supabase errors (`error.message`). Added `src/lib/auth-errors.ts` (Korean messages by error code; raw text is never echoed). Sign-up confirmation now goes through `/auth/callback` back to onboarding.
  - P2 (fixed) Middleware matched protected routes with bare `startsWith` (e.g. `/supporters` was gated, `/login-help` bounced). Moved the lists into `src/lib/supabase/route-access.ts` with segment-boundary matching.
  - P2 (fixed) No terms of service / privacy policy and no consent at sign-up. Added `/terms`, `/privacy` (school-project demo notice, Toss test-mode/no real charge, AI-generated content notice per the AI Basic Act, processors list, deletion on request), a required consent checkbox (validated on the server), and footer links with a demo notice.
  - P2 (fixed) No `robots.txt` / `sitemap.xml`. Added both; app routes, `/api/`, `/auth/` are disallowed (derived from the protected-route list).
- **Tests added:** `src/app/(auth)/actions.test.ts` (consent, Korean errors, no account enumeration, rate-limit message, recovery-marker requirement, current-password check), `src/app/auth/callback/route.test.ts` (off-site `next`, recovery marker, expired link), `src/lib/supabase/route-access.test.ts`.
- **Verification:** `npm run lint` ✅, `npm run typecheck` ✅, `npm test` ✅ (73 files / 646 tests), `npm run build` ✅. Browser smoke test against local Supabase (`scripts/dev-db.sh`) + Mailpit: forgot-password → real recovery email → callback → reset page → new password accepted by GoTrue; 설정 password change rejects a wrong current password and succeeds with the right one; `/reset-password` without session redirects to login; `/terms` at 375px has no horizontal scroll; `/robots.txt` and `/sitemap.xml` render. Found and fixed during the smoke test: in `next dev`, `request.url`/`nextUrl` report `localhost` even when the browser used `127.0.0.1`, which dropped the new session cookie — the callback now redirects on `NEXT_PUBLIC_SITE_URL` (the origin the email link is built from).
- **User-only actions**
  1. Supabase Dashboard → Authentication → URL Configuration: set **Site URL** to the production domain and add `https://<production-domain>/auth/callback` (and `http://localhost:3000/auth/callback` for local) to **Redirect URLs**. Without it Supabase ignores the `redirectTo` and falls back to the Site URL (reset links would land on the home page instead of the reset form).
  2. Confirm Vercel `NEXT_PUBLIC_SITE_URL` is the production URL (used for email links, robots and sitemap).
  3. Supabase Free's built-in mailer is rate-limited (a few emails per hour). For the demo that is fine; for more, configure custom SMTP in Supabase Auth settings.
  - No new migration in this run (DB stays at 0001–0033).
- **Next run priorities:** F-005 account deletion; re-review teammate commits (channel diagnosis YouTube/Naver/Tistory, credits, admin `requireAdmin`); SSRF/prompt-injection review of any new external-fetch code; F-001..F-004 follow-up with owners.
- **Commit:** `f8b77b0` (feat(auth): password reset, auth callback, terms/privacy, robots/sitemap)
