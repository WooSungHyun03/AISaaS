import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { closeFailedRunBudget } from "@/server/budget";
import { releaseCreditByReference } from "@/server/billing/credits";
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

  if (schedule.frequency === "MONTHLY") {
    const dayOfMonth = schedule.dayOfMonth ?? 0;
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
      throw new Error("Could not compute next run time for schedule — check dayOfMonth.");
    }
    // This month and the next: if this month's slot already passed, next month's is always later.
    for (let offset = 0; offset <= 2; offset++) {
      const monthIndex = nowParts.month - 1 + offset;
      const year = nowParts.year + Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const candidateInstant = zonedTimeToUtc(year, month, Math.min(dayOfMonth, lastDay), hour, minute, timezone);
      if (candidateInstant.getTime() > from.getTime()) return candidateInstant;
    }
    throw new Error("Could not compute next run time for schedule — check dayOfMonth/timeOfDay.");
  }

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
export async function findDueAutomations(limit = 20, now: Date = new Date()): Promise<Automation[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("automations")
    .select("*")
    .eq("status", "ACTIVE")
    .lte("next_run_at", now.toISOString())
    .order("next_run_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

/**
 * A due slot older than this was missed (the scheduler or the site was down). One missed slot is still made up for
 * within this window, but a slot that is older is skipped and recorded: running it now would produce content on a day
 * the owner did not choose, and a long outage must never turn into a burst of back-dated runs.
 */
export const MAX_CATCH_UP_MS = 12 * 60 * 60_000;

/** After this many scheduled runs in a row fail, the automation is parked (status ERROR) until its owner looks at it. One failure must not stop a weekly schedule for good. */
export const MAX_CONSECUTIVE_SCHEDULED_FAILURES = 3;

export type DueClaim = { kind: "CLAIMED"; overdueMs: number } | { kind: "LOST" };

/**
 * What taking a due slot does: how late it is, and where `next_run_at` goes. A slot that is within the catch-up window
 * is run now and the schedule continues strictly after now. A slot that is too old is skipped, and the schedule
 * continues from the first slot at or after now — so an outage that ends exactly at a slot does not also eat that slot.
 */
export function planDueClaim(schedule: AutomationSchedule, dueAt: string | null, now: Date): { next: Date; overdueMs: number; skip: boolean } {
  const overdueMs = dueAt ? Math.max(0, now.getTime() - Date.parse(dueAt)) : 0;
  const skip = overdueMs > MAX_CATCH_UP_MS;
  return { next: computeNextRunAt(schedule, skip ? new Date(now.getTime() - 1) : now), overdueMs, skip };
}

/**
 * Takes the due slot of an automation: `next_run_at` moves to the next slot only if it still holds the value the tick
 * read (compare-and-set), so two overlapping ticks — or a tick and the Vercel fallback — can never run the same slot
 * twice. The tick that loses gets `LOST` and does nothing. Taking the slot is also what stops a slow or failing run
 * from looking due again on every following tick.
 */
export async function claimDueSlot(automation: Pick<Automation, "id" | "schedule" | "next_run_at">, now: Date = new Date()): Promise<DueClaim> {
  const plan = planDueClaim(automation.schedule as unknown as AutomationSchedule, automation.next_run_at, now);
  const admin = createAdminClient();
  let update = admin.from("automations").update({ next_run_at: plan.next.toISOString() }).eq("id", automation.id).eq("status", "ACTIVE");
  update = automation.next_run_at === null ? update.is("next_run_at", null) : update.eq("next_run_at", automation.next_run_at);
  const { data, error } = await update.select("id");
  if (error) throw error;
  if (!data || data.length === 0) return { kind: "LOST" };
  return { kind: "CLAIMED", overdueMs: plan.overdueMs };
}

/** A run that has been RUNNING/QUEUED this long was killed (timeout, deploy, crash) and will never finish on its own. */
export const STALE_RUN_MINUTES = 10;
/** Deferred runs (clips + render) legitimately take minutes, so they get a longer window (a handler gives up before this). */
export const STALE_DEFERRED_RUN_MINUTES = 90;

/**
 * Marks abandoned runs FAILED. The partial unique index on automation_runs
 * allows one in-flight run per automation, so a run orphaned by a serverless
 * timeout would otherwise block that automation from ever running again.
 * A deferred run is recognised by `output.job` and judged on its own, longer
 * window. Returns how many runs were reaped.
 */
export async function reapStaleRuns(now: Date = new Date()): Promise<number> {
  const admin = createAdminClient();
  const failure = { status: "FAILED" as const, error_message: "실행이 중간에 멈춰 자동으로 종료했어요. 다시 시도해주세요.", completed_at: now.toISOString() };
  const cutoff = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

  const plain = await admin
    .from("automation_runs")
    .select("id")
    .in("status", ["QUEUED", "RUNNING"])
    .lt("created_at", cutoff(STALE_RUN_MINUTES))
    .is("output", null);
  if (plain.error) throw plain.error;

  const deferred = await admin
    .from("automation_runs")
    .select("id")
    .in("status", ["QUEUED", "RUNNING"])
    .lt("created_at", cutoff(STALE_DEFERRED_RUN_MINUTES))
    .not("output->job", "is", null);
  if (deferred.error) throw deferred.error;

  // A stale run can no longer settle successfully, so its credit reservation is released (by the immutable run-id
  // reference; publish-only/unmetered runs simply return false) BEFORE the run is marked FAILED. The other order
  // stranded the credit for good when the release hit a transient error: the FAILED run was never selected again.
  // Now such a run stays in flight and the next tick retries it; release_credit is idempotent.
  let reaped = 0;
  for (const { id: runId } of [...(plain.data ?? []), ...(deferred.data ?? [])]) {
    try {
      await releaseCreditByReference(runId, "stale_run_reaped");
    } catch (error) {
      // 55000 = the reservation was already settled: nothing to strand, so the run is still closed below.
      if ((error as { code?: string } | null)?.code !== "55000") {
        logger.error("cron_reap_release_failed", { runId, message: error instanceof Error ? error.message : String(error) });
        continue;
      }
    }
    // The same for the spend budget: what the run reserved counts as spent, its item slot goes back. No-op for unmetered runs.
    try {
      await closeFailedRunBudget(runId, "stale_run_reaped");
    } catch (error) {
      logger.error("cron_reap_budget_failed", { runId, message: error instanceof Error ? error.message : String(error) });
    }
    const { data, error } = await admin
      .from("automation_runs")
      .update(failure)
      .eq("id", runId)
      .in("status", ["QUEUED", "RUNNING"])
      .select("id");
    if (error) throw error;
    reaped += data?.length ?? 0;
  }

  return reaped;
}
