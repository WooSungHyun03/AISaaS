-- Ticket 1-7 (성장 리포트 개편 + 차트): caches the AI interpretation of one
-- channel's growth deltas for one period (7/30/90일) so the growth report
-- doesn't call the AI on every page load — only when nothing was
-- generated yet today (KST) for this exact (channel, days) pair. See
-- src/server/channels/growth-narrative.ts.
--
-- Same "insert-only, caller picks the newest row" shape as channel_diagnoses
-- (0035) and channel_diagnosis_attempts (0041) — regenerating for the same
-- day inserts a new row instead of overwriting, so no update RLS policy
-- is needed (an UPDATE ... ON CONFLICT would require one).
create table public.channel_growth_narratives (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  channel_id uuid not null references public.tracked_channels (id) on delete cascade,
  days integer not null check (days in (7, 30, 90)),
  narrative text not null,
  ai_used boolean not null,
  created_at timestamptz not null default timezone('utc', now())
);

-- The cache-hit check is "newest row for this (channel_id, days) that was
-- created today (KST)" — this index serves exactly that lookup.
create index channel_growth_narratives_channel_days_idx on public.channel_growth_narratives (channel_id, days, created_at desc);

alter table public.channel_growth_narratives enable row level security;

-- Same ownership pattern as channel_diagnoses/channel_diagnosis_attempts:
-- select/insert only, re-checked against businesses.owner_id. No
-- update/delete policy.
create policy "channel_growth_narratives_select_own" on public.channel_growth_narratives
  for select using (
    exists (
      select 1 from public.businesses b
      where b.id = channel_growth_narratives.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "channel_growth_narratives_insert_own" on public.channel_growth_narratives
  for insert with check (
    exists (
      select 1 from public.businesses b
      where b.id = channel_growth_narratives.business_id
        and b.owner_id = auth.uid()
    )
  );
