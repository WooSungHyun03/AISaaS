-- Administrator operations: account suspension, refund processing, and
-- per-run service usage counters. Privileged transitions are service-role
-- functions so customers cannot call them through PostgREST.

alter table public.profiles
  add column account_status text not null default 'ACTIVE'
    check (account_status in ('ACTIVE', 'SUSPENDED')),
  add column suspended_at timestamptz,
  add column suspension_reason text,
  add constraint profiles_suspension_state_check check (
    (account_status = 'ACTIVE' and suspended_at is null and suspension_reason is null)
    or (account_status = 'SUSPENDED' and suspended_at is not null and char_length(btrim(suspension_reason)) between 3 and 500)
  );

create index profiles_email_lower_idx on public.profiles (lower(email));
create index profiles_account_status_idx on public.profiles (account_status, created_at desc);

-- Customers may edit their display name, never their own suspension state.
revoke update on table public.profiles from authenticated;
grant update (display_name) on table public.profiles to authenticated;

alter table public.refund_requests
  add column reviewed_by uuid references auth.users(id) on delete set null,
  add column reviewed_at timestamptz,
  add column review_note text,
  add column refund_idempotency_key text unique,
  add column provider_refund_id text,
  add column refund_attempt_count integer not null default 0 check (refund_attempt_count >= 0),
  add column refund_last_error text,
  add column last_refund_attempt_at timestamptz,
  add column refunded_at timestamptz,
  add constraint refund_requests_review_state_check check (
    status in ('REQUESTED', 'REVIEWING')
    or (reviewed_at is not null and reviewed_by is not null)
  ) not valid,
  add constraint refund_requests_refunded_state_check check (
    status <> 'REFUNDED'
    or (refunded_at is not null and provider_refund_id is not null and refund_idempotency_key is not null)
  ) not valid;

create index refund_requests_admin_queue_idx
  on public.refund_requests (status, created_at desc);

alter table public.automation_runs
  add column ai_generation_count integer not null default 0 check (ai_generation_count >= 0),
  add column external_api_call_count integer not null default 0 check (external_api_call_count >= 0);

create index automation_runs_admin_status_created_idx
  on public.automation_runs (status, created_at desc);

