import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { ChannelsError } from "./summary";
import { collectRawChannelMetrics } from "./raw-metrics";
import type { TrackedChannelForCollection } from "./raw-metrics";
import { channelPlatformSchema } from "./platform";
import { classifyCollectionError, persistChannelCollection, recordCollectionFailure } from "./persist";
import type { FailureKind } from "./persist";
import { finishCollectionRun, startCollectionRun } from "./collection-runs";
import type { CollectionTrigger } from "./collection-runs";
import { MAX_RETRIES_PER_SLOT, RETRY_DELAY_MS, currentCollectionSlot, kstDateString, nextDailyCollectionAt } from "./schedule";
import type { Database } from "@/types/database.types";

/** Current-period + previous-period comparison (see getGrowthSummary) needs up to ~180 days; this adds a buffer so that comparison never silently loses its older half. */
const RETENTION_DAYS = 200;
/** A channel that is confirmed not to exist this many days in a row is paused: retrying cannot help until the owner fixes the address. */
const MAX_NOT_FOUND_DAYS = 3;
/** Back-off for channels that keep failing for a transient reason: daily at first, then every other day, then weekly. Never a stop. */
const BACKOFF_DAYS = (failures: number): number => (failures <= 6 ? 1 : failures <= 12 ? 2 : 7);
/** A paused channel is probed again this often, so one that came back (a blog made public again) resumes without anyone clicking. */
const PAUSED_PROBE_DAYS = 7;
/** An invalid API key is our own configuration problem, not the channel's: look again after this long without counting a failure. */
const CONFIG_RETRY_MS = 6 * 3_600_000;
/** Upper bound on rows read per tick; the time budget usually stops earlier and the rest stay due. */
const MAX_CHANNELS_PER_TICK = 200;
/** While a channel is being collected nobody else may claim it (a slow tick must not be doubled by the next one). */
const CLAIM_MS = 15 * 60_000;
/** YouTube's daily quota resets at midnight Pacific time; while it is exhausted every YouTube call fails, so wait before trying again. */
const QUOTA_RETRY_MS = 60 * 60_000;

type TrackedChannelUpdate = Database["public"]["Tables"]["tracked_channels"]["Update"];

/** Deletes snapshots older than RETENTION_DAYS. Called once per cron tick that collected something, not from a DB-level schedule. */
export async function cleanupOldSnapshots(now: Date = new Date()): Promise<number> {
  // Cron-only (no user session): the RLS-scoped client would see no rows at all.
  const supabase = createAdminClient();
  const cutoffMs = now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const { error, count } = await supabase.from("marketing_metric_snapshots").delete({ count: "exact" }).lt("recorded_at", new Date(cutoffMs).toISOString());
  if (error) throw new ChannelsError("DATABASE_ERROR", "오래된 채널 지표 스냅샷을 정리하지 못했습니다.", { cause: error });
  const { error: contentError } = await supabase.from("channel_content_snapshots").delete().lt("snapshot_date", kstDateString(cutoffMs));
  if (contentError) throw new ChannelsError("DATABASE_ERROR", "오래된 게시물 통계를 정리하지 못했습니다.", { cause: contentError });
  return count ?? 0;
}

/**
 * Collects fresh public metrics for one channel and persists them (metrics, per-video rows, display info, status).
 * No scheduling or failure-count side effects here: processDueChannels and the manual paths own those.
 */
export async function collectAndPersistChannel(channel: TrackedChannelForCollection, businessName: string | undefined, now: Date) {
  const raw = await collectRawChannelMetrics(channel, businessName, now);
  return persistChannelCollection({ channelId: channel.id, raw, now });
}

export interface ProcessDueChannelsResult {
  processed: number;
  failed: number;
  paused: number;
  skipped: number;
  quotaExceeded: boolean;
}

export interface ProcessDueChannelsOptions {
  trigger?: Extract<CollectionTrigger, "CRON" | "MANUAL_ADMIN">;
  triggeredBy?: string | null;
  /** Admin "지금 수집": collect every ACTIVE channel now, not only the due ones. */
  all?: boolean;
}

