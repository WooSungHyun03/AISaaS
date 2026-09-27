import { AppError } from "@/server/shared/errors";

/**
 * Error codes for the GitHub-backed directory collector (github.ts) and,
 * later, the Sync Job / search / detail lookups that build on it.
 *
 * 5xx and a raw fetch() rejection are both folded into NETWORK_FAILURE —
 * from a caller's point of view "GitHub's servers had a problem" and
 * "couldn't reach GitHub at all" mean the same thing: try again later. This
 * keeps retry logic a single `if (error.retryable)` check instead of a
 * per-code table.
 */
export type DirectoryErrorCode = "RATE_LIMITED" | "AUTH_FAILED" | "NOT_FOUND" | "NETWORK_FAILURE" | "UNKNOWN";

const RETRYABLE_DIRECTORY_CODES: ReadonlySet<DirectoryErrorCode> = new Set(["RATE_LIMITED", "NETWORK_FAILURE"]);

/**
 * Thrown by src/server/directory/github.ts (and reused by the Sync Job,
 * search, and detail lookups once they exist). `retryAfter`, when set, is
 * only ever populated on a RATE_LIMITED error — the earliest instant a
 * caller (the future Sync Job) may safely call GitHub again.
 */
export class DirectoryError extends AppError {
  declare readonly code: DirectoryErrorCode;
  readonly retryAfter?: Date;

  constructor(code: DirectoryErrorCode, message: string, options?: { cause?: unknown; retryAfter?: Date }) {
    super("directory", code, message, { cause: options?.cause, retryable: RETRYABLE_DIRECTORY_CODES.has(code) });
    this.name = "DirectoryError";
    this.retryAfter = options?.retryAfter;
  }
}

export function isDirectoryError(error: unknown): error is DirectoryError {
  return error instanceof DirectoryError;
}
