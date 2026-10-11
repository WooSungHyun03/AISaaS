-- Ticket 2-1 requested 0040, but 0040 already belongs to channel diagnosis.
-- 0051 is the next safe migration number after the repository's existing 0050.

-- Checkout sessions used to accept only STARTER/PRO subscription plans. Keep
-- existing rows, but generalize the persisted identifier for one-time products.
alter table public.billing_checkout_sessions
  rename column plan to product_id;

alter table public.billing_checkout_sessions
  drop constraint if exists billing_checkout_sessions_plan_check;

alter table public.billing_checkout_sessions
  add constraint billing_checkout_sessions_product_id_check
  check (product_id ~ '^[A-Z0-9][A-Z0-9_-]{1,63}$');

create table public.billing_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id text not null
    check (product_id ~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'),
  kind text not null check (kind in ('BLOG', 'SHORTS')),
  credit_amount integer not null check (credit_amount > 0),
  price_krw integer not null check (price_krw >= 0),
  validity_days integer not null check (validity_days > 0),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'PAID', 'CANCELED', 'REFUNDED')),
  provider text not null check (provider in ('mock', 'toss', 'legacy')),
  checkout_session_id uuid unique references public.billing_checkout_sessions (id),
  provider_order_id text unique,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check ((status <> 'PAID' and status <> 'REFUNDED') or paid_at is not null),
  check (status <> 'REFUNDED' or refunded_at is not null)
);

create index billing_orders_user_created_idx
  on public.billing_orders (user_id, created_at desc);

create trigger set_billing_orders_updated_at
  before update on public.billing_orders
  for each row execute function public.set_updated_at();

create table public.credit_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('BLOG', 'SHORTS')),
  amount integer not null check (amount > 0),
  remaining integer not null check (remaining >= 0 and remaining <= amount),
  expires_at timestamptz not null,
  order_id uuid unique references public.billing_orders (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index credit_grants_spend_order_idx
  on public.credit_grants (user_id, kind, expires_at, created_at)
  where remaining > 0;

create trigger set_credit_grants_updated_at
  before update on public.credit_grants
  for each row execute function public.set_updated_at();

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  grant_id uuid references public.credit_grants (id),
  kind text not null check (kind in ('BLOG', 'SHORTS')),
  event_type text not null
    check (event_type in ('GRANT', 'RESERVE', 'SETTLE', 'RELEASE', 'EXPIRE', 'REFUND')),
  delta integer not null,
  balance_after integer check (balance_after is null or balance_after >= 0),
  reservation_id uuid,
  reference_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  check (
    (event_type = 'GRANT' and delta > 0)
    or (event_type = 'RESERVE' and delta < 0)
    or (event_type = 'SETTLE' and delta = 0)
    or (event_type = 'RELEASE' and delta > 0)
    or (event_type in ('EXPIRE', 'REFUND') and delta < 0)
  ),
  check (
    (event_type in ('GRANT', 'RESERVE', 'EXPIRE', 'REFUND') and grant_id is not null)
    or (event_type in ('SETTLE', 'RELEASE') and grant_id is null)
  ),
  check (
    (event_type in ('RESERVE', 'SETTLE', 'RELEASE') and reservation_id is not null)
    or (event_type not in ('RESERVE', 'SETTLE', 'RELEASE') and reservation_id is null)
  )
);

create index credit_ledger_user_created_idx
  on public.credit_ledger (user_id, created_at desc);

create index credit_ledger_grant_created_idx
  on public.credit_ledger (grant_id, created_at)
  where grant_id is not null;

create index credit_ledger_reservation_idx
  on public.credit_ledger (reservation_id, created_at)
  where reservation_id is not null;

-- Exactly one terminal decision per reservation. RELEASE uses one aggregate
-- row even when the reservation was allocated from several grants.
create unique index credit_ledger_reservation_terminal_unique
  on public.credit_ledger (reservation_id)
  where event_type in ('SETTLE', 'RELEASE');

