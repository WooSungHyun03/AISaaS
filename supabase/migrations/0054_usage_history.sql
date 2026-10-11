-- Unified customer usage history backed by the immutable credit ledger.
-- RESERVE is the canonical row for a generation; its SETTLE/RELEASE terminal
-- event is folded into that row so one run is never rendered twice.

create or replace function public.get_usage_history(
  p_page integer default 1,
  p_page_size integer default 20,
  p_kind text default null,
  p_status text default null,
  p_from timestamptz default null,
  p_to timestamptz default null
) returns table (
  ledger_id uuid,
  event_type text,
  kind text,
  delta integer,
  created_at timestamptz,
  terminal_event text,
  terminal_delta integer,
  run_id uuid,
  run_status text,
  automation_id uuid,
  automation_name text,
  content_history_id uuid,
  content_title text,
  external_url text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with canonical as (
    select ledger.*
    from public.credit_ledger as ledger
    where ledger.user_id = auth.uid()
      and ledger.event_type in ('GRANT', 'RESERVE', 'EXPIRE', 'REFUND')
      and (p_kind is null or ledger.kind = p_kind)
      and (p_from is null or ledger.created_at >= p_from)
      and (p_to is null or ledger.created_at < p_to)
  ), enriched as (
    select
      ledger.id as ledger_id,
      ledger.event_type,
      ledger.kind,
      ledger.delta,
      ledger.created_at,
      terminal.event_type as terminal_event,
      terminal.delta as terminal_delta,
      run.id as run_id,
      run.status as run_status,
      automation.id as automation_id,
      automation.name as automation_name,
      content.id as content_history_id,
      content.title as content_title,
      content.external_url
    from canonical as ledger
    left join public.automation_runs as run
      on ledger.event_type = 'RESERVE'
      and run.id::text = ledger.reference_id
    left join public.automations as automation
      on automation.id = run.automation_id
      and automation.user_id = auth.uid()
    left join lateral (
      select terminal_row.event_type, terminal_row.delta
      from public.credit_ledger as terminal_row
      where terminal_row.user_id = auth.uid()
        and terminal_row.reservation_id = ledger.reservation_id
        and terminal_row.event_type in ('SETTLE', 'RELEASE')
      order by terminal_row.created_at desc
      limit 1
    ) as terminal on true
    left join lateral (
      select history.id, history.title, history.external_url
      from public.content_history as history
      where history.run_id = run.id
        and history.automation_id = automation.id
      order by history.created_at desc
      limit 1
    ) as content on true
  ), filtered as (
    select *
    from enriched
    where p_status is null
      or (p_status = 'SUCCESS' and run_status = 'SUCCESS')
      or (p_status = 'FAILED' and run_status = 'FAILED')
      or (p_status = 'RUNNING' and run_status in ('QUEUED', 'RUNNING'))
      or (p_status = 'GRANTED' and event_type = 'GRANT')
      or (p_status = 'RETURNED' and terminal_event = 'RELEASE')
      or (p_status = 'EXPIRED' and event_type = 'EXPIRE')
      or (p_status = 'REFUNDED' and event_type = 'REFUND')
  )
  select
    filtered.ledger_id,
    filtered.event_type,
    filtered.kind,
    filtered.delta,
    filtered.created_at,
    filtered.terminal_event,
    filtered.terminal_delta,
    filtered.run_id,
    filtered.run_status,
    filtered.automation_id,
    filtered.automation_name,
    filtered.content_history_id,
    filtered.content_title,
    filtered.external_url,
    count(*) over () as total_count
  from filtered
  order by filtered.created_at desc, filtered.ledger_id desc
  limit least(greatest(p_page_size, 1), 100)
  offset (greatest(p_page, 1) - 1) * least(greatest(p_page_size, 1), 100);
$$;

revoke all on function public.get_usage_history(integer, integer, text, text, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_usage_history(integer, integer, text, text, timestamptz, timestamptz)
  to authenticated;
