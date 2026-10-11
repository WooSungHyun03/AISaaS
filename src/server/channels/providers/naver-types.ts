export type NaverCollectorErrorCode = "RATE_LIMITED" | "INVALID_CREDENTIALS" | "INVALID_RESPONSE" | "UNKNOWN";

/** Same shape as YouTubeCollectorError/CalendarPlanError/DiagnosisError (plain Error subclass + code). */
export class NaverCollectorError extends Error {
  constructor(
    public readonly code: NaverCollectorErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "NaverCollectorError";
  }
}

/**
 * Only count/date-derived values — never the raw search result bodies
 * (title/description/link). Enforced structurally: this type has no field
 * to put them in, so a persistence step can't accidentally pass them
 * through even by mistake.
 */
export interface NaverBlogMetrics {
  matchedPostCount: number;
  postsLast30Days: number;
  averageGapDays: number | null;
  /** KST date (YYYY-MM-DD) — postdate has no time component. */
  lastPostDate: string | null;
  firstPostDate: string | null;
  /**
   * Where the posts came from: the blog's own RSS (`rss`, its latest posts) or blog search (`search`, only posts
   * that mention the blog id). Missing on rows/mocks from before RSS support, which were search-based.
   */
  basis?: "rss" | "search";
}

export type NaverBlogCollector = (externalId: string, businessName: string | undefined, now?: Date) => Promise<NaverBlogMetrics>;
