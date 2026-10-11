import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/logger";
import { getConnection } from "@/server/connectors/integrations";
import { getYouTubeAnalyticsCollector } from "./providers";
import { hasYouTubeAnalyticsScope } from "./youtube-analytics-scope";
import { saveMetricSnapshot } from "./snapshot";
import type { TrackedChannelForCollection } from "./raw-metrics";

/** KST midnight for a `YYYY-MM-DD` data date, so recorded_date (generated from recorded_at in KST) lands on that exact day, not whatever day `now` happens to be. */
function kstMidnight(date: string): Date {
  return new Date(`${date}T00:00:00+09:00`);
}

/**
 * Ticket 1-10 step 3: collects advanced YouTube Analytics for one tracked
 * channel, saved under the `yt_analytics.*` metric namespace — distinct
 * from (and additive to) the public-metrics snapshot that
 * snapshotChannelMetrics already writes. Called right after that function
 * succeeds, from both processDueChannels (cron) and collectChannelNow
 * ("지금 수집"); never from diagnoseChannel, so this has no effect on the
 * per-hour diagnosis rate limit (channel_diagnosis_attempts).
 *
 * Every exit before the final loop is a silent no-op, and everything after
 * is wrapped in try/catch that only logs — a failure (or an intentionally
 * absent live implementation) here must never throw back into the caller,
 * since that would fail the public-metrics collection it's attached to.
 */
export async function collectYouTubeAnalyticsIfConnected(
  channel: TrackedChannelForCollection & { business_id: string },
  ownerId: string | null | undefined,
  now: Date,
): Promise<void> {
  if (channel.platform !== "youtube" || !ownerId) return;

  // null = no real (OAuth-backed) implementation yet (CHANNEL_DATA_PROVIDER=live).
  // Skip outright rather than call-and-catch: there is nothing to call.
  const collector = getYouTubeAnalyticsCollector();
  if (!collector) return;

  try {
    const admin = createAdminClient();
    const connection = await getConnection(admin, ownerId, channel.business_id, "youtube");
    if (!connection || connection.status !== "CONNECTED") return;
    if (!hasYouTubeAnalyticsScope(connection)) return;

    const days = await collector({ userId: ownerId, businessId: channel.business_id, externalId: channel.external_id, now });
    const source = serverEnv.CHANNEL_DATA_PROVIDER;

    for (const day of days) {
      const recordedAt = kstMidnight(day.date);
      await saveMetricSnapshot({ channelId: channel.id, metric: "yt_analytics.estimatedMinutesWatched", value: day.estimatedMinutesWatched, source, recordedAt });
      await saveMetricSnapshot({ channelId: channel.id, metric: "yt_analytics.averageViewDuration", value: day.averageViewDuration, source, recordedAt });
    }
  } catch (cause) {
    logger.warn("youtube_analytics_collection_failed", {
      channelId: channel.id,
      businessId: channel.business_id,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
