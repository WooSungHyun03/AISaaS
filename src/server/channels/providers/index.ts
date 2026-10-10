import "server-only";
import { serverEnv } from "@/lib/env/server";
import { YouTubeChannelDataProvider } from "./youtube";
import { MockYouTubeDataProvider } from "./youtube-mock";
import type { YouTubeDataProvider } from "./youtube-types";

let cachedProvider: YouTubeDataProvider | undefined;

/** Picks the active YouTubeDataProvider based on CHANNEL_DATA_PROVIDER. Cached per process (mirrors src/server/ai/index.ts's getAIProvider). */
export function getYouTubeDataProvider(): YouTubeDataProvider {
  if (cachedProvider) return cachedProvider;
  cachedProvider = serverEnv.CHANNEL_DATA_PROVIDER === "live" ? new YouTubeChannelDataProvider() : new MockYouTubeDataProvider();
  return cachedProvider;
}

export * from "./youtube-types";
