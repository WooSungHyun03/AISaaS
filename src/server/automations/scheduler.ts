import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { SERVICE_TIMEZONE, getZonedParts, zonedTimeToUtc } from "@/lib/utils/date";
import type { AutomationSchedule } from "@/types/automation";
import type { Automation } from "@/types/domain";

/**
 * Computes the next UTC instant a schedule should fire, strictly after
 * `from`. Timezone-aware (defaults to Asia/Seoul) so "매주 월/수/금 오전 9시"
 * fires at 9am KST regardless of the server's own timezone.
 */
export function computeNextRunAt(schedule: AutomationSchedule, from: Date = new Date()): Date {
  const timezone = schedule.timezone ?? SERVICE_TIMEZONE;
  const [hour, minute] = schedule.timeOfDay.split(":").map(Number);
  const nowParts = getZonedParts(from, timezone);
  const baseUtcDay = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day);
  const maxLookaheadDays = schedule.frequency === "WEEKLY" ? 7 : 1;

  for (let offset = 0; offset <= maxLookaheadDays; offset++) {
    const candidateDay = new Date(baseUtcDay + offset * 86_400_000);
    const year = candidateDay.getUTCFullYear();
    const month = candidateDay.getUTCMonth() + 1;
    const day = candidateDay.getUTCDate();
    const weekday = candidateDay.getUTCDay();

    if (schedule.frequency === "WEEKLY" && !(schedule.daysOfWeek ?? []).includes(weekday)) {
      continue;
    }

    const candidateInstant = zonedTimeToUtc(year, month, day, hour, minute, timezone);
    if (candidateInstant.getTime() > from.getTime()) {
      return candidateInstant;
    }
  }

  throw new Error("Could not compute next run time for schedule — check daysOfWeek/timeOfDay.");
}

/**
 * Finds ACTIVE automations whose next_run_at has passed. This single query,
 * polled every few minutes by a cron trigger, replaces having one scheduled
 * job per automation — the architecture stays flat as users grow (Section 10).
 */
export async function findDueAutomations(limit = 20): Promise<Automation[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("automations")
    .select("*")
    .eq("status", "ACTIVE")
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}