create or replace function public.prevent_credit_ledger_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Account deletion removes the profile first and reaches this table through
  -- its FK cascade. Permit only that privacy-required cascade; while the owner
  -- profile still exists, direct ledger deletion remains impossible even for
  -- service-role application code.
  if tg_op = 'DELETE' and not exists (
    select 1 from public.profiles where id = old.user_id
  ) then
    return old;
  end if;
  raise exception 'credit_ledger is append-only' using errcode = '55000';
end;
$$;

create trigger credit_ledger_immutable
  before update or delete on public.credit_ledger
  for each row execute function public.prevent_credit_ledger_mutation();

alter table public.billing_orders enable row level security;
alter table public.credit_grants enable row level security;
alter table public.credit_ledger enable row level security;

create policy "billing_orders_select_own" on public.billing_orders
  for select using (auth.uid() = user_id);

create policy "credit_grants_select_own" on public.credit_grants
  for select using (auth.uid() = user_id);

create policy "credit_ledger_select_own" on public.credit_ledger
  for select using (auth.uid() = user_id);

grant select on public.billing_orders, public.credit_grants, public.credit_ledger to authenticated;
revoke insert, update, delete on public.billing_orders, public.credit_grants, public.credit_ledger from public, anon, authenticated;

-- Adds a new grant and its opening ledger entry. order_id is nullable for
-- controlled legacy/promotional grants. A paid order can create one grant and
-- repeated calls for the same order are idempotent.
create or replace function public.grant_credit(
  p_user_id uuid,
  p_kind text,
  p_amount integer,
  p_expires_at timestamptz,
  p_order_id uuid default null,
  p_reference_id text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.billing_orders%rowtype;
  v_grant_id uuid;
begin
  if p_kind not in ('BLOG', 'SHORTS') then
    raise exception 'unsupported credit kind: %', p_kind using errcode = '22023';
  end if;
  if p_amount <= 0 then
    raise exception 'credit amount must be positive' using errcode = '22023';
  end if;
  if p_expires_at <= timezone('utc', now()) then
    raise exception 'credit expiry must be in the future' using errcode = '22023';
  end if;

  if p_order_id is not null then
    select * into v_order
    from public.billing_orders
    where id = p_order_id
    for update;

    if not found then
      raise exception 'billing order not found' using errcode = 'P0002';
    end if;
    if v_order.user_id <> p_user_id or v_order.kind <> p_kind or v_order.credit_amount <> p_amount then
      raise exception 'credit grant does not match billing order' using errcode = '22023';
    end if;
    if v_order.status <> 'PAID' then
      raise exception 'billing order is not paid' using errcode = '55000';
    end if;
  end if;

  insert into public.credit_grants (user_id, kind, amount, remaining, expires_at, order_id)
  values (p_user_id, p_kind, p_amount, p_amount, p_expires_at, p_order_id)
  on conflict (order_id) do nothing
  returning id into v_grant_id;

  if v_grant_id is null then
    select id into v_grant_id
    from public.credit_grants
    where order_id = p_order_id and user_id = p_user_id;
    if v_grant_id is null then
      raise exception 'credit grant conflict' using errcode = '23505';
    end if;
    return v_grant_id;
  end if;

  insert into public.credit_ledger (
    user_id, grant_id, kind, event_type, delta, balance_after, reference_id, metadata
  ) values (
    p_user_id, v_grant_id, p_kind, 'GRANT', p_amount, p_amount,
    coalesce(p_reference_id, p_order_id::text),
    case when p_order_id is null then '{}'::jsonb else jsonb_build_object('orderId', p_order_id) end
  );

  return v_grant_id;
end;
$$;

-- Reserves credits from grants that expire first. FOR UPDATE serializes
-- concurrent spenders for the same grants; an insufficient reservation raises
-- and rolls the whole transaction back, including earlier allocations.
create or replace function public.reserve_credit(
  p_user_id uuid,
  p_kind text,
  p_amount integer default 1,
  p_reference_id text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation_id uuid := gen_random_uuid();
  v_needed integer := p_amount;
  v_take integer;
  v_balance integer;
  v_grant record;
begin
  if p_kind not in ('BLOG', 'SHORTS') then
    raise exception 'unsupported credit kind: %', p_kind using errcode = '22023';
  end if;
  if p_amount <= 0 then
    raise exception 'reservation amount must be positive' using errcode = '22023';
  end if;

  for v_grant in
    select id, remaining
    from public.credit_grants
    where user_id = p_user_id
      and kind = p_kind
      and remaining > 0
      and expires_at > timezone('utc', now())
    order by expires_at asc, created_at asc, id asc
    for update
  loop
    exit when v_needed = 0;
    v_take := least(v_needed, v_grant.remaining);

    update public.credit_grants
    set remaining = remaining - v_take
    where id = v_grant.id
    returning remaining into v_balance;

    insert into public.credit_ledger (
      user_id, grant_id, kind, event_type, delta, balance_after, reservation_id, reference_id
    ) values (
      p_user_id, v_grant.id, p_kind, 'RESERVE', -v_take, v_balance, v_reservation_id, p_reference_id
    );

    v_needed := v_needed - v_take;
  end loop;

  if v_needed > 0 then
    raise exception 'insufficient % credits: missing %', p_kind, v_needed using errcode = 'P0001';
  end if;

  return v_reservation_id;
end;
$$;

create or replace function public.settle_credit(
  p_reservation_id uuid,
  p_reference_id text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_kind text;
  v_terminal text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_reservation_id::text, 0));

  select user_id, kind into v_user_id, v_kind
  from public.credit_ledger
  where reservation_id = p_reservation_id and event_type = 'RESERVE'
  order by created_at
  limit 1;

  if v_user_id is null then
    raise exception 'credit reservation not found' using errcode = 'P0002';
  end if;

  select event_type into v_terminal
  from public.credit_ledger
  where reservation_id = p_reservation_id and event_type in ('SETTLE', 'RELEASE');

  if v_terminal = 'SETTLE' then return; end if;
  if v_terminal = 'RELEASE' then
    raise exception 'released credit reservation cannot be settled' using errcode = '55000';
  end if;

  insert into public.credit_ledger (
    user_id, kind, event_type, delta, reservation_id, reference_id
  ) values (
    v_user_id, v_kind, 'SETTLE', 0, p_reservation_id, p_reference_id
  );
end;
$$;

create or replace function public.release_credit(
  p_reservation_id uuid,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_kind text;
  v_terminal text;
  v_allocation record;
  v_grant public.credit_grants%rowtype;
  v_new_balance integer;
  v_released integer := 0;
  v_allocations jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_reservation_id::text, 0));

  select user_id, kind into v_user_id, v_kind
  from public.credit_ledger
  where reservation_id = p_reservation_id and event_type = 'RESERVE'
  order by created_at
  limit 1;

  if v_user_id is null then
    raise exception 'credit reservation not found' using errcode = 'P0002';
  end if;

  select event_type into v_terminal
  from public.credit_ledger
  where reservation_id = p_reservation_id and event_type in ('SETTLE', 'RELEASE');

  if v_terminal = 'RELEASE' then return; end if;
  if v_terminal = 'SETTLE' then
    raise exception 'settled credit reservation cannot be released' using errcode = '55000';
  end if;

  for v_allocation in
    select grant_id, sum(-delta)::integer as amount
    from public.credit_ledger
    where reservation_id = p_reservation_id and event_type = 'RESERVE'
    group by grant_id
    order by grant_id
  loop
    select * into v_grant
    from public.credit_grants
    where id = v_allocation.grant_id
    for update;

    if v_grant.remaining + v_allocation.amount > v_grant.amount then
      raise exception 'credit release would exceed original grant' using errcode = '23514';
    end if;

    update public.credit_grants
    set remaining = remaining + v_allocation.amount
    where id = v_grant.id
    returning remaining into v_new_balance;

    v_released := v_released + v_allocation.amount;
    v_allocations := v_allocations || jsonb_build_array(
      jsonb_build_object('grantId', v_grant.id, 'amount', v_allocation.amount)
    );

    -- A long-running job may fail after its grant expired. Record both the
    -- return and immediate expiry instead of reviving unusable credits.
    if v_grant.expires_at <= timezone('utc', now()) then
      update public.credit_grants set remaining = 0 where id = v_grant.id;
      insert into public.credit_ledger (
        user_id, grant_id, kind, event_type, delta, balance_after, reference_id,
        metadata
      ) values (
        v_user_id, v_grant.id, v_kind, 'EXPIRE', -v_new_balance, 0,
        p_reservation_id::text,
        jsonb_build_object('reason', 'released_after_expiry')
      );
    end if;
  end loop;

  insert into public.credit_ledger (
    user_id, kind, event_type, delta, reservation_id, reference_id, metadata
  ) values (
    v_user_id, v_kind, 'RELEASE', v_released, p_reservation_id,
    p_reservation_id::text,
    jsonb_build_object('reason', p_reason, 'allocations', v_allocations)
  );
