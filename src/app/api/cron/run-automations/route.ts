import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env/server";
import { findDueAutomations, runDueAutomation } from "@/server/automations";
import { logger } from "@/lib/logger";

/**
 * Called by the Supabase Edge Function (supabase/functions/run-due-automations)
 * on a schedule. Protected by a shared secret rather than user auth since
 * the caller is infrastructure, not a signed-in user.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (!serverEnv.CRON_SECRET || secret !== serverEnv.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const due = await findDueAutomations();
  const results = [];

  for (const automation of due) {
    try {
      results.push(await runDueAutomation(automation.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("cron_run_failed", { automationId: automation.id, message });
      results.push({ automationId: automation.id, status: "FAILED", errorMessage: message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