/**
 * What a failed attempt changes: when the channel is tried next, whether it counts as a failure, and whether it is paused.
 *  - TRANSIENT: a few retries within the day (30 min apart, or what the source asked for), then the next daily slot, and
 *    the longer the streak the longer the gap (daily → every other day → weekly). Never paused.
 *  - NOT_FOUND: one attempt per day; paused after MAX_NOT_FOUND_DAYS days in a row.
 *  - CONFIG: not counted; looked at again in a few hours.
 *  A channel that is already paused (a probe that failed) stays paused and is probed again in a week.
 */
export function planFailure(params: { kind: Exclude<FailureKind, "QUOTA">; failuresBefore: number; paused: boolean; now: Date; retryAfterMs?: number }): { nextAt: Date; failures: number; pause: boolean } {
  const { kind, failuresBefore, paused, now, retryAfterMs } = params;
  if (kind === "CONFIG") return { nextAt: new Date(now.getTime() + CONFIG_RETRY_MS), failures: failuresBefore, pause: paused };
  const failures = failuresBefore + 1;
  if (paused) return { nextAt: nextDailyCollectionAt(new Date(now.getTime() + (PAUSED_PROBE_DAYS - 1) * 86_400_000)), failures, pause: true };
  if (kind === "NOT_FOUND") return { nextAt: nextDailyCollectionAt(now), failures, pause: failures >= MAX_NOT_FOUND_DAYS };
  // TRANSIENT
  const retryLater = failures % MAX_RETRIES_PER_SLOT !== 0;
  const base = retryLater ? new Date(now.getTime() + RETRY_DELAY_MS) : nextDailyCollectionAt(new Date(now.getTime() + (BACKOFF_DAYS(failures) - 1) * 86_400_000));
  const asked = retryAfterMs ? new Date(now.getTime() + retryAfterMs) : null;
  return { nextAt: asked && asked > base ? asked : base, failures, pause: false };
}

/**
 * The cron path: channels whose next_snapshot_at has passed (06:00 KST each day, see schedule.ts) get a fresh
 * collection. Safe to call on every 5-minute tick:
 *  - a channel is CLAIMED first (next_snapshot_at pushed forward under a compare-and-set), so two overlapping ticks or an
 *    admin click can never collect the same channel twice;
 *  - a time budget stops the loop before the route's deadline, leaving the rest due for the next tick;
 *  - one broken channel never affects the others, and a failed attempt never touches earlier good data;
 *  - when YouTube's quota is exhausted the remaining YouTube channels are left untouched and retried an hour later.
 * Every batch that found work leaves a row in channel_collection_runs (the admin log).
 */