create or replace function public.get_admin_usage_summary(
  p_from timestamptz,
  p_to timestamptz,
  p_user_ids uuid[] default null
) returns table (
  runs bigint,
  successful_runs bigint,
  ai_generations bigint,
  external_api_calls bigint,
  blog_runs bigint,
  shorts_runs bigint
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    count(*),
    count(*) filter (where r.status = 'SUCCESS'),
    coalesce(sum(r.ai_generation_count), 0),
    coalesce(sum(r.external_api_call_count), 0),
    count(*) filter (where t.slug = 'blog-marketing'),
    count(*) filter (where t.slug = 'shorts')
  from public.automation_runs r
  join public.automations a on a.id = r.automation_id
  join public.automation_templates t on t.id = a.template_id
  where r.created_at >= p_from and r.created_at <= p_to
    and (p_user_ids is null or a.user_id = any(p_user_ids));
$$;

-- Once an administrator approves a refund, freeze the unused credits until
-- Toss cancellation and the local transaction finish. This closes the race
-- between approval and an automation reserving the same credit.
create or replace function public.reserve_credit(
  p_user_id uuid,
  p_kind text,
  p_amount integer default 1,
  p_reference_id text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
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
    where user_id = p_user_id and kind = p_kind and event_type = 'RESERVE' and reference_id = p_reference_id
    order by created_at limit 1;
    if v_existing_reservation_id is not null then return v_existing_reservation_id; end if;
  end if;

  for v_grant in
    select g.id, g.remaining
    from public.credit_grants g
    where g.user_id = p_user_id
      and g.kind = p_kind
      and g.remaining > 0
      and g.expires_at > timezone('utc', now())
      and not exists (
        select 1 from public.refund_requests r
        where r.order_id = g.order_id and r.status in ('APPROVED', 'REFUNDED')
      )
    order by g.expires_at asc, g.created_at asc, g.id asc
    for update of g
  loop
    exit when v_needed = 0;
    v_take := least(v_needed, v_grant.remaining);
    update public.credit_grants set remaining = remaining - v_take where id = v_grant.id returning remaining into v_balance;
    insert into public.credit_ledger (user_id, grant_id, kind, event_type, delta, balance_after, reservation_id, reference_id)
    values (p_user_id, v_grant.id, p_kind, 'RESERVE', -v_take, v_balance, v_reservation_id, p_reference_id);
    v_needed := v_needed - v_take;
  end loop;

  if v_needed > 0 then
    raise exception 'insufficient % credits: missing %', p_kind, v_needed using errcode = 'P0001';
  end if;
  return v_reservation_id;
end;
$$;

create or replace function public.admin_review_refund_request(
  p_request_id uuid,
  p_admin_id uuid,
  p_decision text,
  p_note text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.refund_requests%rowtype;
  v_order public.billing_orders%rowtype;
  v_remaining integer;
  v_next_status text;
begin
  if p_decision not in ('REVIEWING', 'APPROVED', 'REJECTED') then
    raise exception 'unsupported refund decision' using errcode = '22023';
  end if;
  if not exists (select 1 from public.admin_users where user_id = p_admin_id) then
    raise exception 'administrator membership required' using errcode = '42501';
  end if;

  select * into v_request from public.refund_requests where id = p_request_id for update;
  if not found then raise exception 'refund request not found' using errcode = 'P0002'; end if;
  if v_request.status = 'REFUNDED' then return 'REFUNDED'; end if;

  if p_decision = 'REVIEWING' and v_request.status <> 'REQUESTED' then
    raise exception 'only requested refunds can enter review' using errcode = '55000';
  end if;
  if p_decision in ('APPROVED', 'REJECTED') and v_request.status not in ('REQUESTED', 'REVIEWING') then
    raise exception 'refund request is not reviewable' using errcode = '55000';
  end if;

  if p_decision = 'APPROVED' then
    select * into v_order from public.billing_orders where id = v_request.order_id for update;
    if not found or v_order.status <> 'PAID' then
      raise exception 'only a paid order can be approved' using errcode = '55000';
    end if;
    select remaining into v_remaining
    from public.credit_grants where order_id = v_request.order_id for update;
    v_remaining := coalesce(v_remaining, 0);
    if v_remaining <> v_request.unused_credits_snapshot then
      raise exception 'credit balance changed after the refund request' using errcode = '55000';
    end if;
  end if;

  v_next_status := p_decision;
  update public.refund_requests
  set status = v_next_status,
      reviewed_by = p_admin_id,
      reviewed_at = timezone('utc', now()),
      review_note = nullif(btrim(p_note), ''),
      refund_idempotency_key = case when p_decision = 'APPROVED' then coalesce(refund_idempotency_key, 'refund-' || id::text) else refund_idempotency_key end,
      refund_last_error = case when p_decision = 'APPROVED' then null else refund_last_error end
  where id = p_request_id;
  return v_next_status;
end;
$$;

create or replace function public.admin_record_refund_failure(
  p_request_id uuid,
  p_error text
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_attempts integer;
begin
  update public.refund_requests
  set refund_attempt_count = refund_attempt_count + 1,
      last_refund_attempt_at = timezone('utc', now()),
      refund_last_error = left(coalesce(nullif(btrim(p_error), ''), 'payment cancellation failed'), 1000)
  where id = p_request_id and status = 'APPROVED'
  returning refund_attempt_count into v_attempts;
  if v_attempts is null then raise exception 'approved refund request not found' using errcode = 'P0002'; end if;
  return v_attempts;
end;
$$;

create or replace function public.admin_finalize_refund_request(
  p_request_id uuid,
  p_provider_refund_id text,
  p_refunded_amount integer
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.refund_requests%rowtype;
  v_order public.billing_orders%rowtype;
  v_grant public.credit_grants%rowtype;
  v_refunded_credits integer := 0;
begin
  if nullif(btrim(p_provider_refund_id), '') is null then raise exception 'provider refund id is required' using errcode = '22023'; end if;
  select * into v_request from public.refund_requests where id = p_request_id for update;
  if not found then raise exception 'refund request not found' using errcode = 'P0002'; end if;
  if v_request.status = 'REFUNDED' then return v_request.unused_credits_snapshot; end if;
  if v_request.status <> 'APPROVED' then raise exception 'refund request is not approved' using errcode = '55000'; end if;
  if p_refunded_amount <> v_request.expected_refund_krw then raise exception 'refund amount mismatch' using errcode = '22023'; end if;

  select * into v_order from public.billing_orders where id = v_request.order_id for update;
  if not found or v_order.status <> 'PAID' then raise exception 'paid order not found' using errcode = '55000'; end if;

  for v_grant in select * from public.credit_grants where order_id = v_request.order_id order by id for update loop
    v_refunded_credits := v_refunded_credits + v_grant.remaining;
    if v_grant.remaining > 0 then
      update public.credit_grants set remaining = 0 where id = v_grant.id;
      insert into public.credit_ledger (user_id, grant_id, kind, event_type, delta, balance_after, reference_id, metadata)
      values (
        v_grant.user_id, v_grant.id, v_grant.kind, 'REFUND', -v_grant.remaining, 0, v_request.id::text,
        jsonb_build_object('orderId', v_order.id, 'refundRequestId', v_request.id, 'amountKrw', p_refunded_amount)
      );
    end if;
  end loop;
  if v_refunded_credits <> v_request.unused_credits_snapshot then
    raise exception 'approved refund credits changed' using errcode = '55000';
  end if;

  update public.billing_orders set status = 'REFUNDED', refunded_at = timezone('utc', now()) where id = v_order.id;
  update public.refund_requests
  set status = 'REFUNDED', provider_refund_id = p_provider_refund_id,
      refunded_at = timezone('utc', now()), refund_attempt_count = refund_attempt_count + 1,
      last_refund_attempt_at = timezone('utc', now()), refund_last_error = null
  where id = v_request.id;
  return v_refunded_credits;
end;
$$;

-- Persist the two usage counters on the run that produced them while settling
-- its credit in the same transaction.
create or replace function public.complete_automation_run_credit_v2(
  p_run_id uuid,
  p_output jsonb,
  p_completed_at timestamptz default timezone('utc', now()),
  p_requires_credit boolean default true,
  p_ai_generation_count integer default 0,
  p_external_api_call_count integer default 0
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_status text; v_reservation_id uuid;
begin
  if p_ai_generation_count < 0 or p_external_api_call_count < 0 then raise exception 'usage counters cannot be negative' using errcode = '22023'; end if;
  select status into v_status from public.automation_runs where id = p_run_id for update;
  if v_status is null then raise exception 'automation run not found' using errcode = 'P0002'; end if;
  if v_status = 'SUCCESS' then return true; end if;
  if v_status <> 'RUNNING' then return false; end if;
  if p_requires_credit then
    select reservation_id into v_reservation_id from public.credit_ledger
    where event_type = 'RESERVE' and reference_id = p_run_id::text order by created_at limit 1;
    if v_reservation_id is null then raise exception 'credit reservation not found for automation run' using errcode = 'P0002'; end if;
    perform public.settle_credit(v_reservation_id, p_run_id::text);
  end if;
  update public.automation_runs set status = 'SUCCESS', output = coalesce(p_output, '{}'::jsonb), completed_at = p_completed_at,
    ai_generation_count = p_ai_generation_count, external_api_call_count = p_external_api_call_count
  where id = p_run_id;
  return true;
end;
$$;

revoke all on function public.reserve_credit(uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public.admin_review_refund_request(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_record_refund_failure(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_finalize_refund_request(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.complete_automation_run_credit_v2(uuid, jsonb, timestamptz, boolean, integer, integer) from public, anon, authenticated;
revoke all on function public.get_admin_usage_summary(timestamptz, timestamptz, uuid[]) from public, anon, authenticated;
grant execute on function public.reserve_credit(uuid, text, integer, text) to service_role;
grant execute on function public.admin_review_refund_request(uuid, uuid, text, text) to service_role;
grant execute on function public.admin_record_refund_failure(uuid, text) to service_role;
grant execute on function public.admin_finalize_refund_request(uuid, text, integer) to service_role;
grant execute on function public.complete_automation_run_credit_v2(uuid, jsonb, timestamptz, boolean, integer, integer) to service_role;
grant execute on function public.get_admin_usage_summary(timestamptz, timestamptz, uuid[]) to service_role;
