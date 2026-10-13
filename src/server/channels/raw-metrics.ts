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

const DAY_MS = 86_400_000;

function postsWithin(dates: string[], now: Date, days: number): number {
  const nowMs = now.getTime();
  return dates.filter((iso) => {
    const age = nowMs - Date.parse(iso);
    return age >= 0 && age < days * DAY_MS;
  }).length;
}

/**
 * Flattens one collection into the plain metric→value map that gets saved
 * as growth-over-time snapshots (`marketing_metric_snapshots`, ticket 1-6).
 * Kept separate from diagnose.ts's own per-platform metrics-record builders
 * — those capture "what a score was computed from" for one diagnosis row,
 * a different (richer, e.g. youtube's averageRecentViews) shape than this
 * time-series one.
 *
 * An EMPTY record means "nothing could be measured" (a private/unreachable blog, a feed without posts): callers
 * must record that as an unavailable collection, never as a measured 0.
 */
export function toSnapshotMetricsRecord(raw: RawChannelMetrics, now: Date = new Date()): Record<string, number> {
  switch (raw.platform) {
    case "youtube": {
      const result: Record<string, number> = { viewCount: raw.metrics.viewCount, videoCount: raw.metrics.videoCount };
      if (raw.metrics.subscriberCount !== null) result.subscriberCount = raw.metrics.subscriberCount;
      return result;
    }
    case "tistory": {
      if (raw.metrics.unavailableReason !== null) return {};
      const dates = raw.metrics.posts.map((post) => post.publishedAt);
      return { postCount: dates.length, postsLast7Days: postsWithin(dates, now, 7), postsLast30Days: postsWithin(dates, now, 30) };
    }
    case "naver_blog": {
      if (raw.metrics.matchedPostCount === 0) return {};
      const result: Record<string, number> = { matchedPostCount: raw.metrics.matchedPostCount, postsLast30Days: raw.metrics.postsLast30Days };
      if (raw.metrics.posts) result.postsLast7Days = postsWithin(raw.metrics.posts.map((post) => post.publishedAt), now, 7);
      return result;
    }
  }
}

/** The per-video / per-post rows to keep for a collection: public title, link, publish time and the counts the platform shows. */
export interface ContentSnapshotInput {
  externalContentId: string;
  title: string | null;
  url: string | null;
  publishedAt: string | null;
  metrics: Record<string, number>;
}

const MAX_CONTENT_SNAPSHOTS = 20;

export function toContentSnapshots(raw: RawChannelMetrics): ContentSnapshotInput[] {
  switch (raw.platform) {
    case "youtube":
      return raw.metrics.recentVideos
        .filter((video): video is typeof video & { videoId: string } => Boolean(video.videoId))
        .slice(0, MAX_CONTENT_SNAPSHOTS)
        .map((video) => ({
          externalContentId: video.videoId,
          title: video.title ?? null,
          url: `https://www.youtube.com/watch?v=${video.videoId}`,
          publishedAt: video.publishedAt,
          metrics: {
            viewCount: video.viewCount,
            ...(typeof video.likeCount === "number" ? { likeCount: video.likeCount } : {}),
            ...(typeof video.commentCount === "number" ? { commentCount: video.commentCount } : {}),
          },
        }));
    case "tistory":
      return raw.metrics.posts
        .filter((post) => Boolean(post.url))
        .slice(0, MAX_CONTENT_SNAPSHOTS)
        .map((post) => ({ externalContentId: post.url as string, title: post.title ?? null, url: post.url ?? null, publishedAt: post.publishedAt, metrics: {} }));
    case "naver_blog":
      return (raw.metrics.posts ?? [])
        .filter((post) => Boolean(post.url))
        .slice(0, MAX_CONTENT_SNAPSHOTS)
        .map((post) => ({ externalContentId: post.url as string, title: post.title, url: post.url, publishedAt: post.publishedAt, metrics: {} }));
  }
}

/** Public display info (name, profile image) a collection learned about the channel. */
export function toChannelDisplayInfo(raw: RawChannelMetrics): { displayName: string | null; thumbnailUrl: string | null } {
  switch (raw.platform) {
    case "youtube":
      return { displayName: raw.metrics.title ?? null, thumbnailUrl: raw.metrics.thumbnailUrl ?? null };
    case "tistory":
      return { displayName: raw.metrics.blogTitle ?? null, thumbnailUrl: null };
    case "naver_blog":
      return { displayName: raw.metrics.blogTitle ?? null, thumbnailUrl: null };
  }
}
