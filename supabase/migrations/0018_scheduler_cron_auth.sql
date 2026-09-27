-- Fixes a real production gap in 0014_scheduler_cron.sql (never edited —
-- this migration reschedules the same job instead): Supabase Edge Functions
-- reject any request without a valid Supabase JWT (anon or service_role key)
-- in the Authorization header by default ("verify_jwt"). The pg_cron job
-- added in 0014 called net.http_post() with no Authorization header at all,
-- so on a real deployment every single tick would be rejected with 401
-- before ever reaching run-due-automations — the scheduler could never
-- actually fire a single automation. This was never caught locally because
-- there is no live Supabase project in this environment to smoke-test pg_cron
-- against (see docs/CLAUDE_DAILY_PROGRESS.md "Blocked External").
--
-- Fix: reschedule the same job with `Authorization: Bearer <service_role_key>`.
-- The key is read at execution time from a database-level setting rather
-- than committed to git — set it ONCE on the live database (not in a
-- migration, matching the existing `supabase secrets set` step for the Edge
-- Function's own env):
--
--   alter database postgres set app.settings.service_role_key = '<service role key>';
--
-- (README.md "Deployment" documents this as a required one-time manual step.)
-- If that setting is never configured, `current_setting(..., true)` returns
-- null and the header becomes an empty bearer token — the job keeps failing
-- with 401 exactly as it silently did before this migration. That is a
-- fail-closed, no-worse-than-before default, never a silent security
-- downgrade, and never a reason for this migration itself to error.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'run-due-automations') then
    perform cron.unschedule('run-due-automations');
  end if;

  perform cron.schedule(
    'run-due-automations',
    '*/5 * * * *',
    $cron$
      select net.http_post(
        url := 'https://dvkfvommrhvlvuccxgeh.functions.supabase.co/run-due-automations',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.service_role_key', true), '')
        )
      );
    $cron$
  );
end;
$$;
