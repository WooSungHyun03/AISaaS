import { describe, expect, it } from "vitest";
import { collectMockYouTubeAnalytics } from "./youtube-analytics-mock";

describe("collectMockYouTubeAnalytics", () => {
  it("returns a deterministic result for the same now, regardless of userId/businessId/externalId", async () => {
    const now = new Date("2026-10-10T00:00:00.000Z");
    const a = await collectMockYouTubeAnalytics({ userId: "u1", businessId: "b1", externalId: "@x", now });
    const b = await collectMockYouTubeAnalytics({ userId: "u2", businessId: "b2", externalId: "@y", now: new Date(now) });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("never returns a date within the most recent 3 days of `now` — mirrors the real API's 48–72h processing delay", async () => {
    const now = new Date("2026-10-10T00:00:00.000Z");
    const days = await collectMockYouTubeAnalytics({ userId: "u1", businessId: "b1", externalId: "@x", now });
    const threeDaysAgoKst = new Date(now.getTime() - 3 * 86_400_000 + 9 * 3_600_000).toISOString().slice(0, 10);
    for (const day of days) {
      expect(day.date <= threeDaysAgoKst).toBe(true);
    }
  });

  it("returns dates relative to the given now, not the real wall clock", async () => {
    const now = new Date("2020-01-01T00:00:00.000Z");
    const days = await collectMockYouTubeAnalytics({ userId: "u1", businessId: "b1", externalId: "@x", now });
    for (const day of days) {
      expect(Date.parse(`${day.date}T00:00:00.000Z`)).toBeLessThanOrEqual(now.getTime());
    }
  });

  it("only returns the documented metrics, all valid numbers", async () => {
    const now = new Date("2026-10-10T00:00:00.000Z");
    const days = await collectMockYouTubeAnalytics({ userId: "u1", businessId: "b1", externalId: "@x", now });
    for (const day of days) {
      expect(day.views).toBeGreaterThan(0);
      expect(day.estimatedMinutesWatched).toBeGreaterThan(0);
      expect(day.averageViewDuration).toBeGreaterThan(0);
      expect(day.subscribersGained).toBeGreaterThanOrEqual(0);
      expect(day.subscribersLost).toBeGreaterThanOrEqual(0);
      expect(Object.keys(day).sort()).toEqual(["averageViewDuration", "date", "estimatedMinutesWatched", "subscribersGained", "subscribersLost", "views"]);
    }
  });
});
