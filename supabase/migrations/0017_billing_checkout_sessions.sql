-- Server-only checkout state. Sensitive Toss identifiers must never live in
-- subscriptions because users can read their own subscription row through RLS.
create table public.billing_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan text not null check (plan in ('STARTER', 'PRO')),
  provider text not null check (provider in ('mock', 'toss')),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED')),
  customer_key text not null unique,
  order_id text not null unique,
  provider_billing_key text,
  provider_payment_key text,
  error_code text,
  error_message text,
  expires_at timestamptz not null default (timezone('utc', now()) + interval '30 minutes'),
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index billing_checkout_sessions_user_created_idx
  on public.billing_checkout_sessions (user_id, created_at desc);

create trigger set_billing_checkout_sessions_updated_at
  before update on public.billing_checkout_sessions
  for each row execute function public.set_updated_at();

alter table public.billing_checkout_sessions enable row level security;

-- Intentionally no authenticated-user policy. Every read/write goes through
-- trusted billing server code using the service-role client.
