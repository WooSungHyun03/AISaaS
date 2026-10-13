import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import type { Database } from "@/types/database.types";

type RunRow = Database["public"]["Tables"]["channel_collection_runs"]["Row"];
export type CollectionTrigger = "CRON" | "MANUAL_ADMIN" | "MANUAL_USER" | "REGISTER";

export interface CollectionRunTally {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  quotaExceeded: boolean;
  errorSummary?: string | null;
}

/** Opens a log row for one batch (a cron tick that found due channels, an admin's "지금 수집"). Returns null when the log itself cannot be written — logging must never block collecting. */
export async function startCollectionRun(params: { trigger: CollectionTrigger; scheduledFor: Date; triggeredBy?: string | null; now?: Date }): Promise<string | null> {
  try {
    const { data, error } = await createAdminClient()
      .from("channel_collection_runs")
      .insert({
        trigger: params.trigger,
        scheduled_for: params.scheduledFor.toISOString(),
        started_at: (params.now ?? new Date()).toISOString(),
        triggered_by: params.triggeredBy ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id;
  } catch (cause) {
    logger.warn("collection_run_start_failed", { message: cause instanceof Error ? cause.message : String(cause) });
    return null;
  }
}

export function runStatusOf(tally: CollectionRunTally): "SUCCESS" | "PARTIAL" | "FAILED" {
  if (tally.failed === 0) return "SUCCESS";
  return tally.succeeded > 0 ? "PARTIAL" : "FAILED";
}

export async function finishCollectionRun(runId: string | null, tally: CollectionRunTally, now: Date = new Date()): Promise<void> {
  if (!runId) return;
  try {
    const { error } = await createAdminClient()
      .from("channel_collection_runs")
      .update({
        completed_at: now.toISOString(),
        status: runStatusOf(tally),
        channels_total: tally.total,
        channels_succeeded: tally.succeeded,
        channels_failed: tally.failed,
        channels_skipped: tally.skipped,
        quota_exceeded: tally.quotaExceeded,
        error_summary: tally.errorSummary ? tally.errorSummary.slice(0, 2000) : null,
      })
      .eq("id", runId);
    if (error) throw error;
  } catch (cause) {
    logger.warn("collection_run_finish_failed", { message: cause instanceof Error ? cause.message : String(cause) });
  }
}

/** Admin view: the latest runs, newest first. */
export async function listRecentCollectionRuns(limit = 30): Promise<RunRow[]> {
  const { data, error } = await createAdminClient().from("channel_collection_runs").select("*").order("started_at", { ascending: false }).limit(limit);
  if (error) throw new Error("수집 실행 기록을 불러오지 못했습니다.", { cause: error });
  return (data ?? []) as RunRow[];
}

/** The last time an admin started a manual collection: the basis for the rate limit. */
export async function lastManualAdminRunAt(): Promise<Date | null> {
  const { data } = await createAdminClient().from("channel_collection_runs").select("started_at").eq("trigger", "MANUAL_ADMIN").order("started_at", { ascending: false }).limit(1).maybeSingle();
  return data?.started_at ? new Date(data.started_at) : null;
}
