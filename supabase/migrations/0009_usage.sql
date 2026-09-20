-- One row per user per calendar month (period = 'YYYY-MM' in the service
-- timezone, Asia/Seoul). Incremented by the runner/AI layer, read by
-- server/billing/entitlements.ts to enforce plan limits.
create table public.usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  period text not null,
  automation_runs integer not null default 0,
  ai_generations integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, period)
);

create trigger set_usage_updated_at
  before update on public.usage
  for each row execute function public.set_updated_at();
