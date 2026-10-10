import { describe, expect, it } from "vitest";
import { scoreYouTubeChannel } from "./youtube-scoring";
import type { YouTubeRawMetrics } from "./providers/youtube-types";

const NOW = new Date("2026-10-10T00:00:00.000Z");
const DAY_MS = 86_400_000;

function video(daysAgo: number, viewCount: number) {
  return { publishedAt: new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString(), viewCount };
}

const ACTIVE_CHANNEL: YouTubeRawMetrics = {
  subscriberCount: 1000,
  hiddenSubscriberCount: false,
  viewCount: 50_000,
  videoCount: 20,
  recentVideos: [video(1, 600), video(8, 550), video(15, 500), video(22, 480), video(29, 450)],
};

describe("scoreYouTubeChannel", () => {
  it("is deterministic: same metrics + same now -> same result", () => {
    const first = scoreYouTubeChannel(ACTIVE_CHANNEL, NOW);
    const second = scoreYouTubeChannel(structuredClone(ACTIVE_CHANNEL), new Date(NOW));
    expect(second).toEqual(first);
  });

  it("scores an active, fairly consistent channel as COMPLETE", () => {
    const result = scoreYouTubeChannel(ACTIVE_CHANNEL, NOW);
    expect(result.completeness).toBe("COMPLETE");
    expect(result.activityScore).toBeGreaterThan(0);
    expect(result.findings).not.toContain("최근 30일간 업로드가 없어요.");
  });

  it("returns INSUFFICIENT_DATA with zero scores for a channel with no videos", () => {
    const metrics: YouTubeRawMetrics = { subscriberCount: 10, hiddenSubscriberCount: false, viewCount: 0, videoCount: 0, recentVideos: [] };
    const result = scoreYouTubeChannel(metrics, NOW);
    expect(result).toMatchObject({ completeness: "INSUFFICIENT_DATA", overallScore: 0, activityScore: 0, consistencyScore: 0, contentScore: 0, items: [] });
    expect(result.findings[0]).toContain("영상이 없어요");
  });

  it("scores zero activity and flags it when there are videos but none in the last 30 days", () => {
    const metrics: YouTubeRawMetrics = {
      subscriberCount: 500,
      hiddenSubscriberCount: false,
      viewCount: 20_000,
      videoCount: 15,
      recentVideos: [video(45, 300), video(60, 280), video(75, 260)],
    };
    const result = scoreYouTubeChannel(metrics, NOW);
    expect(result.activityScore).toBe(0);
    expect(result.findings).toContain("최근 30일간 업로드가 없어요.");
    // Still has >=2 videos, so consistency can be computed -> not forced to PARTIAL by that rule.
    expect(result.completeness).toBe("COMPLETE");
  });

  it("excludes the views/subscriber ratio item and notes why when subscribers are hidden", () => {
    const metrics: YouTubeRawMetrics = { ...ACTIVE_CHANNEL, subscriberCount: null, hiddenSubscriberCount: true };
    const result = scoreYouTubeChannel(metrics, NOW);
    expect(result.completeness).toBe("PARTIAL");
    expect(result.items.find((item) => item.key === "average_views_ratio")).toBeUndefined();
    expect(result.items.find((item) => item.key === "average_views_absolute")).toBeDefined();
    expect(result.findings).toContain("구독자 수가 비공개라 조회 대비 구독자 비율 항목을 제외했습니다.");
  });

  it("marks PARTIAL when fewer than 2 recent videos exist, even if subscriber count is visible", () => {
    const metrics: YouTubeRawMetrics = { subscriberCount: 100, hiddenSubscriberCount: false, viewCount: 1000, videoCount: 1, recentVideos: [video(1, 100)] };
    const result = scoreYouTubeChannel(metrics, NOW);
    expect(result.completeness).toBe("PARTIAL");
  });
});
