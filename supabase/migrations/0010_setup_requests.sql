create table public.setup_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  business_id uuid references public.businesses (id) on delete set null,
  automation_type text not null,
  description text,
  budget_range text,
  status text not null default 'REQUESTED'
    check (status in ('REQUESTED', 'CONTACTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index setup_requests_user_id_idx on public.setup_requests (user_id);

create trigger set_setup_requests_updated_at
  before update on public.setup_requests
  for each row execute function public.set_updated_at();
