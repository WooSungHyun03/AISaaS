import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env/server";
import { advanceDeferredRuns, findDueAutomations, reapStaleRuns, runDueAutomation } from "@/server/automations";
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

  return NextResponse.json({ processed: results.length, advanced, results });
}
