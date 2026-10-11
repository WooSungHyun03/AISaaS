-- Customer refund requests. The actual payment refund remains a separate,
-- reviewed service-role operation; this table records the request and the
-- server-calculated snapshot used for that review.

create table public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid not null references public.billing_orders(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 10 and 2000),
  status text not null default 'REQUESTED'
    check (status in ('REQUESTED', 'REVIEWING', 'APPROVED', 'REJECTED', 'REFUNDED')),
  credit_amount_snapshot integer not null check (credit_amount_snapshot > 0),
  used_credits_snapshot integer not null check (
    used_credits_snapshot >= 0 and used_credits_snapshot <= credit_amount_snapshot
  ),
  unused_credits_snapshot integer not null check (
    unused_credits_snapshot >= 0 and unused_credits_snapshot <= credit_amount_snapshot
  ),
  expected_refund_krw integer not null check (expected_refund_krw >= 0),
  policy_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_requests_credit_snapshot_check check (
    used_credits_snapshot + unused_credits_snapshot = credit_amount_snapshot
  ),
  constraint refund_requests_one_per_order unique (order_id)
);

create index refund_requests_user_created_idx
  on public.refund_requests(user_id, created_at desc);
create index refund_requests_status_created_idx
  on public.refund_requests(status, created_at asc);

create trigger set_refund_requests_updated_at
  before update on public.refund_requests
  for each row execute function public.set_updated_at();

alter table public.refund_requests enable row level security;

create policy "Users can view own refund requests"
  on public.refund_requests for select
  using (auth.uid() = user_id);

-- A customer submits through the server action so order ownership and the
-- refund snapshot are recalculated with the service role. Customers may read
-- only their own rows and cannot forge or change the review state directly.
revoke all on table public.refund_requests from anon, authenticated;
grant select on table public.refund_requests to authenticated;
grant all on table public.refund_requests to service_role;

