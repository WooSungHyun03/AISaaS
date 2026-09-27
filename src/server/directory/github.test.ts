import { afterEach, describe, expect, it, vi } from "vitest";
import { isDirectoryError } from "./errors";
import { fetchRepoStats, shouldStopForRateLimit, type GithubRateLimitInfo } from "./github";

function githubResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

const REPO_BODY = {
  stargazers_count: 123,
  forks_count: 45,
  language: "TypeScript",
  license: { spdx_id: "MIT" },
  description: "a test repo",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRepoStats", () => {
  it("returns stats and rate-limit info on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        githubResponse(200, REPO_BODY, {
          "x-ratelimit-remaining": "42",
          "x-ratelimit-reset": "1700000000",
        }),
      ),
    );

    const result = await fetchRepoStats("owner", "repo");

    expect(result.stats).toEqual({
      stars: 123,
      forks: 45,
      language: "TypeScript",
      license: "MIT",
      description: "a test repo",
    });
    expect(result.rateLimit).toEqual({ remaining: 42, resetAt: new Date(1700000000 * 1000) });
  });

  it("classifies 401 as AUTH_FAILED, not retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(githubResponse(401, { message: "Bad credentials" })));

    const error = await fetchRepoStats("owner", "repo").catch((e) => e);

    expect(isDirectoryError(error)).toBe(true);
    expect(error.code).toBe("AUTH_FAILED");
    expect(error.retryable).toBe(false);
  });

  it("classifies a plain 403 (no rate-limit signal) as AUTH_FAILED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        githubResponse(403, { message: "Forbidden" }, { "x-ratelimit-remaining": "10" }),
      ),
    );

    const error = await fetchRepoStats("owner", "repo").catch((e) => e);

    expect(isDirectoryError(error)).toBe(true);
    expect(error.code).toBe("AUTH_FAILED");
  });

  it("classifies 403 + x-ratelimit-remaining=0 as RATE_LIMITED, carrying resetAt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        githubResponse(403, { message: "rate limit exceeded" }, {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1700000000",
        }),
      ),
    );

    const error = await fetchRepoStats("owner", "repo").catch((e) => e);

    expect(isDirectoryError(error)).toBe(true);
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryable).toBe(true);
    expect(error.retryAfter).toEqual(new Date(1700000000 * 1000));
  });

  it("classifies 403 + Retry-After (secondary rate limit) as RATE_LIMITED even with quota remaining", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        githubResponse(403, { message: "secondary rate limit" }, {
          "retry-after": "30",
          "x-ratelimit-remaining": "500",
        }),
      ),
    );

    const before = Date.now();
    const error = await fetchRepoStats("owner", "repo").catch((e) => e);

    expect(isDirectoryError(error)).toBe(true);
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAfter).toBeInstanceOf(Date);
    expect(error.retryAfter.getTime()).toBeGreaterThanOrEqual(before + 30_000);
  });

  it("classifies 429 as RATE_LIMITED", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(githubResponse(429, { message: "too many requests" })));

    const error = await fetchRepoStats("owner", "repo").catch((e) => e);

    expect(isDirectoryError(error)).toBe(true);
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryable).toBe(true);
  });

  it("classifies 404 as NOT_FOUND, not retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(githubResponse(404, { message: "Not Found" })));

    const error = await fetchRepoStats("owner", "repo").catch((e) => e);

    expect(isDirectoryError(error)).toBe(true);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.retryable).toBe(false);
  });

  it("classifies a 5xx as NETWORK_FAILURE, retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(githubResponse(503, { message: "Service Unavailable" })));

    const error = await fetchRepoStats("owner", "repo").catch((e) => e);

    expect(isDirectoryError(error)).toBe(true);
    expect(error.code).toBe("NETWORK_FAILURE");
    expect(error.retryable).toBe(true);
  });

  it("classifies a raw fetch rejection as NETWORK_FAILURE, retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const error = await fetchRepoStats("owner", "repo").catch((e) => e);

    expect(isDirectoryError(error)).toBe(true);
    expect(error.code).toBe("NETWORK_FAILURE");
    expect(error.retryable).toBe(true);
  });

  it("classifies an unmapped status as UNKNOWN, not retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(githubResponse(422, { message: "Unprocessable" })));

    const error = await fetchRepoStats("owner", "repo").catch((e) => e);

    expect(isDirectoryError(error)).toBe(true);
    expect(error.code).toBe("UNKNOWN");
    expect(error.retryable).toBe(false);
  });
});

describe("shouldStopForRateLimit", () => {
  const rateLimitAt = (remaining: number): GithubRateLimitInfo => ({ remaining, resetAt: new Date() });

  it("says stop once remaining drops to the threshold or below", () => {
    expect(shouldStopForRateLimit(rateLimitAt(5), 5)).toBe(true);
    expect(shouldStopForRateLimit(rateLimitAt(0), 5)).toBe(true);
  });

  it("says continue while comfortably above the threshold", () => {
    expect(shouldStopForRateLimit(rateLimitAt(100), 5)).toBe(false);
  });
});
