import "server-only";
import { serverEnv } from "@/lib/env/server";
import type { PlatformConnector, PublishContentParams, PublishResult } from "../types";

/**
 * Placeholder — YouTube Data API integration for Shorts automation.
 * Interface only for now; implement publish() (upload) when Shorts
 * automation moves from "Coming Soon" to "Beta" in the marketplace.
 */
export class YouTubeConnector implements PlatformConnector {
  readonly name = "youtube";

  isConfigured(): boolean {
    return Boolean(serverEnv.YOUTUBE_CLIENT_ID && serverEnv.YOUTUBE_CLIENT_SECRET && serverEnv.YOUTUBE_REFRESH_TOKEN);
  }

  async publish(_params: PublishContentParams): Promise<PublishResult> {
    throw new Error("YouTube connector is not implemented yet.");
  }
}
