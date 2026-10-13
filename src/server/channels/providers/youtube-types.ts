/**
 * One video from the channel's uploads, as far back as the collector looked
 * (up to 50 — see youtube.ts). Only what scoring needs; no title/description.
 */
export interface YouTubeRecentVideo {
  /** Video id (11 chars). Missing on rows from collectors that predate per-video snapshots. */
  videoId?: string;
  /** Public title; shown in the growth report's video list. */
  title?: string;
  publishedAt: string; // ISO timestamp
  viewCount: number;
  /** Null when the uploader hides likes (the API omits the field). */
  likeCount?: number | null;
  /** Null when comments are turned off. */
  commentCount?: number | null;
}

/** What the channel registration screen shows so the owner can confirm "yes, this is my channel" before saving. */
export interface YouTubeChannelPreview {
  /** Canonical channel id ("UC…", 24 chars) — what a registration stores. */
  channelId: string;
  title: string;
  /** "@handle" when the channel has one. */
  handle: string | null;
  thumbnailUrl: string | null;
  subscriberCount: number | null;
  videoCount: number;
}

/** How a channel can be looked up with the public API: exactly one of these is set. */
export type YouTubeChannelLookup = { handle: string } | { channelId: string } | { username: string };

/** Everything scoreYouTubeChannel() needs. No raw title/description text — see scoring's "never store search result bodies" rule in the sibling Naver/Tistory collectors. */
export interface YouTubeRawMetrics {
  /** Canonical channel id / public title / profile image, so a collection also keeps the display info fresh. */
  channelId?: string;
  title?: string | null;
  thumbnailUrl?: string | null;
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
  /** Public channel lookup by handle / channel id / legacy username (1 quota unit). Throws CHANNEL_NOT_FOUND. */
  lookup(input: YouTubeChannelLookup): Promise<YouTubeChannelPreview>;
}
