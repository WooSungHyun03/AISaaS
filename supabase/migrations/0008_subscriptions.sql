create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  plan text not null default 'FREE' check (plan in ('FREE', 'STARTER', 'PRO')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED', 'INCOMPLETE')),
  provider text not null default 'mock',
  provider_customer_id text,
  provider_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger set_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- Every new user starts on FREE so entitlement checks never have to
-- special-case "no subscription row yet".
create or replace function public.handle_new_profile_subscription()
returns trigger as $$
begin
  insert into public.subscriptions (user_id, plan, status, provider)
  values (new.id, 'FREE', 'ACTIVE', 'mock');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_profile_created_subscription
  after insert on public.profiles
  for each row execute function public.handle_new_profile_subscription();
