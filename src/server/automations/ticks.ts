import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import type { Database } from "@/types/database.types";

type TickRow = Database["public"]["Tables"]["scheduler_ticks"]["Row"];
export type TickTrigger = "CRON" | "VERCEL_CRON" | "MANUAL";

export interface TickSummary {
  dueFound: number;
  started: number;
  succeeded: number;
  failed: number;
  skipped: number;
  advanced: number;
  reaped: number;
  channelsProcessed: number;
  error?: string | null;
}

/** No tick for this long means the scheduler (pg_cron → Edge Function → this route) is not running. pg_cron fires every 5 minutes. */
export const SCHEDULER_STALE_MINUTES = 15;
const KEEP_TICKS_DAYS = 14;

/** Opens the heartbeat row of one tick. Never throws: a log that cannot be written must not stop the scheduler. */
export async function startSchedulerTick(trigger: TickTrigger, now: Date = new Date()): Promise<string | null> {
  try {
    const { data, error } = await createAdminClient().from("scheduler_ticks").insert({ trigger, started_at: now.toISOString() }).select("id").single();
    if (error) throw error;
    return data.id;
  } catch (cause) {
    logger.warn("scheduler_tick_start_failed", { message: cause instanceof Error ? cause.message : String(cause) });
    return null;
  }
}

export async function finishSchedulerTick(id: string | null, summary: TickSummary, now: Date = new Date()): Promise<void> {
  if (!id) return;
  try {
    const { error } = await createAdminClient()
      .from("scheduler_ticks")
      .update({
        finished_at: now.toISOString(),
        due_found: summary.dueFound,
        started: summary.started,
        succeeded: summary.succeeded,
        failed: summary.failed,
        skipped: summary.skipped,
        advanced: summary.advanced,
        reaped: summary.reaped,
        channels_processed: summary.channelsProcessed,
        error: summary.error ? summary.error.slice(0, 2000) : null,
      })
      .eq("id", id);
    if (error) throw error;
  } catch (cause) {
    logger.warn("scheduler_tick_finish_failed", { message: cause instanceof Error ? cause.message : String(cause) });
  }
}

/** Drops heartbeat rows older than two weeks (called by the tick itself, a few times a day is enough). */
export async function cleanupOldTicks(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - KEEP_TICKS_DAYS * 86_400_000).toISOString();
  const { error } = await createAdminClient().from("scheduler_ticks").delete().lt("started_at", cutoff);
  if (error) logger.warn("scheduler_tick_cleanup_failed", { message: error.message });
}

export interface SchedulerHealth {
  /** When the scheduler last ran, or null if it never did (or the table does not exist yet). */
  lastTickAt: string | null;
  ageMinutes: number | null;
  /** The last tick ran within SCHEDULER_STALE_MINUTES. */
  healthy: boolean;
}

export function schedulerHealthFrom(lastTickAt: string | null, now: Date = new Date()): SchedulerHealth {
  if (!lastTickAt) return { lastTickAt: null, ageMinutes: null, healthy: false };
  const ageMinutes = Math.max(0, Math.round((now.getTime() - Date.parse(lastTickAt)) / 60_000));
  return { lastTickAt, ageMinutes, healthy: ageMinutes <= SCHEDULER_STALE_MINUTES };
}

export async function getSchedulerHealth(now: Date = new Date()): Promise<SchedulerHealth> {
  const { data, error } = await createAdminClient().from("scheduler_ticks").select("started_at").order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return schedulerHealthFrom(null, now);
  return schedulerHealthFrom(data?.started_at ?? null, now);
}

export async function listRecentTicks(limit = 40): Promise<TickRow[]> {
  const { data, error } = await createAdminClient().from("scheduler_ticks").select("*").order("started_at", { ascending: false }).limit(limit);
  if (error) throw new Error("스케줄러 실행 기록을 불러오지 못했습니다.", { cause: error });
  return data ?? [];
}
