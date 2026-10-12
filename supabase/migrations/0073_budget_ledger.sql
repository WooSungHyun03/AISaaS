-- Spend ledger for the two paid content pipelines. The whole service shares one budget per kind and per period
-- (ad Shorts = VIDEO, blog posts = BLOG); it is not a per-user limit. Every paid call reserves its worst-case cost
-- here BEFORE it is made, settles to the real cost afterwards, and is refused when the period's cap, the per-item
-- cap or the item limit would be exceeded. All writes go through the functions below, under one advisory lock per
-- period and kind, so parallel calls can never overspend. Only the service role can call them.

create table public.budget_items (
  period_key text not null,
  kind text not null check (kind in ('VIDEO', 'BLOG')),
  run_id uuid not null,
  state text not null check (state in ('CLAIMED', 'COMPLETED', 'RELEASED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (period_key, kind, run_id)
);

create table public.budget_spend (
  id uuid primary key default gen_random_uuid(),
  period_key text not null,
  kind text not null check (kind in ('VIDEO', 'BLOG')),
  -- The automation run the money was spent for. Not a foreign key: the ledger must outlive the run row.
  run_id uuid,
  step text not null check (char_length(step) between 1 and 80),
  attempt integer not null default 1 check (attempt >= 1),
  provider text not null,
  model text,
  state text not null check (state in ('RESERVED', 'SETTLED', 'RELEASED')),
  reserved_usd numeric(12, 6) not null check (reserved_usd >= 0),
  actual_usd numeric(12, 6) check (actual_usd is null or actual_usd >= 0),
  usage jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  note text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint budget_spend_settled_has_actual check (state <> 'SETTLED' or actual_usd is not null)
);

create index budget_spend_period_idx on public.budget_spend (period_key, kind, state);
create index budget_spend_run_idx on public.budget_spend (run_id) where run_id is not null;

alter table public.budget_items enable row level security;
alter table public.budget_spend enable row level security;
revoke all on table public.budget_items from public, anon, authenticated;
revoke all on table public.budget_spend from public, anon, authenticated;
grant all on table public.budget_items to service_role;
grant all on table public.budget_spend to service_role;

-- Takes one of the period's item slots for a run (idempotent for the same run). Refused when the limit is reached.
create or replace function public.budget_claim_item(
  p_period text,
  p_kind text,
  p_run_id uuid,
  p_item_limit integer
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state text;
  v_taken integer;
begin
  if p_kind not in ('VIDEO', 'BLOG') then raise exception 'unsupported budget kind' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('budget:' || p_period || ':' || p_kind, 0));

  select state into v_state from public.budget_items where period_key = p_period and kind = p_kind and run_id = p_run_id;
  if found then return v_state; end if;

  select count(*) into v_taken from public.budget_items
  where period_key = p_period and kind = p_kind and state in ('CLAIMED', 'COMPLETED');
  if v_taken >= p_item_limit then
    raise exception 'budget item limit reached (% of %)', v_taken, p_item_limit using errcode = 'BG001';
  end if;

  insert into public.budget_items (period_key, kind, run_id, state) values (p_period, p_kind, p_run_id, 'CLAIMED');
  return 'CLAIMED';
end;
$$;

create or replace function public.budget_complete_item(p_period text, p_kind text, p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('budget:' || p_period || ':' || p_kind, 0));
  update public.budget_items set state = 'COMPLETED', updated_at = now()
  where period_key = p_period and kind = p_kind and run_id = p_run_id and state = 'CLAIMED';
end;
$$;

-- A run that produced nothing gives its slot back. Money it already spent stays counted.
create or replace function public.budget_release_item(p_period text, p_kind text, p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('budget:' || p_period || ':' || p_kind, 0));
  update public.budget_items set state = 'RELEASED', updated_at = now()
  where period_key = p_period and kind = p_kind and run_id = p_run_id and state = 'CLAIMED';
end;
$$;

-- Reserves p_usd for one paid call. Refused (and nothing written) when
--   * spent + reserved + this call + the minimum still needed to finish every other item would pass the period cap
--     (so retries can never starve the items that have not been made yet), or
--   * the run's own spending would pass the per-item cap.
-- The same idempotency key returns the same reservation.
create or replace function public.budget_reserve(
  p_period text,
  p_kind text,
  p_run_id uuid,
  p_step text,
  p_attempt integer,
  p_provider text,
  p_model text,
  p_usd numeric,
  p_idempotency_key text,
  p_cap_usd numeric,
  p_item_floor_usd numeric,
  p_item_limit integer,
  p_item_cap_usd numeric,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_used numeric;
  v_item_spent numeric := 0;
  v_others numeric;
  v_taken integer;
begin
  if p_kind not in ('VIDEO', 'BLOG') then raise exception 'unsupported budget kind' using errcode = '22023'; end if;
  if p_usd < 0 then raise exception 'amount must not be negative' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('budget:' || p_period || ':' || p_kind, 0));

  select id into v_id from public.budget_spend where idempotency_key = p_idempotency_key;
  if found then return v_id; end if;

  select coalesce(sum(case state when 'RESERVED' then reserved_usd when 'SETTLED' then actual_usd else 0 end), 0)
    into v_used
  from public.budget_spend where period_key = p_period and kind = p_kind;

  if p_run_id is not null then
    select coalesce(sum(case state when 'RESERVED' then reserved_usd when 'SETTLED' then actual_usd else 0 end), 0)
      into v_item_spent
    from public.budget_spend where period_key = p_period and kind = p_kind and run_id = p_run_id;
    if p_item_cap_usd is not null and v_item_spent + p_usd > p_item_cap_usd then
      raise exception 'item budget exceeded: spent % + % > cap %', v_item_spent, p_usd, p_item_cap_usd using errcode = 'BG003';
    end if;
  end if;

  -- What the other, unfinished items still need at least: the floor minus what each already spent, plus a full floor
  -- for every item slot nobody has claimed yet.
  select count(*) into v_taken from public.budget_items
  where period_key = p_period and kind = p_kind and state in ('CLAIMED', 'COMPLETED');

  select coalesce(sum(greatest(p_item_floor_usd - coalesce(sp.spent, 0), 0)), 0)
    into v_others
  from public.budget_items i
  left join (
    select run_id, sum(case state when 'RESERVED' then reserved_usd when 'SETTLED' then actual_usd else 0 end) as spent
    from public.budget_spend where period_key = p_period and kind = p_kind group by run_id
  ) sp on sp.run_id = i.run_id
  where i.period_key = p_period and i.kind = p_kind and i.state = 'CLAIMED' and i.run_id is distinct from p_run_id;

  v_others := v_others + greatest(p_item_limit - v_taken, 0) * p_item_floor_usd;

  if v_used + p_usd + v_others > p_cap_usd then
    raise exception 'budget exceeded: used % + request % + needed for other items % > cap %', v_used, p_usd, v_others, p_cap_usd
      using errcode = 'BG002';
  end if;

  insert into public.budget_spend (period_key, kind, run_id, step, attempt, provider, model, state, reserved_usd, idempotency_key, note)
  values (p_period, p_kind, p_run_id, p_step, greatest(p_attempt, 1), p_provider, p_model, 'RESERVED', p_usd, p_idempotency_key, p_note)
  returning id into v_id;
  return v_id;
end;
$$;

-- Replaces the reservation with what the call really cost. Idempotent. An actual above the reservation is recorded
-- as it is (and flagged), never hidden.
create or replace function public.budget_settle(p_id uuid, p_actual_usd numeric, p_usage jsonb default '{}'::jsonb)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period text;
  v_kind text;
  v_actual numeric;
begin
  if p_actual_usd < 0 then raise exception 'amount must not be negative' using errcode = '22023'; end if;
  select period_key, kind into v_period, v_kind from public.budget_spend where id = p_id;
  if not found then raise exception 'reservation not found' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('budget:' || v_period || ':' || v_kind, 0));
  update public.budget_spend
  set state = 'SETTLED', actual_usd = p_actual_usd, usage = coalesce(p_usage, '{}'::jsonb), settled_at = now(),
      note = case when p_actual_usd > reserved_usd then coalesce(note || '; ', '') || 'actual above reservation' else note end
  where id = p_id and state = 'RESERVED';
  if found then return p_actual_usd; end if;
  select coalesce(actual_usd, 0) into v_actual from public.budget_spend where id = p_id;
  return v_actual;
end;
$$;

-- Frees a reservation for a call that was never made or that cannot have been billed.
create or replace function public.budget_release(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period text;
  v_kind text;
begin
  select period_key, kind into v_period, v_kind from public.budget_spend where id = p_id;
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('budget:' || v_period || ':' || v_kind, 0));
  update public.budget_spend set state = 'RELEASED', settled_at = now(), note = coalesce(p_note, note)
  where id = p_id and state = 'RESERVED';
end;
$$;

create or replace function public.budget_status(p_period text, p_kind text)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select jsonb_build_object(
    'settledUsd', coalesce((select sum(actual_usd) from public.budget_spend where period_key = p_period and kind = p_kind and state = 'SETTLED'), 0),
    'reservedUsd', coalesce((select sum(reserved_usd) from public.budget_spend where period_key = p_period and kind = p_kind and state = 'RESERVED'), 0),
    'itemsClaimed', (select count(*) from public.budget_items where period_key = p_period and kind = p_kind and state = 'CLAIMED'),
    'itemsCompleted', (select count(*) from public.budget_items where period_key = p_period and kind = p_kind and state = 'COMPLETED'),
    'itemsReleased', (select count(*) from public.budget_items where period_key = p_period and kind = p_kind and state = 'RELEASED')
  );
$$;

revoke all on function public.budget_claim_item(text, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.budget_complete_item(text, text, uuid) from public, anon, authenticated;
revoke all on function public.budget_release_item(text, text, uuid) from public, anon, authenticated;
revoke all on function public.budget_reserve(text, text, uuid, text, integer, text, text, numeric, text, numeric, numeric, integer, numeric, text) from public, anon, authenticated;
revoke all on function public.budget_settle(uuid, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.budget_release(uuid, text) from public, anon, authenticated;
revoke all on function public.budget_status(text, text) from public, anon, authenticated;
grant execute on function public.budget_claim_item(text, text, uuid, integer) to service_role;
grant execute on function public.budget_complete_item(text, text, uuid) to service_role;
grant execute on function public.budget_release_item(text, text, uuid) to service_role;
grant execute on function public.budget_reserve(text, text, uuid, text, integer, text, text, numeric, text, numeric, numeric, integer, numeric, text) to service_role;
grant execute on function public.budget_settle(uuid, numeric, jsonb) to service_role;
grant execute on function public.budget_release(uuid, text) to service_role;
grant execute on function public.budget_status(text, text) to service_role;
