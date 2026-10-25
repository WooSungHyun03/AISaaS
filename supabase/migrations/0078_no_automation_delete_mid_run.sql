-- An automation (directly, or through its business) cannot be deleted while one of its runs is in flight (2026-10-26).
-- deleteAutomation / deleteBusiness already check "no QUEUED/RUNNING run" first, but as a separate statement: a run the
-- scheduler starts between that check and the delete was still cascaded. Its credit reservation is only found again
-- through the run row (the stale-run reaper releases it by run id), so the credit stayed reserved for good and 0070
-- then refuses a refund of that order (F-033).
-- The BEFORE DELETE row trigger runs after the delete has locked the automation row, and a run insert holds a key-share
-- lock on that row through its foreign key, so either the run is visible here (delete refused) or its insert waits and
-- then fails on the missing automation. Deleting the whole account (auth user → profile cascade) is still allowed: the
-- profile row is already gone by then and every credit of the user goes with it.
-- Rollback: drop trigger automations_no_delete_mid_run on public.automations; drop function public.automations_no_delete_mid_run();

create or replace function public.automations_no_delete_mid_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.automation_runs r where r.automation_id = old.id and r.status in ('QUEUED', 'RUNNING'))
     and exists (select 1 from public.profiles p where p.id = old.user_id) then
    raise exception 'automation % has a run in flight', old.id using errcode = '55006';
  end if;
  return old;
end;
$$;

revoke all on function public.automations_no_delete_mid_run() from public, anon, authenticated;

drop trigger if exists automations_no_delete_mid_run on public.automations;
create trigger automations_no_delete_mid_run
  before delete on public.automations
  for each row execute function public.automations_no_delete_mid_run();
