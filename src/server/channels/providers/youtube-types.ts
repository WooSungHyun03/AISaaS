/**
 * One video from the channel's uploads, as far back as the collector looked
 * (up to 50 — see youtube.ts). Only what scoring needs; no title/description.
 */
export interface YouTubeRecentVideo {
  publishedAt: string; // ISO timestamp
  viewCount: number;
}

/** Everything scoreYouTubeChannel() needs. No raw title/description text — see scoring's "never store search result bodies" rule in the sibling Naver/Tistory collectors. */
export interface YouTubeRawMetrics {
  /** Null when the channel owner hides it (statistics.hiddenSubscriberCount). */
  subscriberCount: number | null;
  hiddenSubscriberCount: boolean;
  viewCount: number;
  videoCount: number;
  /** Newest first, at most 50 — see YouTubeChannelDataProvider.collect(). */
  recentVideos: YouTubeRecentVideo[];
}

export type YouTubeCollectorErrorCode = "TIMEOUT" | "QUOTA_EXCEEDED" | "CHANNEL_NOT_FOUND" | "INVALID_API_KEY" | "UNKNOWN";

/**
 * Same shape as CalendarPlanError/DiagnosisError/ChannelsError in this
 * domain (plain Error subclass + code), not the connector-wide
 * AppError/ConnectorError taxonomy — that one is for publishing connectors
 * (src/server/connectors/), a different concern from read-only public-data
 * collection.
 */
export class YouTubeCollectorError extends Error {
  constructor(
    public readonly code: YouTubeCollectorErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "YouTubeCollectorError";
  }
}

export interface YouTubeDataProvider {
  /**
   * externalId is a tracked_channels.external_id: "@handle" or a bare
   * "UC..." channel id — see url-parser.ts. `now` lets the mock provider
   * generate upload dates relative to the same clock a test's
   * scoreYouTubeChannel(metrics, now) call uses, so a fixed `now` makes the
   * whole collect+score pipeline reproducible; the live provider ignores it
   * (YouTube's own timestamps are used as-is).
   */
  collect(externalId: string, now?: Date): Promise<YouTubeRawMetrics>;
}
