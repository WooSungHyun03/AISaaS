# Claude Daily Quality Audit

Scheduled routine (2026-10-10 ~ 2026-10-26 KST). Each run reviews the latest
`main`, fixes what it finds, verifies, and pushes. The next run starts its
"new changes" review from the **last reviewed SHA** below.

**Last reviewed SHA:** `24e1e31` (2026-10-10 run — update the line on every run)

## Open findings (carry over until fixed)

| ID | Sev | Area / owner | Finding | Status |
|---|---|---|---|---|
| F-001 | P2 | layout / 팀원 2 | `/business` is no longer in `APP_NAV`; on that page no sidebar item is active. Pages still link to it (diagnosis, blog, shorts, growth report). Decide whether it lives under 설정 or 마케팅 진단 (`activePaths`). | open |
| F-002 | P2 | usage / 팀원 2 | `/usage` re-exports the history page's default only, so it has no `metadata` title (tab shows the site default). `/settings` also has no title. | open |
| F-003 | P1 | support / 팀원 2 | `/support` shows FAQ only — no way to send an inquiry. Terms/privacy now tell users to request refunds and account deletion via 문의, so the inquiry form is needed. | open (teammate ticket in progress) |
| F-004 | P2 | dashboard / 팀원 2 | Dashboard still shows "진행 중인 만들기 설정 / 다음 제작 예정" stats from `automations`, but every `/automations` entry point was removed from navigation. | open |
| F-005 | P1 | account | No self-service account deletion (privacy policy promises deletion on request). Needs a server action using the admin client + confirmation dialog. | open — next run |

## Run log

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
- **Commit:** see `git log` (message `feat(auth): password reset, auth callback, terms/privacy, robots/sitemap`).
