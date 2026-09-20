create table public.content_history (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  automation_id uuid not null references public.automations (id) on delete cascade,
  content_type text not null,
  title text,
  topic text,
  content text,
  external_url text,
  created_at timestamptz not null default timezone('utc', now())
);

create index content_history_business_id_idx on public.content_history (business_id, created_at desc);
-- Used by handlers to avoid repeating a recent topic for the same automation.
create index content_history_automation_id_idx on public.content_history (automation_id, created_at desc);
