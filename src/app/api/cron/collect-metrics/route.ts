import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env/server";
import { cleanupOldSnapshots, processDueChannels } from "@/server/channels/collect-pipeline";
import { logger } from "@/lib/logger";
import { safeEqual } from "@/server/shared/secret";

/** Same time budget style as /api/cron/run-automations. */
export const maxDuration = 60;
const TICK_BUDGET_MS = 35_000;

/**
 * Called by the Supabase Edge Function / pg_cron job (not yet registered —
 * see docs/person1/METRICS_COLLECTION_CRON.md) on a daily schedule.
 * Protected by the same shared-secret pattern as /api/cron/run-automations.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (!serverEnv.CRON_SECRET || !safeEqual(secret, serverEnv.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  let cleaned = 0;
  try {
    cleaned = await cleanupOldSnapshots(now);
  } catch (err) {
    logger.error("collect_metrics_cleanup_failed", { message: err instanceof Error ? err.message : String(err) });
  }

  const result = await processDueChannels(now, TICK_BUDGET_MS);
  return NextResponse.json({ ...result, cleaned });
}
