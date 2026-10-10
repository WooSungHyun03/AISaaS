-- Ticket 1-5 (채널 진단 화면·액션 개편): per-business hourly limit on
-- user-triggered channel diagnoses (src/server/channels/diagnosis-rate-limit.ts).
-- One row per actual collector call (cache miss) — a cache hit never
-- inserts here, so this table's row count for the last hour IS the limit
-- window. Scoped to business_id, not channel_id, because the limit is
-- "5 진단 시도/시간 per 사업" regardless of which channel.
create table public.channel_diagnosis_attempts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now())
);

-- The limit check is "count rows for this business_id newer than 1 hour
-- ago" — this index serves exactly that query.
create index channel_diagnosis_attempts_business_id_idx on public.channel_diagnosis_attempts (business_id, created_at desc);

alter table public.channel_diagnosis_attempts enable row level security;

-- Same ownership pattern as channel_diagnoses (0035): select/insert only,
-- re-checked against businesses.owner_id. No delete policy — rows older
-- than a day are pruned by the service-role client (bypasses RLS), not by
-- the end user; see diagnosis-rate-limit.ts's cleanupOldAttempts.
create policy "channel_diagnosis_attempts_select_own" on public.channel_diagnosis_attempts
  for select using (
    exists (
      select 1 from public.businesses b
      where b.id = channel_diagnosis_attempts.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "channel_diagnosis_attempts_insert_own" on public.channel_diagnosis_attempts
  for insert with check (
    exists (
      select 1 from public.businesses b
      where b.id = channel_diagnosis_attempts.business_id
        and b.owner_id = auth.uid()
    )
  );
