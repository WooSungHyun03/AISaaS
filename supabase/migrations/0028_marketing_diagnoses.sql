-- Website/manual marketing diagnosis results (Dev3 ticket: homepage URL
-- marketing diagnosis). src/server/marketing/calendar.ts already reads this
-- table (as a read-only, loosely-typed dependency — see its
-- getLatestDiagnosis()) and reserved migration numbers 0028/0029 for it, so
-- this intentionally uses 0028 rather than renumbering around it.
create table public.marketing_diagnoses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  source_type text not null check (source_type in ('website', 'manual')),
  source_url text,
  score integer not null check (score >= 0 and score <= 100),
  missing_channels text[] not null default '{}',
  content_status text not null,
  sns_activity text not null,
  recommendations text[] not null default '{}',
  raw_summary text,
  created_at timestamptz not null default timezone('utc', now())
);

-- Most recent diagnosis for a business is read far more often than the full
-- history (see getLatestDiagnosis's `order(created_at desc).limit(1)`).
create index marketing_diagnoses_business_id_idx
  on public.marketing_diagnoses (business_id, created_at desc);

alter table public.marketing_diagnoses enable row level security;

-- Same ownership pattern as business_faqs (0022_business_faqs.sql): every
-- policy re-checks business_id against businesses.owner_id rather than
-- trusting a business_id passed in from the client. Diagnoses are
-- immutable records (no update/delete policy) — a new diagnosis is a new row.
create policy "marketing_diagnoses_select_own" on public.marketing_diagnoses
  for select using (
    exists (
      select 1 from public.businesses b
      where b.id = marketing_diagnoses.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "marketing_diagnoses_insert_own" on public.marketing_diagnoses
  for insert with check (
    exists (
      select 1 from public.businesses b
      where b.id = marketing_diagnoses.business_id
        and b.owner_id = auth.uid()
    )
  );
