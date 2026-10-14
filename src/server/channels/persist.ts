import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env/server";
import { ChannelsError } from "./summary";
import { saveMetricSnapshot } from "./snapshot";
import { toChannelDisplayInfo, toContentSnapshots, toSnapshotMetricsRecord } from "./raw-metrics";
import type { RawChannelMetrics } from "./raw-metrics";
import { kstDateString, nextDailyCollectionAt } from "./schedule";
import { YouTubeCollectorError } from "./providers/youtube-types";
import type { Json } from "@/types/domain";

export type CollectionStatus = "SUCCESS" | "FAILED" | "QUOTA_EXCEEDED" | "UNAVAILABLE";

/** Maps whatever a collector threw to what the owner and the admin log should say. */
export function classifyCollectionError(error: unknown): { status: Exclude<CollectionStatus, "SUCCESS">; code: string } {
  if (error instanceof YouTubeCollectorError) {
    if (error.code === "QUOTA_EXCEEDED") return { status: "QUOTA_EXCEEDED", code: error.code };
    if (error.code === "CHANNEL_NOT_FOUND") return { status: "UNAVAILABLE", code: error.code };
    return { status: "FAILED", code: error.code };
  }
  const code = error instanceof Error && error.name ? error.name : "UNKNOWN";
  return { status: "FAILED", code };
}

/**
 * Saves one collection: the channel-level metric snapshots (one per metric per KST day, same-day re-runs overwrite),
 * the per-video / per-post rows, and the display info + status on the channel. Nothing is written for a metric the
 * platform did not give us — an unreadable blog is recorded as UNAVAILABLE, never as 0 posts.
 * Uses the service role: these tables have no insert policy for users, so growth numbers cannot be forged (0036).
 */
export async function persistChannelCollection(params: { channelId: string; raw: RawChannelMetrics; now: Date }): Promise<{ metricsSaved: number; contentSaved: number; status: Extract<CollectionStatus, "SUCCESS" | "UNAVAILABLE"> }> {
  const { channelId, raw, now } = params;
  const admin = createAdminClient();
  const source = serverEnv.CHANNEL_DATA_PROVIDER;

  const metrics = toSnapshotMetricsRecord(raw, now);
  for (const [metric, value] of Object.entries(metrics)) {
    await saveMetricSnapshot({ channelId, metric, value, source, recordedAt: now });
  }

  const content = toContentSnapshots(raw);
  if (content.length > 0) {
    const snapshotDate = kstDateString(now);
    const { error } = await admin.from("channel_content_snapshots").upsert(
      content.map((item) => ({
        channel_id: channelId,
        external_content_id: item.externalContentId.slice(0, 500),
        title: item.title,
        url: item.url,
        published_at: item.publishedAt,
        snapshot_date: snapshotDate,
        metrics: item.metrics as unknown as Json,
        collected_at: now.toISOString(),
      })),
      { onConflict: "channel_id,external_content_id,snapshot_date" },
    );
    if (error) throw new ChannelsError("DATABASE_ERROR", "게시물별 통계를 저장하지 못했습니다.", { cause: error });
  }

  const status = Object.keys(metrics).length > 0 ? "SUCCESS" : "UNAVAILABLE";
  const display = toChannelDisplayInfo(raw);
  const { error: updateError } = await admin
    .from("tracked_channels")
    .update({
      ...(display.displayName ? { display_name: display.displayName } : {}),
      ...(display.thumbnailUrl ? { thumbnail_url: display.thumbnailUrl } : {}),
      last_collected_at: now.toISOString(),
      last_collection_status: status,
      last_error_code: status === "UNAVAILABLE" ? "NO_PUBLIC_DATA" : null,
    })
    .eq("id", channelId);
  if (updateError) throw new ChannelsError("DATABASE_ERROR", "채널 수집 상태를 저장하지 못했습니다.", { cause: updateError });

  // The daily collection pauses a channel after a long error streak and never picks it up again. When the owner's
  // "다시 진단하기" (or registering the same address again) reaches the source, daily collection resumes from the
  // next 06:00 KST. Only touches non-ACTIVE rows, so the daily run's own claim/next_snapshot_at is never overwritten.
  const { error: resumeError } = await admin
    .from("tracked_channels")
    .update({ status: "ACTIVE", consecutive_failure_count: 0, next_snapshot_at: nextDailyCollectionAt(now).toISOString() })
    .eq("id", channelId)
    .neq("status", "ACTIVE");
  if (resumeError) throw new ChannelsError("DATABASE_ERROR", "채널 수집을 다시 시작하지 못했습니다.", { cause: resumeError });

  return { metricsSaved: Object.keys(metrics).length, contentSaved: content.length, status };
}

/** Records a failed collection on the channel without touching any earlier, good data. */
export async function recordCollectionFailure(channelId: string, error: unknown, now: Date): Promise<void> {
  const { status, code } = classifyCollectionError(error);
  const { error: updateError } = await createAdminClient()
    .from("tracked_channels")
    .update({ last_collected_at: now.toISOString(), last_collection_status: status, last_error_code: code })
    .eq("id", channelId);
  if (updateError) throw new ChannelsError("DATABASE_ERROR", "채널 수집 상태를 저장하지 못했습니다.", { cause: updateError });
}
