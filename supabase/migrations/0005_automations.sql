create table public.automations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  template_id uuid not null references public.automation_templates (id) on delete restrict,
  name text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'PAUSED', 'ERROR')),
  schedule jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index automations_user_id_idx on public.automations (user_id);
create index automations_business_id_idx on public.automations (business_id);
-- Used by the scheduler's findDueAutomations() query.
create index automations_due_idx on public.automations (status, next_run_at) where status = 'ACTIVE';

create trigger set_automations_updated_at
  before update on public.automations
  for each row execute function public.set_updated_at();
