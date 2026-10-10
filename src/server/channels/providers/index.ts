import "server-only";
import { serverEnv } from "@/lib/env/server";
import { YouTubeChannelDataProvider } from "./youtube";
import { MockYouTubeDataProvider } from "./youtube-mock";
import type { YouTubeDataProvider } from "./youtube-types";
import { collectTistoryRssMetrics } from "./tistory";
import { collectMockTistoryRssMetrics } from "./tistory-mock";
import type { TistoryCollector } from "./tistory";

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

export * from "./youtube-types";
export * from "./tistory";
