-- Abuse hardening found in the 2026-10-12 audit.
--
-- 1. Authenticated users can insert into several tables directly through
--    PostgREST (RLS only checks ownership), so the per-row application limits
--    were bypassable. These BEFORE INSERT triggers enforce generous caps in
--    the database. They run as the caller; RLS limits the count to the
--    caller's own rows, which is exactly the owner scope being capped.
-- 2. Trigger-only SECURITY DEFINER functions must not be callable as RPCs.

create or replace function public.enforce_row_cap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_scope_column text := tg_argv[0];
  v_cap integer := tg_argv[1]::integer;
  v_scope uuid;
  v_count bigint;
begin
  v_scope := (to_jsonb(new) ->> v_scope_column)::uuid;
  if v_scope is null then
    return new;
  end if;
  -- Serialise concurrent inserts for the same owner so the cap cannot be
  -- raced past by parallel requests.
  perform pg_advisory_xact_lock(hashtextextended(tg_table_name || ':' || v_scope::text, 0));
  execute format('select count(*) from %I.%I where %I = $1', tg_table_schema, tg_table_name, v_scope_column)
    into v_count using v_scope;
  if v_count >= v_cap then
    raise exception 'row limit reached for %', tg_table_name using errcode = '54000';
  end if;
  return new;
end;
$$;

create trigger businesses_row_cap
  before insert on public.businesses
  for each row execute function public.enforce_row_cap('owner_id', '20');

create trigger tracked_channels_row_cap
  before insert on public.tracked_channels
  for each row execute function public.enforce_row_cap('business_id', '10');

create trigger calendar_events_row_cap
  before insert on public.calendar_events
  for each row execute function public.enforce_row_cap('user_id', '3000');

create trigger calendar_items_row_cap
  before insert on public.calendar_items
  for each row execute function public.enforce_row_cap('business_id', '500');

create trigger automations_row_cap
  before insert on public.automations
  for each row execute function public.enforce_row_cap('user_id', '30');

create trigger business_faqs_row_cap
  before insert on public.business_faqs
  for each row execute function public.enforce_row_cap('business_id', '200');

revoke all on function public.enforce_row_cap() from public, anon, authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.handle_new_profile_subscription() from public, anon, authenticated;
