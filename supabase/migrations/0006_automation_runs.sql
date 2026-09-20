create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations (id) on delete cascade,
  status text not null default 'QUEUED' check (status in ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED')),
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index automation_runs_automation_id_idx on public.automation_runs (automation_id, created_at desc);
-- Enforces "no duplicate in-flight run" at the database level as a second
-- line of defense behind the application-level check in the runner.
create unique index automation_runs_one_inflight_idx
  on public.automation_runs (automation_id)
  where status in ('QUEUED', 'RUNNING');
