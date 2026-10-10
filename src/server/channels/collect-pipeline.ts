import "server-only";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/logger";
import { ChannelsError } from "./summary";
import { saveMetricSnapshot } from "./snapshot";
import { collectRawChannelMetrics, toSnapshotMetricsRecord } from "./raw-metrics";
import type { TrackedChannelForCollection } from "./raw-metrics";
import { channelPlatformSchema } from "./platform";
import type { Database } from "@/types/database.types";

/** Current-period + previous-period comparison (see getGrowthSummary) needs up to ~180 days; this adds a buffer so that comparison never silently loses its older half. Not literally "90일" per the ticket text — see docs/person1/MIGRATION_NUMBERING_NOTES.md-style note below. */
const RETENTION_DAYS = 200;
/** A transient failure is retried on the next cron tick; this many in a row pauses the channel instead of hammering a broken/renamed channel forever. */
const MAX_CONSECUTIVE_FAILURES = 5;
const RESNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;

type TrackedChannelUpdate = Database["public"]["Tables"]["tracked_channels"]["Update"];

/**
 * Collects fresh metrics for the channel's platform and reduces them to a
 * flat metric map — no scoring here, just the numbers the growth graph
 * plots over time. Platform dispatch itself lives in raw-metrics.ts, shared
 * with diagnose.ts.
 */
async function collectChannelMetrics(channel: TrackedChannelForCollection, businessName: string | undefined, now: Date): Promise<Record<string, number>> {
  const raw = await collectRawChannelMetrics(channel, businessName, now);
  return toSnapshotMetricsRecord(raw);
}

/**
 * Collects fresh metrics for one channel and saves a snapshot per metric.
 * Used by all three collection paths (ticket 1-6's (a)/(b)/(c)) — this
 * function itself has no daily-limit or failure-count side effects; see
 * collect-now.ts for (b)'s server-enforced limit and processDueChannels
 * below for (c)'s failure tracking.
 */
export async function snapshotChannelMetrics(channel: TrackedChannelForCollection, businessName: string | undefined, now: Date = new Date()): Promise<void> {
  const metrics = await collectChannelMetrics(channel, businessName, now);
  const source = serverEnv.CHANNEL_DATA_PROVIDER;
  for (const [metric, value] of Object.entries(metrics)) {
    await saveMetricSnapshot({ channelId: channel.id, metric, value, source, recordedAt: now });
  }
}

/** Deletes snapshots older than RETENTION_DAYS. Called once per cron tick (see the route), not from a DB-level schedule. */
export async function cleanupOldSnapshots(now: Date = new Date()): Promise<number> {
  const supabase = await createClient();
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error, count } = await supabase.from("marketing_metric_snapshots").delete({ count: "exact" }).lt("recorded_at", cutoff);
  if (error) throw new ChannelsError("DATABASE_ERROR", "오래된 채널 지표 스냅샷을 정리하지 못했습니다.", { cause: error });
  return count ?? 0;
}

export interface ProcessDueChannelsResult {
  processed: number;
  failed: number;
  paused: number;
}

/**
 * The cron path (c): channels whose next_snapshot_at has passed (see
 * tracked_channels_due_idx, 0034) get a fresh snapshot. A time budget
 * (mirrors /api/cron/run-automations) stops the loop before the route's
 * own deadline, leaving the rest due again next tick. A failure
 * increments consecutive_failure_count (reset to 0 on success); at
 * MAX_CONSECUTIVE_FAILURES the channel is PAUSED, which drops it out of
 * the due index automatically.
 */
export async function processDueChannels(now: Date = new Date(), budgetMs = 30_000): Promise<ProcessDueChannelsResult> {
  const supabase = await createClient();
  const deadline = Date.now() + budgetMs;

  const { data: due, error: dueError } = await supabase
    .from("tracked_channels")
    .select("id, business_id, platform, external_id, url, consecutive_failure_count")
    .eq("status", "ACTIVE")
    .lte("next_snapshot_at", now.toISOString());
  if (dueError) throw new ChannelsError("DATABASE_ERROR", "수집 대상 채널을 불러오지 못했습니다.", { cause: dueError });

  const result: ProcessDueChannelsResult = { processed: 0, failed: 0, paused: 0 };

  for (const channel of due ?? []) {
    if (Date.now() > deadline) break;

    const { data: business } = await supabase.from("businesses").select("name").eq("id", channel.business_id).maybeSingle();

    try {
      await snapshotChannelMetrics({ ...channel, platform: channelPlatformSchema.parse(channel.platform) }, business?.name, now);
      const update: TrackedChannelUpdate = { next_snapshot_at: new Date(now.getTime() + RESNAPSHOT_INTERVAL_MS).toISOString() };
      if (channel.consecutive_failure_count > 0) update.consecutive_failure_count = 0;
      await supabase.from("tracked_channels").update(update).eq("id", channel.id);
      result.processed++;
    } catch (cause) {
      const failures = channel.consecutive_failure_count + 1;
      const update: TrackedChannelUpdate = {
        consecutive_failure_count: failures,
        next_snapshot_at: new Date(now.getTime() + RESNAPSHOT_INTERVAL_MS).toISOString(),
      };
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        update.status = "PAUSED";
        result.paused++;
      }
      await supabase.from("tracked_channels").update(update).eq("id", channel.id);
      result.failed++;
      logger.warn("channel_snapshot_failed", {
        channelId: channel.id,
        platform: channel.platform,
        consecutiveFailureCount: failures,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  return result;
}
