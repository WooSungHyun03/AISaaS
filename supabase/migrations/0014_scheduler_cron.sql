-- Enables the Postgres extensions needed to trigger the automation scheduler
-- on a fixed interval from inside the database, and schedules that trigger.
--
-- This calls the `run-due-automations` Edge Function every 5 minutes; the
-- Edge Function itself just forwards to POST /api/cron/run-automations with
-- the CRON_SECRET header (see supabase/functions/run-due-automations and
-- docs/ARCHITECTURE.md's Automation Flow section).
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- The Edge Function URL is this project's own public Functions endpoint —
-- not a secret (the function itself is protected by CRON_SECRET, forwarded
-- as a header when it calls the Next.js cron route).
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'run-due-automations') then
    perform cron.schedule(
      'run-due-automations',
      '*/5 * * * *',
      $cron$
        select net.http_post(
          url := 'https://dvkfvommrhvlvuccxgeh.functions.supabase.co/run-due-automations',
          headers := '{"Content-Type": "application/json"}'::jsonb
        );
      $cron$
    );
  end if;
end;
$$;
