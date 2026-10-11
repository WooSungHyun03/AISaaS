import "server-only";
import { serverEnv } from "@/lib/env/server";
import { YouTubeChannelDataProvider } from "./youtube";
import { MockYouTubeDataProvider } from "./youtube-mock";
import type { YouTubeDataProvider } from "./youtube-types";
import { collectTistoryRssMetrics } from "./tistory";
import { collectMockTistoryRssMetrics } from "./tistory-mock";
import type { TistoryCollector } from "./tistory";
import { collectNaverBlogLive } from "./naver-blog-live";
import { collectMockNaverBlogMetrics } from "./naver-blog-mock";
import type { NaverBlogCollector } from "./naver-types";
import { collectMockYouTubeAnalytics } from "./youtube-analytics-mock";
import type { YouTubeAnalyticsCollector } from "./youtube-analytics-types";
import { collectYouTubeAnalyticsLive } from "@/server/connectors/youtube/analytics";

let cachedProvider: YouTubeDataProvider | undefined;

/** Picks the active YouTubeDataProvider based on CHANNEL_DATA_PROVIDER. Cached per process (mirrors src/server/ai/index.ts's getAIProvider). */
export function getYouTubeDataProvider(): YouTubeDataProvider {
  if (cachedProvider) return cachedProvider;
  cachedProvider = serverEnv.CHANNEL_DATA_PROVIDER === "live" ? new YouTubeChannelDataProvider() : new MockYouTubeDataProvider();
  return cachedProvider;
}

/** Picks the active Tistory RSS collector based on CHANNEL_DATA_PROVIDER. Plain functions, not classes — no per-process cache needed (unlike getYouTubeDataProvider, which caches an instance). */
export function getTistoryCollector(): TistoryCollector {
  return serverEnv.CHANNEL_DATA_PROVIDER === "live" ? collectTistoryRssMetrics : collectMockTistoryRssMetrics;
}

/** Picks the active Naver Blog collector based on CHANNEL_DATA_PROVIDER (live: public RSS first, search as a fallback). */
export function getNaverBlogCollector(): NaverBlogCollector {
  return serverEnv.CHANNEL_DATA_PROVIDER === "live" ? collectNaverBlogLive : collectMockNaverBlogMetrics;
}

/**
 * Ticket 1-10: owner-only YouTube Analytics. `mock` returns deterministic
 * sample days; `live` calls the real YouTube Analytics API with the
 * channel owner's OAuth token (src/server/connectors/youtube/analytics.ts).
 * The pipeline only calls it for a CONNECTED connection whose consent
 * included yt-analytics.readonly.
 */
export function getYouTubeAnalyticsCollector(): YouTubeAnalyticsCollector {
  return serverEnv.CHANNEL_DATA_PROVIDER === "live" ? collectYouTubeAnalyticsLive : collectMockYouTubeAnalytics;
}

export * from "./youtube-types";
export * from "./tistory";
export * from "./naver-types";
export * from "./youtube-analytics-types";
