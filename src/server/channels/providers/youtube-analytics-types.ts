/**
 * Ticket 1-10: shape for one connected YouTube channel's advanced
 * Analytics metrics, scoped to the yt-analytics.readonly OAuth scope —
 * only metrics confirmed against the official YouTube Analytics API docs
 * (developers.google.com/youtube/analytics, Channel reports,
 * `ids=channel==MINE`) are modeled here. There is deliberately no
 * "impressions" field: no such metric exists under yt-analytics.readonly
 * for organic (non-ad) channel reports — only annotation/card impressions
 * exist, which measure a different, legacy feature, and ad impressions
 * require a separate monetary scope. See
 * docs/person1/PLAN_1-10.md for the citations.
 */
export interface YouTubeAnalyticsDailyMetrics {
  /**
   * KST calendar date (YYYY-MM-DD) **this data is about**, exactly as the
   * YouTube Analytics API reports it for that `day` dimension row — never
   * "today" / the collection date. The API itself has a documented 48–72
   * hour processing delay (truncating the response to the last fully
   * processed day), so a value collected today is actually describing a
   * day from several days ago; stamping it with today's date would
   * silently misrepresent it in any day-over-day comparison.
   */
  date: string;
  /** Total minutes watched across the channel's videos on this day. */
  estimatedMinutesWatched: number;
  /** Average length, in seconds, of video playbacks on this day. */
  averageViewDuration: number;
}

/**
 * Fetches a trailing window of advanced Analytics for one connected,
 * already-scope-verified YouTube channel. The real (OAuth-backed)
 * implementation is Dev1's to write in src/server/connectors/youtube/ —
 * see docs/person1/REQUEST_FOR_DEV1_youtube_analytics.md — and wire into
 * getYouTubeAnalyticsCollector()'s live branch (providers/index.ts). This
 * file only defines the shape and a deterministic mock.
 *
 * Callers are expected to have already verified the channel's owner has a
 * CONNECTED youtube integration_connections row with the
 * yt-analytics.readonly scope (see youtube-analytics-scope.ts) — this
 * function itself does not re-check that.
 */
export type YouTubeAnalyticsCollector = (params: {
  userId: string;
  businessId: string;
  externalId: string;
  now: Date;
}) => Promise<YouTubeAnalyticsDailyMetrics[]>;
