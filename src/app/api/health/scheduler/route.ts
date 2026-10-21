import { NextResponse } from "next/server";
import { getSchedulerHealth } from "@/server/automations/ticks";

/**
 * When did the scheduler (pg_cron → Edge Function → /api/cron/run-automations) last run? Public on purpose and limited
 * to a timestamp and a boolean, so uptime monitoring can alert when ticks stop arriving. It does not start a tick.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const health = await getSchedulerHealth();
    return NextResponse.json(health, { status: health.healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ lastTickAt: null, ageMinutes: null, healthy: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
