// Supabase Edge Function — thin cron trigger.
//
// This function does NOT contain automation logic. It is invoked on a
// schedule (Supabase Dashboard -> Database -> Cron, e.g. every 5 minutes)
// and simply calls back into the Next.js app's /api/cron/run-automations
// route, which owns findDueAutomations() + the automation runner. Keeping
// the logic in one TypeScript codebase (instead of duplicating it in Deno)
// is what keeps this maintainable for a 3-person team.
//
// Deploy: supabase functions deploy run-due-automations
// Configure secrets: supabase secrets set SITE_URL=https://<your-app>.netlify.app CRON_SECRET=<same value as .env CRON_SECRET>
// Schedule: Supabase Dashboard -> Database -> Cron Jobs -> call this function's URL every N minutes.

Deno.serve(async () => {
  const siteUrl = Deno.env.get("SITE_URL");
  const cronSecret = Deno.env.get("CRON_SECRET");

  if (!siteUrl || !cronSecret) {
    return new Response(JSON.stringify({ error: "SITE_URL / CRON_SECRET not configured" }), { status: 500 });
  }

  const response = await fetch(`${siteUrl}/api/cron/run-automations`, {
    method: "POST",
    headers: { "x-cron-secret": cronSecret },
  });

  const body = await response.text();
  return new Response(body, { status: response.status });
});
