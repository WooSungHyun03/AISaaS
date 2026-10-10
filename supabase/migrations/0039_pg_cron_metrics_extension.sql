-- Ticket 1-6 (스냅샷 수집 파이프라인): makes the `pg_cron` extension
-- available IF the platform allows it, so a daily metrics-collection job
-- *can* be registered later. This migration deliberately does NOT call
-- `cron.schedule(...)` — actually registering the daily job (and wiring
-- the Supabase Edge Function's `?job=metrics` extension) is the team
-- lead's job ("등록은 제가 해요"), not something that should happen
-- automatically every time migrations are applied (including in
-- production). The ready-to-run `cron.schedule(...)` command is in
-- docs/person1/METRICS_COLLECTION_CRON.md instead.
--
-- Same defensive pattern as 0015_integration_connections.sql's
-- `supabase_vault` enable: some local/self-hosted Postgres instances don't
-- have pg_cron installable, so this must not fail the whole migration.
do $$
begin
  create extension if not exists pg_cron;
exception
  when others then
    raise notice 'pg_cron extension could not be created (%). The daily metrics-collection job cannot be scheduled until this project''s Postgres instance has it available.', sqlerrm;
end;
$$;
