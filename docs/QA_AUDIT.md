# QA / architecture audit (2026-10)

Source of truth: the repository and running code, not the ticket documents. Each
item below was checked by reading the code **and** by running it (unit tests, a
local Supabase with every migration applied, and a browser pass through the
main flows). Status words: `COMPLETE`, `FIXED` (was partial/broken, fixed in
this audit), `PARTIAL`, `BLOCKED_EXTERNAL` (needs an approval/credential/cost
decision outside the repo).

## Feature status

| Area | Status | Notes |
| --- | --- | --- |
| Marketing diagnosis (website) | FIXED | Score is now computed from measured signals (`server/marketing/scoring.ts`), with a persisted per-item breakdown. The AI only writes a short narrative and *evidence-quoted* profile suggestions; an AI failure no longer fails the diagnosis. Homepage fetch was **non-functional on Node ≥ 20** (pinned DNS lookup used the wrong callback shape) — fixed and covered by a no-mock regression test. |
| SNS diagnosis | PARTIAL / BLOCKED_EXTERNAL | Only links found on the homepage, saved on the profile (host-validated) and connected accounts are counted. Activity/engagement needs official API permissions and is reported as "cannot be checked", never estimated. |
| Business profile auto-fill | COMPLETE | Suggestions need a quote that really appears on the page; nothing is saved until the user confirms in the form. |
| Marketing calendar | FIXED | Regeneration replaces the unused part of the old plan, drops repeated topics, is rate-limited, and uses the marketing profile. Any planned item (not only today's) can be turned into content; a draft automation is auto-created when none exists. |
| Blog generation | FIXED | Calendar brief reaches the writer; fact-grounding + anti-AI style rules; one bounded quality rewrite; only escaped `<p>` is stored; paragraphs preserved in history; user can review/edit (`content_history.edited_at`). |
| Shorts generation | COMPLETE | Hook → script → scenes → JSON2Video (TTS + subtitles + 9:16) → preview → manual publish. Publishing is now opt-in (no default Instagram posting); calendar/manual runs are preview-only; YouTube uploads stay private. |
| Shorts rendering architecture | PARTIAL | External render service with bounded polling, but still awaited inside the request (≤ 60 s). `maxDuration` is set and the cron tick has a time budget + stale-run reaper. A fully queued job model is the next step (see Remaining). |
| Growth report | FIXED (was missing) | `/growth-report`: only internal records, each metric tagged by source; external metrics are listed as `UNAVAILABLE`. No AI is involved, so nothing can be invented. |
| Billing / entitlements | FIXED | Per-type quotas enforced on the server and shown in plans/usage. Mock checkout is refused in production unless `ALLOW_MOCK_BILLING=true` (it granted paid plans for free). |
| Scheduler | FIXED | Added `MONTHLY` (clamped to month length). Shared schedule parsing/forms for blog, shorts and settings. |
| Usage counters | FIXED | Atomic `increment_usage` RPC (service role only). |
| RLS | FIXED | `automations` insert/update now require a business owned by the same user (verified against a second user on a live DB). |

## Removed from the main flow (code kept)

- AI tool directory (`/directory`, `server/directory/`) — removed from both navigations; page and sync module remain but nothing schedules the sync.
- Newsletter, customer support widget, Instagram marketing-card automations — `COMING_SOON`, hidden from the catalog. Their tables/modules are kept (no migration edits).
- WordPress delivery — only for automations created before generation-only; new ones can't choose it.

Nothing was deleted from `supabase/migrations/`. Dropping legacy tables would need a new migration and a product decision.

## Remaining (needs a decision, credential or cost)

1. Duplicate migration version `0018_*` (two files) and `0027` storage RLS need cleanup on the real project (do not rename applied migrations blindly).
2. Content-Security-Policy (needs a nonce rollout that also covers the Toss SDK).
3. Queue-based Shorts rendering (create job → poll/webhook → publish) instead of awaiting inside the request.
4. External performance metrics (YouTube Analytics / Instagram Insights scopes + app review).
5. Production billing: switch `BILLING_PROVIDER=toss` with live keys; mock is blocked in production by default.
6. TikTok needs API audit.
