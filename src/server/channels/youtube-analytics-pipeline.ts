import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/logger";
import { getConnection, updateConnectionStatus } from "@/server/connectors/integrations";
import { YouTubeAnalyticsError } from "@/server/connectors/youtube/analytics";
import type { IntegrationConnection, Json } from "@/types/domain";
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

  const collector = getYouTubeAnalyticsCollector();

  let connection: IntegrationConnection | null = null;
  const admin = createAdminClient();
  try {
    connection = await getConnection(admin, ownerId, channel.business_id, "youtube");
    if (!connection || connection.status !== "CONNECTED") return;
    if (!hasYouTubeAnalyticsScope(connection)) return;

    const days = await collector({ userId: ownerId, businessId: channel.business_id, externalId: channel.external_id, now });
    const source = serverEnv.CHANNEL_DATA_PROVIDER;

    for (const day of days) {
      const recordedAt = kstMidnight(day.date);
      const save = (metric: string, value: number) => saveMetricSnapshot({ channelId: channel.id, metric: `yt_analytics.${metric}`, value, source, recordedAt });
      await save("views", day.views);
      await save("estimatedMinutesWatched", day.estimatedMinutesWatched);
      await save("averageViewDuration", day.averageViewDuration);
      await save("netSubscribers", day.subscribersGained - day.subscribersLost);
    }
    await recordAnalyticsOutcome(admin, connection, now, days.length > 0 ? "OK" : "WAITING_FOR_DATA");
  } catch (cause) {
    const failure = cause instanceof YouTubeAnalyticsError ? cause.failure : "UNKNOWN";
    logger.warn("youtube_analytics_collection_failed", {
      channelId: channel.id,
      businessId: channel.business_id,
      failure,
      message: cause instanceof Error ? cause.message : String(cause),
    });
    if (connection) await recordAnalyticsOutcome(admin, connection, now, failure);
  }
}

/**
 * Remembers on the connection why Analytics is (not) flowing so the growth report can tell the
 * owner what to do instead of showing an empty chart. Never throws: this is bookkeeping.
 */
async function recordAnalyticsOutcome(
  admin: ReturnType<typeof createAdminClient>,
  connection: IntegrationConnection,
  now: Date,
  status: string,
): Promise<void> {
  try {
    const current = connection.metadata && typeof connection.metadata === "object" && !Array.isArray(connection.metadata) ? connection.metadata : {};
    await updateConnectionStatus(admin, connection.id, connection.status, {
      ...current,
      analytics: { status, checkedAt: now.toISOString() } as Json,
    });
  } catch (cause) {
    logger.warn("youtube_analytics_outcome_not_recorded", { connectionId: connection.id, message: cause instanceof Error ? cause.message : String(cause) });
  }
}
