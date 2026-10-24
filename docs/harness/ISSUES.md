# Quality loop issue register

This table is maintained by **Claude Sonnet 5.5** when operating the harness. The entries below are not claims that production was tested. For each issue, replace placeholders only after reproducing it.

| ID | Priority | Domain | Environment & exact reproduction | Root cause evidence | Fix and regression test | State |
|---|---|---|---|---|---|---|
| H-001 | P1 | tooling | LOCAL (UNIT): `npm run harness:verify` → `unit tests` FAIL: Vitest also collects `scripts/harness/*.test.mjs` ("No test suite found") | `vitest.config.mts` had no exclude for the node:test files | `exclude: scripts/harness/**`; `npm test` 140 files pass again, `npm run harness:test` 4/4 | FIXED (UNIT) |
| H-002 | P1 | performance | LOCAL_E2E/PERF_LOCAL: `harness:perf` → growth toggles made 1–4 requests (budget 0): background AI-reading POST per first view of a period even with the mock AI, and the favicon re-fetch the browser does on `history.replaceState` was counted as app traffic | `GrowthReportView` always asked for the AI reading; `measure.mjs` filter missed `?favicon…ico` | `GrowthBundle.aiNarratives` (false with `AI_PROVIDER=mock`) + `shouldRequestNarrative()` (unit-tested); `.ico` ignored in the probe. Re-run: 6/6 toggles ≤122 ms, 0 requests | FIXED (UNIT + PERF_LOCAL) |
| H-003 | P0 | ai / config drift | STATIC + PROD_READ_ONLY: Vercel **Production** scope has `ALLOW_MOCK_AI` (set Oct 13). With `AI_PROVIDER=mock` that opt-in lets mock-written content be served as real results in production (`AI_PROVIDER`'s value is a locked secret: NOT_VERIFIED) | `isMockAiBlocked()` honoured the opt-in on any production build | Ignored when `VERCEL_ENV=production`; regression test in `mock-guard.test.ts` fails before the fix. **Action for the owner:** make sure Production has `AI_PROVIDER=anthropic`, and delete `ALLOW_MOCK_AI` from Production | FIXED (UNIT); prod value NOT_VERIFIED |
| H-004 | — | harness coverage | The seeded-account E2Es never exercised a person who has just signed up | Added `npm run e2e:journey` (signup → onboarding → pages → first blog post → one credit used → no second post without credit → logout/login → isolation, PC + phone) and `scripts/e2e/monkey-sweep.mjs` (clicks every safe control, fails on console/5xx/error screens); both wired into `harness:demo` | no defect found: all green | PASS (LOCAL_E2E) |
| H-005 | P1 | ui | LOCAL_E2E: `monkey-sweep` (dev build) → opening any blog post's result page logs React "two children with the same key" for `소금빵`, `성수동빵집`, `아침빵` | Keyword / SEO-keyword / tag badges were keyed by their text, and AI-written lists can repeat a value (duplicated or missing badges in production) | `uniqueTexts()` applied to the 6 keyword/tag lists (blog result, run page, business page); `src/lib/utils/text.test.ts`; the monkey sweep is the regression gate (clean 4/4 runs after the fix, flagged 4/5 before) | FIXED (UNIT + LOCAL_E2E) |
| H-006 | P1 | schedule | STATIC + LOCAL DB: ACTIVE automation, `next_run_at` past, schedule `{WEEKLY, daysOfWeek: []}` → every tick: `claimDueSlot` throws, row stays first in the due list | `planDueClaim` → `computeNextRunAt` throws before the compare-and-set, nothing moves the row | claim parks it (`ERROR`, `next_run_at null`, CAS) and returns `INVALID_SCHEDULE`; `scheduler.db.test.ts` (fails pre-fix) | FIXED (UNIT, local DB) |
| H-007 | P2 | security / ai | STATIC: `loadGrowthNarrative` authorised with the cached JWT check (`getAuthUser`) although it can start a paid AI call and write | rule in `lib/supabase/server.ts` not applied to this action | `auth.getUser()`; `growth-report/actions.test.ts` (fails pre-fix) | FIXED (UNIT) |
| H-008 | P1 | schedule / ai | STATIC: `/calendar` › 계획 항목 › "바로 만들기" for a blog item. The page declared `maxDuration = 60`, the action runs the vision + Opus plan step inline (up to 240 s per call); the run page declared none | Next 16: page `maxDuration` limits every Server Action on the page. Killed function → wasted paid call, run RUNNING until the reaper (10 min), retries refused | both pages 300 s; `src/app/route-durations.test.ts` (fails pre-fix on the two pages) | FIXED (UNIT); prod timeout NOT_VERIFIED |
| H-009 | P0 | shorts / ai | PROD (user report, run 90d35af1…): ad-video run fails in the planner step: "AI response did not match the expected structure after 2 attempts" (the 300-char raw hid which rule). The failing field is NOT_VERIFIED | `makeAdPlanSchema` rejects the whole plan for an optional `inserts`/`references` entry the owner cannot have; the prompt's own JSON example shows `inserts: [{imageIndex: 2…}]`, so a plan with no 'exact' image is rejected twice. The retry also only said "not valid JSON" | `makeAdPlanDraftSchema` drops such entries (rest still strict); `generateStructured` retry and final error now carry the zod issue paths. `ad-plan.test.ts` (draft tests) and `generate.test.ts`. If it still fails, the error names the rule | FIXED for the insert/reference cause (UNIT); live planner call NOT_VERIFIED |
| H-010 | P0 | shorts / assets | PROD (own account, run b316541e…): ad video run fails after the credit is reserved. fal (`alibaba/wan-3.0/reference-to-video`, request 01a16bb4/01a16bb5, both HTTP 422, cost $0.00): `reference_image_urls.0: Image dimensions are too small. Minimum dimensions are 240x240 pixels.` The owner's photo is 225x225 | Reference photos were never measured: no check at upload, none before submit. The model rejects the job after queueing; the run retried the same input once and failed with a generic message. The provider's reason was only in a log line that did not reach Vercel's runtime log | `ensureMinimumImageSize` / `resolveImageUrls` (assets.ts): a photo whose shorter side is under 240 px is enlarged (Lanczos, aspect kept) into `<id>-min240.png` beside the original and that copy is sent; under 64 px it is refused with a plain sentence before any spend. `assets-image-size.test.ts` (6) | FIXED (UNIT); live video NOT_VERIFIED until re-run |
| H-011 | P0 | shorts | PROD (own account, run a4e11986…, after H-010 was fixed): fal accepted the job (request 01a16bbf, running 12 min), then the run ended with "진행 중인 숏폼 작업 정보를 읽지 못했어요" at 11:42, the credit was returned and the generated video was lost (a billed generation). Which provider field was null is NOT_VERIFIED | The saved job state is JSON; the finished job's `generated` block stored `seed`/`actualPrompt`/`durationSec` exactly as the provider returned them. A `null` is kept by JSON (undefined is not) and the zod schema's optional fields reject null, so the next `resumeRun` failed to parse | `resumeRun` parses `withoutNulls(raw)` (no state field uses null) and logs the zod issue paths (`shorts_job_state_unreadable`); `fal.ts` returns `undefined` for non-number / non-string values. Tests: handler test with a JSON round-trip and nulls (fails pre-fix with the production message), `withoutNulls`, fal provider null values | FIXED (UNIT); live video NOT_VERIFIED until re-run |

Findings that were checked and are **not** defects (evidence, not guesses): `profiles` can only be updated by the user in `display_name` (column privilege), so a suspended user cannot un-suspend through the API; `tracked_channels` has an INSERT policy but no UPDATE policy for customers; every service-role write in Server Actions re-reads the row through the caller's RLS client first (`removeTrackedChannel`, `updateContentHistory`, shorts publishing); mobile sign-out lives in the header's account menu (not in the drawer).

## Loop journal template

### Iteration N — YYYY-MM-DD

- Git SHA / branch:
- Scoped audit / baseline command / output:
- Finding with expected vs actual:
- Smallest failing reproduction:
- Fix and why this resolves root cause:
- New/updated test and result:
- `harness:verify` / `harness:demo` / `harness:perf` results:
- EVIDENCE: STATIC / UNIT / LOCAL_E2E / PERF_LOCAL / PROD_READ_ONLY / NOT_VERIFIED
- Remaining P0/P1 blockers:
- PR and commit:

Keep this journal concise; avoid copying secrets, complete user records, verbose API responses or generated videos into git.


### Iteration 1 — 2026-10-21

- Git SHA / branch: `6f7d4e5` + working tree, `chore/quality-harness`
- Baseline: `harness:test` 4/4, `harness:audit` PASS, `harness:focus` schedule/assets/growth/ai/billing/security/ui/performance all PASS (80/22/73/85/41/29/26/39 tests)
- Findings: H-001, H-002, H-003, H-005 (above); H-004 is added coverage
- `harness:verify`: lint, typecheck, 1316 unit tests, production build, `git diff --check` — PASS after H-001
- `harness:demo` (local seeded DB, mock providers, production build): scheduled blog/Shorts, reference photos, channel collection, admin access, guide pages, new-user journey, PC/phone page sweep, monkey sweeps, credit-ledger DB, RLS/scheduler/growth/budget DB tests — all PASS on `next dev` + mock providers after H-005 (a first run on a production build failed two gates only because that build refuses mock data by design: see the server-mode note in docs/HARNESS.md)
- `harness:perf`: 6/6 growth controls ≤250 ms, 0 requests (best 47 ms, worst 122 ms, warm session, local DB)
- EVIDENCE: UNIT / LOCAL_E2E / PERF_LOCAL / STATIC; production only read-only (Vercel env names, public health endpoints)
- NOT_VERIFIED: live fal/Wan video, live Claude calls, the real 06:00 KST tick and the first real scheduled content, YouTube/Naver/Tistory live responses, Supabase hosted storage limits, `AI_PROVIDER`/`AD_VIDEO_PROVIDER` values in Vercel (locked), FFmpeg worker deployment (no worker URL configured)
