# Acceptance matrix — Easy Marketing demo SaaS

Use this list to prioritize and record **measurable** results. Do not turn it into a new-feature backlog. Each row requires code path inspection and a relevant automated test; live claims require independent evidence.

| Scope | Priority | What must work | Negative or boundary case | Evidence |
|---|---|---|---|---|
| Account, business and admin | P0 | Signup/login/logout; user owns only their business and generated content; server-side admin gate; correct redirects | Unauthenticated call, cross-user record, forged admin role; RLS remains active | `security` focus + local admin E2E + targeted RLS DB tests |
| Blog | P0 | Business brief + uploaded photos → AI draft → fact/quality gate → usable history/guide; user edits intact | Empty facts, unsupported image, AI timeout, mock visible in production | `ai` + `assets` focus, reference photo E2E |
| Shorts | P0 | Business photo → signed upload → provider reference → render/postprocess → playable stored video and history | Missing model/worker keys yields explicit *not generated*; invalid file; duplicate clicks; worker fails | `assets`/`ai` tests + reference photo E2E; live creation separately labeled |
| Credits and budget | P0 | Atomic 1 run/1 credit; estimated external cost under monthly cap; failure returns credit appropriately | Double-click, concurrent cron, retries, partial fal charge, expired grant | `billing`/`ai` focus, local ledger DB tests |
| Recurring automation | P0 | Scheduled weekdays KST, correct status, one valid slot → one result; retries and missed slots bounded | UTC midnight, disabled job, stale run, duplicate cron ticks, provider down | `schedule` focus + `e2e:schedule` incl generated history |
| Public channel collection | P0 | Register public YouTube/blog URL, daily 06:00 KST collection, true snapshots; recover transient errors | API quota, robots disallow, 404/429, no data, long outage; never fabricate traffic | `growth` focus + `e2e:collection`, DB historical checks |
| Growth report | P0/P1 | 7/30/90 and daily/weekly/monthly render correct aggregated real snapshots | First day no change, missing metrics, new data and stale cache, click races | growth bundle unit + performance measurements, 6/6 toggles |
| UX and guide | P1 | Navigable sidebar, consistent statuses, clear errors, real screenshots, desktop/mobile | 404/blank CTA, duplicate buttons, mobile overflow, inaccessible form | `ui` focus + local guide E2E + page sweep |
| Performance | P1 | Growth toggles select in ≤250ms and do no extra network calls in representative local demo; pages measured | 90d dataset, rapid consecutive clicks, slow DB proxy, unnecessary AI wait | `harness:perf` warm-session measurement and regression log |
| Deploy | P0 | `main` compatible migrations + env, scheduled trigger, healthy server, real bundle; no secrets | Missing production provider, stale migrations, missing cron secret, rollback path | `harness:verify`, CI, staging/deploy logs; prod read-only |

## State definitions

- **PASS**: relevant test output and/or verified user journey is attached, with explicit environment.
- **FAIL**: reproducible break. Create/update an issue and loop.
- **BLOCKED**: cannot test due to missing authorized credential, environment or external service; never mark PASS.
- **NOT TESTED**: not yet exercised, including live AI calls intentionally avoided.

## Risk notes from the 2026-10-21 code audit

- Local mock tests already cover many flows. They **do not** verify production Supabase bucket limits, live fal output, live OAuth, provider credits or the next real 06:00 tick.
- The current scheduler may have a backup Vercel Cron but its presence in `vercel.json` does **not** prove its delivery or the actual content history. Use job heartbeats and source records.
- Naver RSS may disallow crawler access; show unavailability and use permitted official sources, never mark missing traffic as zero.
- Private uploads must use signed access and per-user authorisation; frontend hints are not authorization.
- In a student demo, sandbox/mock billing must be clearly labeled. Business-registration-gated real settlement, tax/accounting and operational chargebacks are not acceptance gates.
