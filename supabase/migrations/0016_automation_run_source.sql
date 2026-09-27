-- Day 5 (Automation Runner Reliability): tag every run with how it was
-- triggered, so the dashboard/audit trail can distinguish a manual
-- "Run Now" click from a cron-triggered scheduled run.
alter table public.automation_runs
  add column source text not null default 'SCHEDULED' check (source in ('MANUAL', 'SCHEDULED'));

-- Existing rows predate this column and were all cron-triggered in
-- practice (manual "Run Now" is a newer, lower-volume path) — the default
-- above already backfills them correctly, this comment just documents why
-- no separate backfill UPDATE is needed.
