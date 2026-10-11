import "server-only";
import { serverEnv } from "@/lib/env/server";
import { YouTubeChannelDataProvider } from "./youtube";
import { MockYouTubeDataProvider } from "./youtube-mock";
import type { YouTubeDataProvider } from "./youtube-types";
import { collectTistoryRssMetrics } from "./tistory";
import { collectMockTistoryRssMetrics } from "./tistory-mock";
import type { TistoryCollector } from "./tistory";
import { collectNaverBlogMetrics } from "./naver-blog";
import { collectMockNaverBlogMetrics } from "./naver-blog-mock";
import type { NaverBlogCollector } from "./naver-types";
import { collectMockYouTubeAnalytics } from "./youtube-analytics-mock";
import type { YouTubeAnalyticsCollector } from "./youtube-analytics-types";

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

/** Picks the active Naver Blog search collector based on CHANNEL_DATA_PROVIDER. */
export function getNaverBlogCollector(): NaverBlogCollector {
  return serverEnv.CHANNEL_DATA_PROVIDER === "live" ? collectNaverBlogMetrics : collectMockNaverBlogMetrics;
}

/**
 * Ticket 1-10: unlike the other getXCollector()s above, this can return
 * `null` — there is no real (OAuth-backed) implementation yet. That piece
 * is Dev1's to write in src/server/connectors/youtube/ and wire in here
 * (see docs/person1/REQUEST_FOR_DEV1_youtube_analytics.md). Returning
 * `null` for "live" lets the caller (youtube-analytics-pipeline.ts) skip
 * cleanly before even attempting anything — no throw-and-catch standing
 * in for "not implemented yet", and no risk of a mock value ever being
 * mistaken for a real one in production.
 */
export function getYouTubeAnalyticsCollector(): YouTubeAnalyticsCollector | null {
  if (serverEnv.CHANNEL_DATA_PROVIDER === "mock") return collectMockYouTubeAnalytics;
  return null;
}

export * from "./youtube-types";
export * from "./tistory";
export * from "./naver-types";
export * from "./youtube-analytics-types";
