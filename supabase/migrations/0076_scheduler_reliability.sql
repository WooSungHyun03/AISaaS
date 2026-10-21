-- Scheduler reliability + observability (2026-10-21).
--  1. automations.consecutive_failures: a single failed scheduled run no longer parks the schedule forever; the
--     runner counts consecutive SCHEDULED failures and only parks the automation (status ERROR) after a few in a row.
--  2. scheduler_ticks: one row per cron tick (service role only) so the admin and /api/health/scheduler can say when
--     the scheduler last ran and what it did — "the cron endpoint answered" is not the same as "it produced content".
--  3. tracked_channels.last_success_at: the last time a collection really measured something (last_collected_at also
--     moves on failed attempts). Collection no longer pauses a channel on transient errors, so paused channels are
--     probed again: the due index now covers them.
--  4. A read index for the growth report (a channel's snapshots in time order).
-- Nothing existing is modified or deleted; every new column is nullable or has a default.

alter table public.automations
  add column if not exists consecutive_failures smallint not null default 0 check (consecutive_failures >= 0);

alter table public.tracked_channels
  add column if not exists last_success_at timestamptz;

-- Rows collected successfully before this column existed: their last success is the last collection.
update public.tracked_channels
   set last_success_at = last_collected_at
 where last_success_at is null and last_collection_status = 'SUCCESS' and last_collected_at is not null;

create table if not exists public.scheduler_ticks (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  trigger text not null default 'CRON' check (trigger in ('CRON', 'VERCEL_CRON', 'MANUAL')),
  due_found integer not null default 0 check (due_found >= 0),
  started integer not null default 0 check (started >= 0),
  succeeded integer not null default 0 check (succeeded >= 0),
  failed integer not null default 0 check (failed >= 0),
  skipped integer not null default 0 check (skipped >= 0),
  advanced integer not null default 0 check (advanced >= 0),
  reaped integer not null default 0 check (reaped >= 0),
  channels_processed integer not null default 0 check (channels_processed >= 0),
  error text check (error is null or char_length(error) <= 2000)
);
create index if not exists scheduler_ticks_started_idx on public.scheduler_ticks (started_at desc);
-- RLS on, no policy: only the service role (the cron route and the admin pages) reads or writes it.
alter table public.scheduler_ticks enable row level security;

-- Due lookups also cover channels paused after a long error streak (they are probed again, see collect-pipeline.ts).
drop index if exists public.tracked_channels_due_idx;
create index tracked_channels_due_idx on public.tracked_channels (next_snapshot_at) where status in ('ACTIVE', 'PAUSED');

create index if not exists marketing_metric_snapshots_channel_recorded_idx
  on public.marketing_metric_snapshots (channel_id, recorded_at);
