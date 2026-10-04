import { describe, expect, it } from "vitest";
import { buildGrowthReport, buildSuggestions, type CalendarRow, type ContentRow, type RunRow } from "./growth-report";

const NOW = new Date("2026-10-15T03:00:00.000Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const content = (type: string, daysAgo: number, topic: string | null = null): ContentRow => ({ content_type: type, topic, created_at: ago(daysAgo) });
const run = (status: string, daysAgo: number, publishedCount = 0): RunRow => ({ status, created_at: ago(daysAgo), publishedCount });
const calendarRow = (platform: string, status: string, plannedDaysAgo: number): CalendarRow => ({
  platform,
  status,
  planned_date: new Date(NOW.getTime() - plannedDaysAgo * DAY + 9 * 3_600_000).toISOString().slice(0, 10),
});

describe("buildGrowthReport", () => {
  it("reports no data without inventing any", () => {
    const report = buildGrowthReport({ now: NOW, days: 30, content: [], runs: [], calendar: [] });
    expect(report.hasAnyData).toBe(false);
    expect(report.contentCount).toMatchObject({ current: 0, previous: 0, deltaPercent: null });
    expect(report.successRate).toBeNull();
    expect(report.calendarCompletion).toBeNull();
    expect(report.topTopics).toEqual([]);
  });

  it("compares the current period with the previous one", () => {
    const report = buildGrowthReport({
      now: NOW, days: 30, runs: [], calendar: [],
      content: [content("blog-marketing", 3), content("blog-marketing", 10), content("shorts", 12), content("blog-marketing", 40), content("blog-marketing", 100)],
    });
    expect(report.contentCount).toEqual({ current: 3, previous: 1, delta: 2, deltaPercent: 200 });
    expect(report.byType[0]).toMatchObject({ type: "blog-marketing", label: "블로그 글", current: 2, previous: 1 });
  });

  it("does not count publish operations as new content", () => {
    const report = buildGrowthReport({ now: NOW, days: 30, runs: [], calendar: [], content: [content("shorts", 2), content("shorts-publish", 1)] });
    expect(report.contentCount.current).toBe(1);
    expect(report.byType.map((entry) => entry.type)).toEqual(["shorts"]);
  });

  it("computes success rate from finished runs only", () => {
    const report = buildGrowthReport({
      now: NOW, days: 30, content: [], calendar: [],
      runs: [run("SUCCESS", 1), run("SUCCESS", 2), run("FAILED", 3), run("RUNNING", 0), run("QUEUED", 0), run("SUCCESS", 40), run("FAILED", 41)],
    });
    expect(report.successRate).toMatchObject({ current: 67, currentOf: 3, previous: 50, previousOf: 2, delta: 17 });
  });

  it("counts platform-confirmed publications only from successful runs", () => {
    const report = buildGrowthReport({ now: NOW, days: 30, content: [], calendar: [], runs: [run("SUCCESS", 1, 2), run("FAILED", 2, 1), run("SUCCESS", 40, 1)] });
    expect(report.publications).toMatchObject({ current: 2, previous: 1 });
    expect(report.source.publications).toBe("EXTERNAL_VERIFIED");
  });

  it("computes calendar completion excluding skipped items", () => {
    const report = buildGrowthReport({
      now: NOW, days: 30, content: [], runs: [],
      calendar: [calendarRow("blog", "GENERATED", 2), calendarRow("blog", "PUBLISHED", 5), calendarRow("youtube_shorts", "PLANNED", 6), calendarRow("blog", "SKIPPED", 7), calendarRow("blog", "GENERATED", 40)],
    });
    expect(report.calendarCompletion).toMatchObject({ current: 67, currentOf: 3, previous: 100, previousOf: 1 });
    expect(report.calendar.skipped).toBe(1);
    expect(report.calendar.byPlatform.find((entry) => entry.platform === "blog")).toMatchObject({ total: 2, done: 2, label: "블로그" });
  });

  it("buckets weekly output and ranks this period's topics", () => {
    const report = buildGrowthReport({
      now: NOW, days: 28, runs: [], calendar: [],
      content: [content("blog-marketing", 1, "소금빵"), content("blog-marketing", 2, "소금빵"), content("shorts", 9, "원두"), content("shorts", 15, null)],
    });
    expect(report.weekly).toHaveLength(4);
    expect(report.weekly.at(-1)).toEqual({ label: "이번 주", count: 2 });
    expect(report.weekly.reduce((total, week) => total + week.count, 0)).toBe(4);
    expect(report.topTopics).toEqual([{ topic: "소금빵", count: 2 }, { topic: "원두", count: 1 }]);
  });

  it("lists external performance metrics as UNAVAILABLE instead of estimating them", () => {
    const report = buildGrowthReport({ now: NOW, days: 30, content: [], runs: [], calendar: [] });
    expect(report.unavailable.map((entry) => entry.key)).toEqual(expect.arrayContaining(["views", "engagement", "followers", "conversion"]));
    expect(JSON.stringify(report)).not.toMatch(/조회수 \d|전환율 \d|팔로워 \d/);
  });
});

describe("suggestions", () => {
  it("each suggestion is backed by a measured number", () => {
    const report = buildGrowthReport({
      now: NOW, days: 30,
      content: [content("blog-marketing", 40), content("blog-marketing", 41), content("blog-marketing", 5)],
      runs: [run("SUCCESS", 1), run("FAILED", 2), run("FAILED", 3)],
      calendar: [calendarRow("blog", "PLANNED", 1), calendarRow("blog", "PLANNED", 2), calendarRow("blog", "PLANNED", 3), calendarRow("blog", "GENERATED", 4)],
    });
    const joined = report.suggestions.join(" ");
    expect(joined).toContain("이전 30일에는 2건");
    expect(joined).toContain("제작 성공률이 33%");
    expect(joined).toContain("수행률이 25%");
    expect(joined).toContain("숏폼도 만들면");
    expect(report.suggestions.length).toBeLessThanOrEqual(5);
  });

  it("stays quiet for a healthy account", () => {
    const report = buildGrowthReport({
      now: NOW, days: 30,
      content: [content("blog-marketing", 2), content("shorts", 3)],
      runs: [run("SUCCESS", 1), run("SUCCESS", 2), run("SUCCESS", 3)],
      calendar: [calendarRow("blog", "GENERATED", 2), calendarRow("youtube_shorts", "GENERATED", 3), calendarRow("blog", "GENERATED", 4)],
    });
    expect(buildSuggestions(report)).toEqual([]);
  });
});
