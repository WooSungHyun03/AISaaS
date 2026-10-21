import { DiagnosisError } from "@/server/marketing/diagnosis";

/**
 * What a failed read of a blog feed means for the daily collection:
 *  - NOT_FOUND: the feed does not exist (404/410). Not a temporary outage; the owner has to fix the address.
 *  - FORBIDDEN: the blog answered 401/403, i.e. it is private. Reported as "cannot be measured", never as an error.
 *  - TRANSIENT: a timeout, a connection problem, a 429 or a 5xx. Worth trying again soon, never a reason to stop collecting.
 *  - OTHER: the answer was not a readable feed (format changed, too large, too many redirects).
 */
export type FeedFailureKind = "NOT_FOUND" | "FORBIDDEN" | "TRANSIENT" | "OTHER";

export interface FeedFailure {
  kind: FeedFailureKind;
  status?: number;
  retryAfterMs?: number;
}

export function classifyFeedFailure(error: DiagnosisError): FeedFailure {
  const { status, retryAfterMs } = error;
  if (status === 404 || status === 410) return { kind: "NOT_FOUND", status };
  if (status === 401 || status === 403) return { kind: "FORBIDDEN", status };
  if (status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500)) return { kind: "TRANSIENT", status, retryAfterMs };
  // A fetch that never got an HTTP answer (DNS, connection reset, timeout) is a transient problem; a refused 4xx is not.
  if (error.code === "FETCH_FAILED" && status === undefined) return { kind: "TRANSIENT" };
  return { kind: "OTHER", status };
}

/**
 * Thrown instead of "no data" when the blog could not be reached right now. The daily collection retries it with a
 * back-off (and honours `retryAfterMs`); it is never counted as a sign that the channel is gone.
 */
export class FeedTransientError extends Error {
  readonly code = "FEED_TRANSIENT";
  constructor(
    message: string,
    public readonly retryAfterMs?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "FeedTransientError";
  }
}
