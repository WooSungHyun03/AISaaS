-- Ticket 1-1 (채널 진단 도메인 모델): one immutable diagnosis row per
-- (channel, point in time) — same "new diagnosis is a new row, no
-- update/delete" shape as marketing_diagnoses (0028).
create table public.channel_diagnoses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  channel_id uuid not null references public.tracked_channels (id) on delete cascade,
  overall_score integer not null check (overall_score >= 0 and overall_score <= 100),
  activity_score integer not null check (activity_score >= 0 and activity_score <= 100),
  consistency_score integer not null check (consistency_score >= 0 and consistency_score <= 100),
  content_score integer not null check (content_score >= 0 and content_score <= 100),
  -- Raw measured values the scores above were computed from. Shape varies
  -- by platform (see src/server/channels/types.ts's ChannelDiagnosis.metrics).
  metrics jsonb not null default '{}'::jsonb,
  findings text[] not null default '{}',
  recommendations text[] not null default '{}',
  -- Allowed values enforced below by a check constraint; single source of
  -- truth is src/server/channels/completeness.ts (CHANNEL_DIAGNOSIS_COMPLETENESS).
  completeness text not null,
  -- Allowed values enforced below by a check constraint; single source of
  -- truth is src/server/channels/snapshot-source.ts (CHANNEL_SNAPSHOT_SOURCES)
  -- — which CHANNEL_DATA_PROVIDER produced this row.
  data_source text not null,
  created_at timestamptz not null default timezone('utc', now()),
  -- Any FUTURE migration changing the allowed values must drop and re-add
  -- a constraint named `channel_diagnoses_completeness_check` (same name) —
  -- completeness.test.ts finds the highest-numbered migration mentioning
  -- that name and asserts it matches CHANNEL_DIAGNOSIS_COMPLETENESS.
  constraint channel_diagnoses_completeness_check check (completeness in ('COMPLETE', 'PARTIAL', 'INSUFFICIENT_DATA')),
  -- Same convention as completeness above, matched by snapshot-source.test.ts
  -- against `channel_diagnoses_data_source_check`.
  constraint channel_diagnoses_data_source_check check (data_source in ('live', 'mock'))
);

-- Dashboard summary (getLatestChannelDiagnosisSummary) reads "every
-- diagnosis for this business, newest first" — same shape as
-- marketing_diagnoses_business_id_idx (0028).
create index channel_diagnoses_business_id_idx on public.channel_diagnoses (business_id, created_at desc);

alter table public.channel_diagnoses enable row level security;

-- Same ownership pattern as marketing_diagnoses (0028): select/insert only,
-- re-checked against businesses.owner_id — immutable records.
create policy "channel_diagnoses_select_own" on public.channel_diagnoses
  for select using (
    exists (
      select 1 from public.businesses b
      where b.id = channel_diagnoses.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "channel_diagnoses_insert_own" on public.channel_diagnoses
  for insert with check (
    exists (
      select 1 from public.businesses b
      where b.id = channel_diagnoses.business_id
        and b.owner_id = auth.uid()
    )
  );
