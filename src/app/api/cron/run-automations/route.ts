import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env/server";
import { advanceDeferredRuns, findDueAutomations, reapStaleRuns, runDueAutomation } from "@/server/automations";
import { cleanupOldTicks, finishSchedulerTick, startSchedulerTick, type TickTrigger } from "@/server/automations/ticks";
import { cleanupOldSnapshots, processDueChannels } from "@/server/channels/collect-pipeline";
import { logger } from "@/lib/logger";
import { safeEqual } from "@/server/shared/secret";

/**
 * Each tick first advances in-flight deferred runs (blog posts, ad Shorts), then starts a handful of
 * due automations. One step can be a single long model call, so the budgets leave room for it.
 */
export const maxDuration = 300;
const ADVANCE_BUDGET_MS = 200_000;
const TICK_BUDGET_MS = 270_000;

/** x-cron-secret (the Supabase Edge Function) or `Authorization: Bearer` (Vercel Cron sends this when CRON_SECRET is set). */
function isAuthorized(request: Request): boolean {
  if (!serverEnv.CRON_SECRET) return false;
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
  return safeEqual(request.headers.get("x-cron-secret"), serverEnv.CRON_SECRET) || safeEqual(bearer, serverEnv.CRON_SECRET);
}

async function runTick(trigger: TickTrigger) {
  const tickStartedAt = Date.now();
  const tickId = await startSchedulerTick(trigger, new Date(tickStartedAt));
  let reaped = 0;
  try {
    reaped = await reapStaleRuns();
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

  const due = await findDueAutomations(20, new Date(tickStartedAt)).catch(async (err: unknown) => {
    // Say so in the heartbeat instead of only failing: "the scheduler ran but could not read what is due" is the case to see.
    await finishSchedulerTick(tickId, { dueFound: 0, started: 0, succeeded: 0, failed: 0, skipped: 0, advanced, reaped, channelsProcessed: 0, error: `due lookup failed: ${err instanceof Error ? err.message : String(err)}` });
    throw err;
  });
  const results: Array<{ status: string; runId?: string; automationId?: string; errorMessage?: string }> = [];
  // Stay inside maxDuration: anything not started this tick is still due and goes next tick.
  const deadline = tickStartedAt + TICK_BUDGET_MS;

  for (const automation of due) {
    if (Date.now() > deadline) {
      logger.warn("cron_tick_budget_exhausted", { remaining: due.length - results.length });
      break;
    }
    try {
      results.push(await runDueAutomation(automation.id, { id: automation.id, schedule: automation.schedule, next_run_at: automation.next_run_at }));
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
  let channelError: string | undefined;
  const remainingMs = deadline - Date.now();
  if (remainingMs > 10_000) {
    try {
      channels = await processDueChannels(new Date(), Math.min(remainingMs - 5_000, 25_000));
      if (channels.processed + channels.failed > 0) await cleanupOldSnapshots().catch((err) => logger.error("cron_snapshot_cleanup_failed", { message: err instanceof Error ? err.message : String(err) }));
    } catch (err) {
      channelError = err instanceof Error ? err.message : String(err);
      logger.error("cron_channel_collection_failed", { message: channelError });
    }
  }

  const count = (status: string) => results.filter((result) => result.status === status).length;
  const summary = {
    dueFound: due.length,
    started: results.length - count("SKIPPED"),
    succeeded: count("SUCCESS") + count("RUNNING"),
    failed: count("FAILED"),
    skipped: count("SKIPPED"),
    advanced,
    reaped,
    channelsProcessed: channels.processed,
    error: channelError ?? null,
  };
  await finishSchedulerTick(tickId, summary);
  // The heartbeat table is trimmed now and then, not on every tick.
  if (new Date().getUTCMinutes() < 5) await cleanupOldTicks();

  return NextResponse.json({ processed: results.length, advanced, channels, results });
}

/**
 * Called by the Supabase Edge Function (supabase/functions/run-due-automations)
 * on a schedule. Protected by a shared secret rather than user auth since
 * the caller is infrastructure, not a signed-in user.
 */
export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return runTick("CRON");
}

/**
 * Vercel Cron (vercel.json) calls with GET once a day as a safety net: if the database scheduler is ever down, due
 * automations are still picked up (a slot missed for more than 12 hours is skipped, see MAX_CATCH_UP_MS) and the
 * channels are collected. Running both is harmless — every slot is claimed with a compare-and-set.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return runTick("VERCEL_CRON");
}
