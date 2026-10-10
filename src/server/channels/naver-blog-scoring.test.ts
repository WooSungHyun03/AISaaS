import { describe, expect, it } from "vitest";
import { NAVER_SEARCH_LIMITATION_NOTICE, scoreNaverBlogChannel } from "./naver-blog-scoring";
import type { NaverBlogMetrics } from "./providers/naver-types";

const ACTIVE_METRICS: NaverBlogMetrics = {
  matchedPostCount: 5,
  postsLast30Days: 4,
  averageGapDays: 3,
  lastPostDate: "2026-10-09",
  firstPostDate: "2026-09-10",
};

describe("scoreNaverBlogChannel", () => {
  it("is deterministic: same metrics -> same result", () => {
    expect(scoreNaverBlogChannel(structuredClone(ACTIVE_METRICS))).toEqual(scoreNaverBlogChannel(ACTIVE_METRICS));
  });

  it("scores active, frequent posting as COMPLETE with high scores", () => {
    const result = scoreNaverBlogChannel(ACTIVE_METRICS);
    expect(result.completeness).toBe("COMPLETE");
    expect(result.activityScore).toBeGreaterThan(0);
    expect(result.consistencyScore).toBeGreaterThan(0);
  });

  it("includes the search-limitation notice even when there is data", () => {
    const result = scoreNaverBlogChannel(ACTIVE_METRICS);
    expect(result.findings).toContain(NAVER_SEARCH_LIMITATION_NOTICE);
  });

  it("returns INSUFFICIENT_DATA with the limitation notice when nothing matched", () => {
    const metrics: NaverBlogMetrics = { matchedPostCount: 0, postsLast30Days: 0, averageGapDays: null, lastPostDate: null, firstPostDate: null };
    const result = scoreNaverBlogChannel(metrics);
    expect(result.completeness).toBe("INSUFFICIENT_DATA");
    expect(result.findings).toEqual([NAVER_SEARCH_LIMITATION_NOTICE]);
    expect(result.overallScore).toBe(0);
  });

  it("marks PARTIAL when only 1 post matched (gap not computable)", () => {
    const metrics: NaverBlogMetrics = { matchedPostCount: 1, postsLast30Days: 1, averageGapDays: null, lastPostDate: "2026-10-09", firstPostDate: "2026-10-09" };
    const result = scoreNaverBlogChannel(metrics);
    expect(result.completeness).toBe("PARTIAL");
  });

  it("scores zero activity when there are matches but none in the last 30 days", () => {
    const metrics: NaverBlogMetrics = { matchedPostCount: 3, postsLast30Days: 0, averageGapDays: 20, lastPostDate: "2026-07-01", firstPostDate: "2026-06-01" };
    const result = scoreNaverBlogChannel(metrics);
    expect(result.activityScore).toBe(0);
    expect(result.completeness).toBe("COMPLETE");
  });
});
