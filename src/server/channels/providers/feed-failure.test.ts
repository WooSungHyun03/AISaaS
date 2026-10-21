import { describe, expect, it } from "vitest";
import { DiagnosisError, parseRetryAfterMs } from "@/server/marketing/diagnosis";
import { classifyFeedFailure } from "./feed-failure";

const fetchFailed = (status?: number, retryAfterMs?: number) => new DiagnosisError("FETCH_FAILED", "x", { status, retryAfterMs });

describe("classifyFeedFailure", () => {
  it("404 and 410: the feed is gone", () => {
    expect(classifyFeedFailure(fetchFailed(404)).kind).toBe("NOT_FOUND");
    expect(classifyFeedFailure(fetchFailed(410)).kind).toBe("NOT_FOUND");
  });

  it("401 and 403: private blog, 'cannot be measured'", () => {
    expect(classifyFeedFailure(fetchFailed(401)).kind).toBe("FORBIDDEN");
    expect(classifyFeedFailure(fetchFailed(403)).kind).toBe("FORBIDDEN");
  });

  it("429, 5xx and 408 are transient and carry Retry-After", () => {
    for (const status of [408, 429, 500, 502, 503, 504]) expect(classifyFeedFailure(fetchFailed(status)).kind, String(status)).toBe("TRANSIENT");
    expect(classifyFeedFailure(fetchFailed(429, 30_000))).toMatchObject({ kind: "TRANSIENT", status: 429, retryAfterMs: 30_000 });
  });

  it("a fetch that never got an HTTP answer (timeout, connection reset, DNS) is transient", () => {
    expect(classifyFeedFailure(fetchFailed()).kind).toBe("TRANSIENT");
  });

  it("an answer that is not a readable feed is neither: it will not fix itself by retrying", () => {
    expect(classifyFeedFailure(new DiagnosisError("UNSUPPORTED_CONTENT", "html")).kind).toBe("OTHER");
    expect(classifyFeedFailure(new DiagnosisError("TOO_LARGE", "big")).kind).toBe("OTHER");
    expect(classifyFeedFailure(fetchFailed(400)).kind).toBe("OTHER");
  });
});

describe("parseRetryAfterMs", () => {
  const now = Date.parse("2026-10-21T00:00:00Z");
  it("reads seconds and HTTP dates, and caps the wait at six hours", () => {
    expect(parseRetryAfterMs("120", now)).toBe(120_000);
    expect(parseRetryAfterMs("Wed, 21 Oct 2026 00:10:00 GMT", now)).toBe(600_000);
    expect(parseRetryAfterMs("999999", now)).toBe(6 * 3_600_000);
  });
  it("ignores a missing, zero, negative or unreadable value", () => {
    expect(parseRetryAfterMs(undefined, now)).toBeUndefined();
    expect(parseRetryAfterMs("0", now)).toBeUndefined();
    expect(parseRetryAfterMs("-5", now)).toBeUndefined();
    expect(parseRetryAfterMs("soon", now)).toBeUndefined();
  });
});