export async function processDueChannels(now: Date = new Date(), budgetMs = 30_000, options: ProcessDueChannelsOptions = {}): Promise<ProcessDueChannelsResult> {
  // Cron-only, behind CRON_SECRET: there is no user session, so the
  // RLS-scoped client would read zero channels and update nothing.
  const supabase = createAdminClient();
  const deadline = Date.now() + budgetMs;
  const trigger = options.trigger ?? "CRON";

  let query = supabase
    .from("tracked_channels")
    .select("id, business_id, platform, external_id, url, status, consecutive_failure_count, next_snapshot_at")
    // PAUSED channels are probed too (see PAUSED_PROBE_DAYS): a paused channel is not abandoned.
    .in("status", ["ACTIVE", "PAUSED"]);
  // Rows registered before next_snapshot_at was set on insert are null — treat them as due.
  if (!options.all) query = query.or(`next_snapshot_at.is.null,next_snapshot_at.lte.${now.toISOString()}`);
  const { data: due, error: dueError } = await query.order("next_snapshot_at", { ascending: true, nullsFirst: true }).limit(MAX_CHANNELS_PER_TICK);
  if (dueError) throw new ChannelsError("DATABASE_ERROR", "수집 대상 채널을 불러오지 못했습니다.", { cause: dueError });

  const result: ProcessDueChannelsResult = { processed: 0, failed: 0, paused: 0, skipped: 0, quotaExceeded: false };
  if (!due || due.length === 0) return result;

  const runId = await startCollectionRun({ trigger, scheduledFor: options.all ? now : currentCollectionSlot(now), triggeredBy: options.triggeredBy, now });
  const failureNotes: string[] = [];
  let quotaHit = false;

  for (const channel of due) {
    if (Date.now() > deadline) {
      result.skipped++;
      continue;
    }

    const platform = channelPlatformSchema.safeParse(channel.platform);
    if (!platform.success) {
      result.skipped++;
      continue;
    }
    // Quota is exhausted for the whole YouTube API: don't spend another call, try again later.
    if (quotaHit && platform.data === "youtube") {
      await supabase.from("tracked_channels").update({ next_snapshot_at: new Date(now.getTime() + QUOTA_RETRY_MS).toISOString() }).eq("id", channel.id);
      result.skipped++;
      continue;
    }

    // Claim: only the request that moves next_snapshot_at away from the value it just read may collect.
    let claim = supabase.from("tracked_channels").update({ next_snapshot_at: new Date(now.getTime() + CLAIM_MS).toISOString() }).eq("id", channel.id).eq("status", channel.status);
    claim = channel.next_snapshot_at === null ? claim.is("next_snapshot_at", null) : claim.eq("next_snapshot_at", channel.next_snapshot_at);
    const { data: claimed, error: claimError } = await claim.select("id");
    if (claimError || !claimed || claimed.length === 0) {
      result.skipped++;
      continue;
    }

    const { data: business } = await supabase.from("businesses").select("name").eq("id", channel.business_id).maybeSingle();

    try {
      const typed = { id: channel.id, external_id: channel.external_id, url: channel.url, platform: platform.data };
      const saved = await collectAndPersistChannel(typed, business?.name, now);
      const update: TrackedChannelUpdate = { next_snapshot_at: nextDailyCollectionAt(now).toISOString() };
      // The source answered, so the error streak (which pauses a channel and sets the retry cadence) ends either way.
      if (channel.consecutive_failure_count > 0) update.consecutive_failure_count = 0;
      // An unreadable blog (no public posts, or robots.txt keeps it unread) is a failed day in the run log and shows as
      // UNAVAILABLE on the channel, but it is not an error: it keeps being checked daily (cheap) and starts recording as
      // soon as posts become readable. Counting it toward the pause streak would let one later timeout pause it for good.
      if (saved.status === "UNAVAILABLE") {
        result.failed++;
        failureNotes.push(`${channel.platform}:${channel.external_id} 공개 데이터를 확인하지 못했어요`);
      } else {
        result.processed++;
      }
      await supabase.from("tracked_channels").update(update).eq("id", channel.id);
    } catch (cause) {
      const failure = classifyCollectionError(cause);
      await recordCollectionFailure(channel.id, cause, now).catch(() => undefined);
      if (failure.kind === "QUOTA") {
        quotaHit = true;
        result.quotaExceeded = true;
        await supabase.from("tracked_channels").update({ next_snapshot_at: new Date(now.getTime() + QUOTA_RETRY_MS).toISOString() }).eq("id", channel.id);
        result.skipped++;
        failureNotes.push("YouTube API 일일 한도를 넘어 잠시 쉬어요");
        continue;
      }
      const plan = planFailure({ kind: failure.kind, failuresBefore: channel.consecutive_failure_count, paused: channel.status === "PAUSED", now, retryAfterMs: failure.retryAfterMs });
      const update: TrackedChannelUpdate = { consecutive_failure_count: plan.failures, next_snapshot_at: plan.nextAt.toISOString() };
      if (plan.pause && channel.status !== "PAUSED") {
        update.status = "PAUSED";
        result.paused++;
      }
      await supabase.from("tracked_channels").update(update).eq("id", channel.id);
      result.failed++;
      failureNotes.push(`${channel.platform}:${channel.external_id} ${failure.code}`);
      logger.warn("channel_collection_failed", {
        channelId: channel.id,
        platform: channel.platform,
        kind: failure.kind,
        code: failure.code,
        consecutiveFailureCount: plan.failures,
        paused: plan.pause,
        nextAttemptAt: plan.nextAt.toISOString(),
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  await finishCollectionRun(
    runId,
    { total: due.length, succeeded: result.processed, failed: result.failed, skipped: result.skipped, quotaExceeded: result.quotaExceeded, errorSummary: failureNotes.slice(0, 20).join("\n") || null },
    new Date(),
  );
  return result;
}
