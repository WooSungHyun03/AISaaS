import "server-only";
import { getNaverBlogCollector, getTistoryCollector, getYouTubeDataProvider } from "./providers";
import type { YouTubeRawMetrics } from "./providers/youtube-types";
import type { TistoryRssMetrics } from "./providers/tistory";
import type { NaverBlogMetrics } from "./providers/naver-types";
import type { ChannelPlatform } from "./platform";
import type { TrackedChannel } from "@/types/domain";

export type TrackedChannelForCollection = Pick<TrackedChannel, "id" | "external_id" | "url"> & { platform: ChannelPlatform };

/**
 * One (channel, point-in-time) collection, still in each platform's own
 * shape — the platform tag lets callers `switch` exhaustively without a
 * second lookup of `channel.platform`.
 */
export type RawChannelMetrics =
  | { platform: "youtube"; metrics: YouTubeRawMetrics }
  | { platform: "tistory"; metrics: TistoryRssMetrics }
  | { platform: "naver_blog"; metrics: NaverBlogMetrics };

/**
 * Single place for "which of 1-2/1-3/1-4's collectors matches this
 * channel's platform" — shared by collect-pipeline.ts (flattens the result
 * into a growth-snapshot metric map) and diagnose.ts (scores the full raw
 * shape), so the platform switch exists in exactly one place.
 */
export async function collectRawChannelMetrics(channel: TrackedChannelForCollection, businessName: string | undefined, now: Date): Promise<RawChannelMetrics> {
  switch (channel.platform) {
    case "youtube":
      return { platform: "youtube", metrics: await getYouTubeDataProvider().collect(channel.external_id, now) };
    case "tistory":
      return { platform: "tistory", metrics: await getTistoryCollector()(channel.url, now) };
    case "naver_blog":
      return { platform: "naver_blog", metrics: await getNaverBlogCollector()(channel.external_id, businessName, now) };
    default: {
      // Exhaustiveness guard — a new ChannelPlatform value without a case here is a bug, not a runtime "unsupported platform" a caller should handle.
      const unreachable: never = channel.platform;
      throw new Error(`Unhandled channel platform: ${unreachable}`);
    }
  }
}

/**
 * Flattens one collection into the plain metric→value map that gets saved
 * as growth-over-time snapshots (`marketing_metric_snapshots`, ticket 1-6).
 * Kept separate from diagnose.ts's own per-platform metrics-record builders
 * — those capture "what a score was computed from" for one diagnosis row,
 * a different (richer, e.g. youtube's averageRecentViews) shape than this
 * time-series one.
 */
export function toSnapshotMetricsRecord(raw: RawChannelMetrics): Record<string, number> {
  switch (raw.platform) {
    case "youtube": {
      const result: Record<string, number> = { viewCount: raw.metrics.viewCount, videoCount: raw.metrics.videoCount };
      if (raw.metrics.subscriberCount !== null) result.subscriberCount = raw.metrics.subscriberCount;
      return result;
    }
    case "tistory":
      return { postCount: raw.metrics.posts.length };
    case "naver_blog":
      return { matchedPostCount: raw.metrics.matchedPostCount, postsLast30Days: raw.metrics.postsLast30Days };
  }
}
