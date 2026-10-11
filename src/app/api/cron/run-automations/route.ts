import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env/server";
import { advanceDeferredRuns, findDueAutomations, reapStaleRuns, runDueAutomation } from "@/server/automations";
import { cleanupOldSnapshots, processDueChannels } from "@/server/channels/collect-pipeline";
import { logger } from "@/lib/logger";
import { safeEqual } from "@/server/shared/secret";

/**
 * Each tick first advances in-flight deferred runs (animated Shorts), then starts a handful of
 * due automations. Starting a character Short (AI plan + frames + queueing clips) takes ~30 s.
 */
export const maxDuration = 120;
const ADVANCE_BUDGET_MS = 40_000;
const TICK_BUDGET_MS = 70_000;

/**
 * Called by the Supabase Edge Function (supabase/functions/run-due-automations)
 * on a schedule. Protected by a shared secret rather than user auth since
 * the caller is infrastructure, not a signed-in user.
 */
export async function POST(request: Request) {
  const tickStartedAt = Date.now();
  const secret = request.headers.get("x-cron-secret");
  if (!serverEnv.CRON_SECRET || !safeEqual(secret, serverEnv.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const reaped = await reapStaleRuns();
    if (reaped > 0) logger.warn("cron_reaped_stale_runs", { count: reaped });
  } catch (err) {
    logger.error("cron_reap_failed", { message: err instanceof Error ? err.message : String(err) });
  }

  let advanced = 0;
  try {
    advanced = (await advanceDeferredRuns({ budgetMs: ADVANCE_BUDGET_MS })).length;
  } catch (err) {
    logger.error("cron_advance_deferred_failed", { message: err instanceof Error ? err.message : String(err) });
  }

  const due = await findDueAutomations();
  const results = [];
  // Stay inside maxDuration: anything not started this tick is still due and goes next tick.
  const deadline = tickStartedAt + TICK_BUDGET_MS;

  for (const automation of due) {
    if (Date.now() > deadline) {
      logger.warn("cron_tick_budget_exhausted", { remaining: due.length - results.length });
      break;
    }
    try {
      results.push(await runDueAutomation(automation.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("cron_run_failed", { automationId: automation.id, message });
      results.push({ automationId: automation.id, status: "FAILED", errorMessage: message });
    }
  }

  // Growth-report numbers: each tracked channel is due once a day (next_snapshot_at), so most ticks find nothing
  // and this stays one cheap indexed query. Riding on this already-scheduled tick means the daily collection needs no
  // second pg_cron job to be registered; a failure here never affects the automations above.
  let channels = { processed: 0, failed: 0, paused: 0 };
  const remainingMs = deadline - Date.now();
  if (remainingMs > 10_000) {
    try {
      channels = await processDueChannels(new Date(), Math.min(remainingMs - 5_000, 25_000));
      if (channels.processed + channels.failed > 0) await cleanupOldSnapshots().catch((err) => logger.error("cron_snapshot_cleanup_failed", { message: err instanceof Error ? err.message : String(err) }));
    } catch (err) {
      logger.error("cron_channel_collection_failed", { message: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ processed: results.length, advanced, channels, results });
}
