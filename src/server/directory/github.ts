import "server-only";
import { serverEnv } from "@/lib/env/server";
import { DirectoryError } from "./errors";

export interface GithubRepoStats {
  stars: number;
  forks: number;
  language: string | null;
  license: string | null;
  description: string | null;
}

/** GitHub's per-hour rate limit state as of the response that carried it. */
export interface GithubRateLimitInfo {
  remaining: number;
  resetAt: Date;
}

export interface FetchRepoStatsResult {
  stats: GithubRepoStats;
  rateLimit: GithubRateLimitInfo;
}

function parseRateLimitInfo(headers: Headers): GithubRateLimitInfo {
  const remaining = Number(headers.get("x-ratelimit-remaining") ?? "-1");
  const resetSeconds = Number(headers.get("x-ratelimit-reset") ?? "0");
  return { remaining, resetAt: new Date(resetSeconds * 1000) };
}

/**
 * The earliest instant it's safe to call GitHub again, derived from
 * whichever signal the response actually gave us: a `Retry-After` header
 * (seconds, used for GitHub's short-lived "secondary" rate limit) takes
 * priority over the hourly `x-ratelimit-reset` window.
 */
function computeRetryAfter(headers: Headers, rateLimit: GithubRateLimitInfo): Date | undefined {
  const retryAfterSeconds = headers.get("retry-after");
  if (retryAfterSeconds) return new Date(Date.now() + Number(retryAfterSeconds) * 1000);
  if (rateLimit.remaining === 0) return rateLimit.resetAt;
  return undefined;
}

function classifyErrorResponse(
  owner: string,
  repo: string,
  response: Response,
  rateLimit: GithubRateLimitInfo,
): DirectoryError {
  const hasRetryAfter = response.headers.get("retry-after") !== null;

  // A 403 can mean "rate limited" (primary: hourly quota exhausted, or
  // secondary: too many requests too fast, signaled by Retry-After) or
  // "not allowed" (private repo / insufficient token scope) — GitHub uses
  // the same status code for both, so the rate-limit signals are what
  // distinguish them.
  if (response.status === 429 || (response.status === 403 && (rateLimit.remaining === 0 || hasRetryAfter))) {
    return new DirectoryError("RATE_LIMITED", `GitHub rate limit hit for ${owner}/${repo} (${response.status}).`, {
      retryAfter: computeRetryAfter(response.headers, rateLimit),
    });
  }
  if (response.status === 401 || response.status === 403) {
    return new DirectoryError(
      "AUTH_FAILED",
      `GitHub denied access to ${owner}/${repo} (${response.status}) — check GITHUB_TOKEN or repo visibility.`,
    );
  }
  if (response.status === 404) {
    return new DirectoryError("NOT_FOUND", `${owner}/${repo} not found on GitHub (renamed, deleted, or private).`);
  }
  if (response.status >= 500) {
    // Treated the same as a transport-level failure below: from the
    // caller's side, "GitHub's servers errored" and "couldn't reach GitHub"
    // both just mean "safe to retry later".
    return new DirectoryError("NETWORK_FAILURE", `GitHub upstream error for ${owner}/${repo} (${response.status}).`);
  }
  return new DirectoryError("UNKNOWN", `Unexpected GitHub API response for ${owner}/${repo} (${response.status}).`);
}

/**
 * Whether a batch calling fetchRepoStats repeatedly should stop now rather
 * than keep going. This is a decision for the *caller* (the future Sync Job,
 * IMPLEMENTATION_GUIDE.md #2) — a single fetchRepoStats call can't safely
 * sleep until GitHub's hourly reset (up to an hour), so it only surfaces the
 * rate-limit state; the batch loop decides what to do with it.
 */
export function shouldStopForRateLimit(rateLimit: GithubRateLimitInfo, threshold = 5): boolean {
  return rateLimit.remaining <= threshold;
}

/**
 * Fetches public repo metadata for the AI Tool Directory. Works
 * unauthenticated (60 requests/hour) or with GITHUB_TOKEN (5000/hour) for
 * syncing a larger catalog. Throws DirectoryError, never a bare Error, so
 * callers can branch on `.code`/`.retryable` instead of matching text.
 */
export async function fetchRepoStats(owner: string, repo: string): Promise<FetchRepoStatsResult> {
  let response: Response;
  try {
    response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(serverEnv.GITHUB_TOKEN ? { Authorization: `Bearer ${serverEnv.GITHUB_TOKEN}` } : {}),
      },
      // Directory data changes slowly; avoid burning API rate limit on every request.
      next: { revalidate: 60 * 60 * 6 },
    });
  } catch (cause) {
    throw new DirectoryError("NETWORK_FAILURE", `Network request to GitHub failed for ${owner}/${repo}.`, { cause });
  }

  const rateLimit = parseRateLimitInfo(response.headers);

  if (!response.ok) {
    throw classifyErrorResponse(owner, repo, response, rateLimit);
  }

  const data = (await response.json()) as {
    stargazers_count: number;
    forks_count: number;
    language: string | null;
    license: { spdx_id: string } | null;
    description: string | null;
  };

  return {
    stats: {
      stars: data.stargazers_count,
      forks: data.forks_count,
      language: data.language,
      license: data.license?.spdx_id ?? null,
      description: data.description,
    },
    rateLimit,
  };
}

/** Parses "owner/repo" out of a GitHub URL, e.g. https://github.com/owner/repo. */
export function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}
