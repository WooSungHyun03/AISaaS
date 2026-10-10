-- Ticket 1-1 (채널 진단 도메인 모델): one row per metric reading over time
-- (e.g. subscriberCount, uploadsLast28Days), scoped to a tracked_channels
-- row rather than directly to a business — getGrowthSummary() joins
-- through tracked_channels for the business boundary (see RLS below and
-- src/server/channels/summary.ts).
create table public.marketing_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.tracked_channels (id) on delete cascade,
  metric text not null,
  value numeric not null,
  recorded_at timestamptz not null,
  -- src/server/channels/snapshot-source.ts (CHANNEL_SNAPSHOT_SOURCES).
  -- Migration-matches-constant convention — `marketing_metric_snapshots_source_check`,
  -- checked by snapshot-source.test.ts.
  source text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint marketing_metric_snapshots_source_check check (source in ('live', 'mock'))
);

-- getGrowthSummary() reads "every snapshot for these channel ids, newest
-- first within the metric" — matches the ticket's specified index shape.
create index marketing_metric_snapshots_channel_metric_idx
  on public.marketing_metric_snapshots (channel_id, metric, recorded_at desc);

alter table public.marketing_metric_snapshots enable row level security;

-- No business_id column on this table, so ownership is re-checked through
-- tracked_channels -> businesses.owner_id (same two-hop shape as
-- integration_connections' secret-wrapper functions trusting only
-- service_role for writes — but this is a plain owner-read, not a secret).
-- No insert policy: snapshots are only ever written by the (future)
-- snapshot job via the service-role client, which bypasses RLS.
create policy "marketing_metric_snapshots_select_own" on public.marketing_metric_snapshots
  for select using (
    exists (
      select 1 from public.tracked_channels c
      join public.businesses b on b.id = c.business_id
      where c.id = marketing_metric_snapshots.channel_id
        and b.owner_id = auth.uid()
    )
  );
