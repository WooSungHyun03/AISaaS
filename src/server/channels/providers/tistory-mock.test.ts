import { describe, expect, it } from "vitest";
import { collectMockTistoryRssMetrics } from "./tistory-mock";

describe("collectMockTistoryRssMetrics", () => {
  it("returns the same fixed sample for any blogUrl, given the same now", async () => {
    const now = new Date("2026-10-10T00:00:00.000Z");
    const a = await collectMockTistoryRssMetrics("https://anything.tistory.com/", now);
    const b = await collectMockTistoryRssMetrics("https://blog.mycompany.com/", new Date(now));

    expect(a).toEqual(b);
    expect(a.posts.length).toBeGreaterThan(0);
    expect(a.unavailableReason).toBeNull();
  });

  it("generates post dates relative to the given now, not the real wall clock", async () => {
    const now = new Date("2020-01-01T00:00:00.000Z");
    const result = await collectMockTistoryRssMetrics("https://x.tistory.com/", now);
    for (const post of result.posts) {
      expect(Date.parse(post.publishedAt)).toBeLessThanOrEqual(now.getTime());
    }
  });
});
