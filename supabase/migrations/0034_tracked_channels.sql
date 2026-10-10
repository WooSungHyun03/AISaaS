-- Ticket 1-1 (채널 진단 도메인 모델): the channels a business wants diagnosed
-- and periodically re-measured. One row per (business, platform, channel),
-- seeded today from businesses.sns_links (youtube/naver_blog) or added
-- manually (tistory, including a custom domain picked via platformHint in
-- src/server/channels/url-parser.ts) by a later ticket's UI — this
-- migration only adds the table itself.
create table public.tracked_channels (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  -- Allowed values enforced below by a check constraint; single source of
  -- truth is src/server/channels/platform.ts (CHANNEL_PLATFORMS).
  platform text not null,
  -- Stable id within the platform (YouTube channel id or @handle, Naver
  -- blogId, Tistory subdomain/custom host) — see parseChannelUrl().
  external_id text not null,
  url text not null,
  -- Allowed values enforced below by a check constraint; single source of
  -- truth is src/server/channels/status.ts (TRACKED_CHANNEL_STATUSES).
  status text not null default 'ACTIVE',
  -- Null until a (future ticket's) scheduler assigns the next poll time.
  next_snapshot_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  -- Registering the same channel twice for the same business must fail
  -- instead of creating a duplicate tracking row (same shape as
  -- integration_connections' `unique (business_id, provider)`).
  unique (business_id, platform, external_id),
  -- Any FUTURE migration changing the allowed values must drop and re-add
  -- a constraint named `tracked_channels_platform_check` (same name) —
  -- platform.test.ts finds the highest-numbered migration mentioning that
  -- name and asserts it matches CHANNEL_PLATFORMS.
  constraint tracked_channels_platform_check check (platform in ('youtube', 'naver_blog', 'tistory')),
  -- Same convention as platform above, matched by status.test.ts against
  -- `tracked_channels_status_check`.
  constraint tracked_channels_status_check check (status in ('ACTIVE', 'PAUSED', 'ERROR'))
);

-- Mirrors automations_due_idx (0005_automations.sql): the future scheduler's
-- "which channels are due for a snapshot" query only ever needs ACTIVE rows.
create index tracked_channels_due_idx on public.tracked_channels (next_snapshot_at) where status = 'ACTIVE';

create trigger set_tracked_channels_updated_at
  before update on public.tracked_channels
  for each row execute function public.set_updated_at();

alter table public.tracked_channels enable row level security;

-- Same ownership pattern as marketing_diagnoses (0028): every policy
-- re-checks business_id against businesses.owner_id rather than trusting a
-- business_id passed in from the client. No update/delete policy yet —
-- status/next_snapshot_at are only ever written by the (future) scheduler
-- via the service-role client, which bypasses RLS.
create policy "tracked_channels_select_own" on public.tracked_channels
  for select using (
    exists (
      select 1 from public.businesses b
      where b.id = tracked_channels.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "tracked_channels_insert_own" on public.tracked_channels
  for insert with check (
    exists (
      select 1 from public.businesses b
      where b.id = tracked_channels.business_id
        and b.owner_id = auth.uid()
    )
  );
