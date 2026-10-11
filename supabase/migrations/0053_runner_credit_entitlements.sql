-- Credit-backed automation execution and one-time trial grants.
-- Values for the trial are intentionally supplied by server configuration;
-- this migration only makes the grant atomic and idempotent.

create table public.credit_trial_claims (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  blog_amount integer not null check (blog_amount >= 0),
  shorts_amount integer not null check (shorts_amount >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.credit_trial_claims enable row level security;

create policy "credit_trial_claims_select_own" on public.credit_trial_claims
  for select using (auth.uid() = user_id);

grant select on public.credit_trial_claims to authenticated;
revoke insert, update, delete on public.credit_trial_claims from public, anon, authenticated;

-- A run id is passed as p_reference_id. Serializing on that key and returning
-- the existing reservation makes a retried runner request consume at most one
-- credit, even if the first response was lost after Postgres committed it.
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
  v_existing_reservation_id uuid;
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

  if p_reference_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_kind || ':' || p_reference_id, 0));
    select reservation_id into v_existing_reservation_id
    from public.credit_ledger
    where user_id = p_user_id
      and kind = p_kind
      and event_type = 'RESERVE'
      and reference_id = p_reference_id
    order by created_at
    limit 1;
    if v_existing_reservation_id is not null then
      return v_existing_reservation_id;
    end if;
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

-- Grants both configured trial balances in the same transaction. The claim
-- row is the idempotency key, so retries and simultaneous first-page loads
-- cannot create duplicate free grants.
create or replace function public.ensure_trial_credits(
  p_user_id uuid,
  p_blog_amount integer,
  p_shorts_amount integer,
  p_expires_at timestamptz,
  p_reference_id text default 'signup-trial-v1'
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed_user_id uuid;
begin
  if p_blog_amount < 0 or p_shorts_amount < 0 then
    raise exception 'trial credit amounts cannot be negative' using errcode = '22023';
  end if;
  if p_blog_amount + p_shorts_amount <= 0 then
    raise exception 'at least one trial credit is required' using errcode = '22023';
  end if;
  if p_expires_at <= timezone('utc', now()) then
    raise exception 'trial credit expiry must be in the future' using errcode = '22023';
  end if;

  insert into public.credit_trial_claims (user_id, blog_amount, shorts_amount, expires_at)
  values (p_user_id, p_blog_amount, p_shorts_amount, p_expires_at)
  on conflict (user_id) do nothing
  returning user_id into v_claimed_user_id;

  if v_claimed_user_id is null then
    return false;
  end if;

  if p_blog_amount > 0 then
    perform public.grant_credit(
      p_user_id, 'BLOG', p_blog_amount, p_expires_at, null, p_reference_id || ':BLOG'
    );
  end if;
  if p_shorts_amount > 0 then
    perform public.grant_credit(
      p_user_id, 'SHORTS', p_shorts_amount, p_expires_at, null, p_reference_id || ':SHORTS'
    );
  end if;

  return true;
end;
$$;

-- The stale-run reaper only knows automation_runs.id. Resolve the reservation
-- through the immutable ledger and delegate to release_credit, which is itself
-- idempotent and records the RELEASE event.
create or replace function public.release_credit_by_reference(
  p_reference_id text,
  p_reason text default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation_id uuid;
begin
  select reservation_id into v_reservation_id
  from public.credit_ledger
  where event_type = 'RESERVE'
    and reference_id = p_reference_id
  order by created_at
  limit 1;

  if v_reservation_id is null then
    return false;
  end if;

  perform public.release_credit(v_reservation_id, p_reason);
  return true;
end;
$$;

create or replace function public.settle_credit_by_reference(
  p_reference_id text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation_id uuid;
begin
  select reservation_id into v_reservation_id
  from public.credit_ledger
  where event_type = 'RESERVE'
    and reference_id = p_reference_id
  order by created_at
  limit 1;

  if v_reservation_id is null then
    return false;
  end if;

  perform public.settle_credit(v_reservation_id, p_reference_id);
  return true;
end;
$$;

-- Closes a successful run and its reservation in one transaction. Locking the
-- run row makes this mutually exclusive with the stale reaper's
-- `update ... where status in ('QUEUED','RUNNING')`: exactly one terminal
-- outcome wins, so a FAILED run can never retain a settled charge.
create or replace function public.complete_automation_run_credit(
  p_run_id uuid,
  p_output jsonb,
  p_completed_at timestamptz default timezone('utc', now()),
  p_requires_credit boolean default true
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_reservation_id uuid;
begin
  select status into v_status
  from public.automation_runs
  where id = p_run_id
  for update;

  if v_status is null then
    raise exception 'automation run not found' using errcode = 'P0002';
  end if;
  if v_status = 'SUCCESS' then
    return true;
  end if;
  if v_status <> 'RUNNING' then
    return false;
  end if;

  if p_requires_credit then
    select reservation_id into v_reservation_id
    from public.credit_ledger
    where event_type = 'RESERVE'
      and reference_id = p_run_id::text
    order by created_at
    limit 1;
    if v_reservation_id is null then
      raise exception 'credit reservation not found for automation run' using errcode = 'P0002';
    end if;
    perform public.settle_credit(v_reservation_id, p_run_id::text);
  end if;

  update public.automation_runs
  set status = 'SUCCESS', output = coalesce(p_output, '{}'::jsonb), completed_at = p_completed_at
  where id = p_run_id;

  return true;
end;
$$;

revoke all on function public.ensure_trial_credits(uuid, integer, integer, timestamptz, text) from public, anon, authenticated;
revoke all on function public.release_credit_by_reference(text, text) from public, anon, authenticated;
revoke all on function public.settle_credit_by_reference(text) from public, anon, authenticated;
revoke all on function public.complete_automation_run_credit(uuid, jsonb, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.ensure_trial_credits(uuid, integer, integer, timestamptz, text) to service_role;
grant execute on function public.release_credit_by_reference(text, text) to service_role;
grant execute on function public.settle_credit_by_reference(text) to service_role;
grant execute on function public.complete_automation_run_credit(uuid, jsonb, timestamptz, boolean) to service_role;
