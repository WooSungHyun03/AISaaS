import { describe, expect, it } from "vitest";
import { collectMockNaverBlogMetrics } from "./naver-blog-mock";

describe("collectMockNaverBlogMetrics", () => {
  it("returns the same fixed sample regardless of input, given the same now", async () => {
    const now = new Date("2026-10-10T00:00:00.000Z");
    const a = await collectMockNaverBlogMetrics("myblogid", "우리동네 빵집", now);
    const b = await collectMockNaverBlogMetrics("anything", undefined, new Date(now));
    expect(a).toEqual(b);
    expect(a.matchedPostCount).toBeGreaterThan(0);
  });

  it("generates dates relative to the given now, not the real wall clock", async () => {
    const now = new Date("2020-01-01T00:00:00.000Z");
    const result = await collectMockNaverBlogMetrics("x", undefined, now);
    expect(result.lastPostDate! <= "2020-01-01").toBe(true);
  });
});
