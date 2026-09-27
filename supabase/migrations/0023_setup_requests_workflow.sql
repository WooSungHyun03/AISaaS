-- Setup Request status workflow (Dev3 ticket #13).
--
-- 1. Names the status check constraint explicitly. 0010_setup_requests.sql
-- declared it inline (`status text ... check (status in (...))`), which
-- Postgres names automatically (almost certainly `setup_requests_status_check`,
-- following its `<table>_<column>_check` convention) — but that name is
-- never written as a literal string anywhere in 0010's SQL, so
-- check-constraint-testing.ts's shared "does the DB constraint match the TS
-- list" pattern (taxonomy/status/classification_source) can't find it by
-- searching migration file text.
--
-- Rather than guess that auto-generated name and risk `drop constraint
-- <wrong name>` failing outright against a real database, this looks it up
-- dynamically: any check constraint on setup_requests whose definition
-- mentions 'REQUESTED' is assumed to be the original one and is dropped
-- before the named replacement is added. If that lookup finds nothing (the
-- assumption was wrong, or it's already gone), this silently does nothing
-- and the migration still ends with the named constraint in place — worst
-- case, the original unnamed constraint coexists redundantly alongside it
-- (harmless: a row must satisfy both, and both list the same five values).
-- If a future migration ever changes the allowed status values and this
-- fallback duplicate is still present, both constraints need updating —
-- check `select conname, pg_get_constraintdef(oid) from pg_constraint where
-- conrelid = 'public.setup_requests'::regclass and contype = 'c';` to see
-- what actually exists before assuming just one does.
do $$
declare
  old_constraint_name text;
begin
  select conname into old_constraint_name
  from pg_constraint
  where conrelid = 'public.setup_requests'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%REQUESTED%'
  limit 1;

  if old_constraint_name is not null then
    execute format('alter table public.setup_requests drop constraint %I', old_constraint_name);
  end if;
end $$;

alter table public.setup_requests
  add constraint setup_requests_status_values_check
  check (status in ('REQUESTED', 'CONTACTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'));

-- 2. Tightens setup_requests_update_own (0012_row_level_security.sql) from
-- "any update to your own row" to "cancel your own not-yet-finished
-- request, nothing else": `using` re-checks the row is still in a
-- non-terminal state (so a COMPLETED/CANCELLED row is never even a
-- candidate — a direct API call trying to "un-finish" one matches zero
-- rows, the same as it not existing), `with check` forces the result to be
-- CANCELLED. This is the actual enforcement boundary — application code
-- (canTransition() in setup-requests.ts) exists for a better error message
-- before ever reaching the database, not as the only guard.
--
-- This does NOT restrict which other columns can change in the same
-- update (e.g. description) — see this ticket's report for why a
-- BEFORE UPDATE trigger to also lock those down was deliberately not
-- added (this project keeps triggers to simple, single-purpose jobs like
-- set_updated_at; the app's own update function never touches those
-- columns regardless).
drop policy "setup_requests_update_own" on public.setup_requests;

create policy "setup_requests_update_own" on public.setup_requests
  for update
  using (
    auth.uid() = user_id
    and status in ('REQUESTED', 'CONTACTED', 'IN_PROGRESS')
  )
  with check (
    auth.uid() = user_id
    and status = 'CANCELLED'
  );
