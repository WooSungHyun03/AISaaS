-- Audit hardening (QA review):
--  1. automations can only reference a business the same user owns
--  2. atomic usage counter (replaces a racy read-then-write in application code)
--  3. explainable diagnosis: persist the score breakdown next to the score

-- 1. A user could previously insert/update an automation with a business_id
-- they do not own (the old policies only checked user_id). The runner loads
-- the business with the service-role client, so that would have let the
-- automation generate content from — and expose run output built on — another
-- user's business profile.
drop policy if exists "automations_insert_own" on public.automations;
create policy "automations_insert_own" on public.automations
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.businesses b
      where b.id = automations.business_id
        and b.owner_id = auth.uid()
    )
  );

drop policy if exists "automations_update_own" on public.automations;
create policy "automations_update_own" on public.automations
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.businesses b
      where b.id = automations.business_id
        and b.owner_id = auth.uid()
    )
  );

-- 2. Concurrent runs for the same user could both read the same counter and
-- write back the same value, losing an increment (and therefore letting a
-- user run past a plan limit). One upsert statement is atomic.
create or replace function public.increment_usage(
  p_user_id uuid,
  p_period text,
  p_runs integer,
  p_generations integer
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.usage (user_id, period, automation_runs, ai_generations)
  values (p_user_id, p_period, greatest(p_runs, 0), greatest(p_generations, 0))
  on conflict (user_id, period) do update
    set automation_runs = public.usage.automation_runs + greatest(excluded.automation_runs, 0),
        ai_generations = public.usage.ai_generations + greatest(excluded.ai_generations, 0);
$$;

-- Only the service-role runner may bump counters; a user calling this through
-- PostgREST could otherwise inflate (or, with a negative guard removed, reset)
-- their own usage.
revoke all on function public.increment_usage(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.increment_usage(uuid, text, integer, integer) to service_role;

-- 3. The score is computed from measurable page/profile signals (see
-- src/server/marketing/scoring.ts); keep the per-signal breakdown so the UI
-- can always explain *why* a business got its score.
alter table public.marketing_diagnoses
  add column score_breakdown jsonb not null default '[]'::jsonb,
  add column evidence jsonb not null default '{}'::jsonb;