end;
$$;

create or replace function public.expire_credits(
  p_now timestamptz default timezone('utc', now())
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant record;
  v_expired integer := 0;
begin
  for v_grant in
    select id, user_id, kind, remaining
    from public.credit_grants
    where remaining > 0 and expires_at <= p_now
    order by expires_at, id
    for update skip locked
  loop
    update public.credit_grants set remaining = 0 where id = v_grant.id;
    insert into public.credit_ledger (
      user_id, grant_id, kind, event_type, delta, balance_after, metadata
    ) values (
      v_grant.user_id, v_grant.id, v_grant.kind, 'EXPIRE', -v_grant.remaining, 0,
      jsonb_build_object('expiredAt', p_now)
    );
    v_expired := v_expired + v_grant.remaining;
  end loop;
  return v_expired;
end;
$$;

-- A full order refund is intentionally allowed only while every purchased
-- credit is unused and unreserved. This avoids ambiguous partial-refund math.
create or replace function public.refund_order_credits(
  p_order_id uuid,
  p_reason text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.billing_orders%rowtype;
  v_grant public.credit_grants%rowtype;
  v_refunded integer := 0;
begin
  select * into v_order
  from public.billing_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'billing order not found' using errcode = 'P0002';
  end if;
  if v_order.status = 'REFUNDED' then return 0; end if;
  if v_order.status <> 'PAID' then
    raise exception 'only paid orders can be refunded' using errcode = '55000';
  end if;

  for v_grant in
    select * from public.credit_grants
    where order_id = p_order_id
    order by id
    for update
  loop
    if v_grant.remaining <> v_grant.amount then
      raise exception 'used or reserved credits cannot be fully refunded' using errcode = '55000';
    end if;
    update public.credit_grants set remaining = 0 where id = v_grant.id;
    insert into public.credit_ledger (
      user_id, grant_id, kind, event_type, delta, balance_after, reference_id, metadata
    ) values (
      v_grant.user_id, v_grant.id, v_grant.kind, 'REFUND', -v_grant.remaining, 0,
      p_order_id::text, jsonb_build_object('reason', p_reason)
    );
    v_refunded := v_refunded + v_grant.remaining;
  end loop;

  update public.billing_orders
  set status = 'REFUNDED', refunded_at = timezone('utc', now())
  where id = p_order_id;

  return v_refunded;
end;
$$;

revoke all on function public.grant_credit(uuid, text, integer, timestamptz, uuid, text) from public, anon, authenticated;
revoke all on function public.reserve_credit(uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public.settle_credit(uuid, text) from public, anon, authenticated;
revoke all on function public.release_credit(uuid, text) from public, anon, authenticated;
revoke all on function public.expire_credits(timestamptz) from public, anon, authenticated;
revoke all on function public.refund_order_credits(uuid, text) from public, anon, authenticated;

grant execute on function public.grant_credit(uuid, text, integer, timestamptz, uuid, text) to service_role;
grant execute on function public.reserve_credit(uuid, text, integer, text) to service_role;
grant execute on function public.settle_credit(uuid, text) to service_role;
grant execute on function public.release_credit(uuid, text) to service_role;
grant execute on function public.expire_credits(timestamptz) to service_role;
grant execute on function public.refund_order_credits(uuid, text) to service_role;

