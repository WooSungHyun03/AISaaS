import { describe, expect, it } from "vitest";
import { scoreTistoryChannel } from "./tistory-scoring";
import type { TistoryRssMetrics } from "./providers/tistory";

const NOW = new Date("2026-10-10T00:00:00.000Z"); // KST 2026-10-10 09:00
const DAY_MS = 86_400_000;

function post(daysAgo: number) {
  return { publishedAt: new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString() };
}

const ACTIVE_METRICS: TistoryRssMetrics = {
  posts: [post(1), post(8), post(15), post(22), post(29)],
  observedCapped: false,
  unavailableReason: null,
};

describe("scoreTistoryChannel", () => {
  it("is deterministic: same metrics + same now -> same result", () => {
    const first = scoreTistoryChannel(ACTIVE_METRICS, NOW);
    const second = scoreTistoryChannel(structuredClone(ACTIVE_METRICS), new Date(NOW));
    expect(second).toEqual(first);
  });

  it("scores an active, fairly consistent blog as COMPLETE", () => {
    const result = scoreTistoryChannel(ACTIVE_METRICS, NOW);
    expect(result.completeness).toBe("COMPLETE");
    expect(result.activityScore).toBeGreaterThan(0);
  });

  it("returns INSUFFICIENT_DATA (not an error) when the feed was unavailable", () => {
    const metrics: TistoryRssMetrics = { posts: [], observedCapped: false, unavailableReason: "RSS를 가져올 수 없어요 (비공개로 설정됐거나 찾을 수 없어요)." };
    const result = scoreTistoryChannel(metrics, NOW);
    expect(result.completeness).toBe("INSUFFICIENT_DATA");
    expect(result.findings).toEqual(["RSS를 가져올 수 없어요 (비공개로 설정됐거나 찾을 수 없어요)."]);
    expect(result.overallScore).toBe(0);
  });

  it("returns INSUFFICIENT_DATA for a reachable feed with 0 posts", () => {
    const metrics: TistoryRssMetrics = { posts: [], observedCapped: false, unavailableReason: null };
    const result = scoreTistoryChannel(metrics, NOW);
    expect(result.completeness).toBe("INSUFFICIENT_DATA");
    expect(result.findings[0]).toContain("게시글이 없어요");
  });

  it("scores zero activity and flags it when there are posts but none in the last 30 days", () => {
    const metrics: TistoryRssMetrics = { posts: [post(45), post(60), post(75)], observedCapped: false, unavailableReason: null };
    const result = scoreTistoryChannel(metrics, NOW);
    expect(result.activityScore).toBe(0);
    expect(result.findings).toContain("최근 30일간 게시글이 없어요.");
    expect(result.completeness).toBe("COMPLETE"); // still >=2 posts, consistency computable
  });

  it("notes '관측된 글 기준' when the feed was capped at 30, without downgrading completeness", () => {
    const metrics: TistoryRssMetrics = { posts: ACTIVE_METRICS.posts, observedCapped: true, unavailableReason: null };
    const result = scoreTistoryChannel(metrics, NOW);
    expect(result.completeness).toBe("COMPLETE");
    expect(result.findings.some((f) => f.includes("최근 30개 글 기준"))).toBe(true);
  });

  it("marks PARTIAL when fewer than 2 posts exist", () => {
    const metrics: TistoryRssMetrics = { posts: [post(1)], observedCapped: false, unavailableReason: null };
    const result = scoreTistoryChannel(metrics, NOW);
    expect(result.completeness).toBe("PARTIAL");
  });
});
