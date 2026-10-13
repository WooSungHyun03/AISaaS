import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
const { buildContentReport } = await import("./growth-content");

const row = (id: string, date: string, metrics: Record<string, number>, publishedAt: string | null = "2026-10-01T03:00:00Z") =>
  ({ channel_id: "c1", external_content_id: id, title: `영상 ${id}`, url: `https://www.youtube.com/watch?v=${id}`, published_at: publishedAt, snapshot_date: date, metrics });

describe("buildContentReport", () => {
  const now = new Date("2026-10-12T00:00:00Z");

  it("shows the last seen counts and the views gained between the first and last snapshot of the period", () => {
    const report = buildContentReport("c1", "VIDEOS", [row("a", "2026-10-06", { viewCount: 100, likeCount: 5 }), row("a", "2026-10-12", { viewCount: 160, likeCount: 8, commentCount: 2 })], "2026-10-05", now);
    expect(report.items[0]).toMatchObject({ id: "a", viewCount: 160, likeCount: 8, commentCount: 2, viewsGained: 60 });
    expect(report.lastSnapshotDate).toBe("2026-10-12");
  });

  it("never invents numbers: with one snapshot there is no gain, a hidden like count stays null, not 0", () => {
    const report = buildContentReport("c1", "VIDEOS", [row("a", "2026-10-12", { viewCount: 50 })], "2026-10-05", now);
    expect(report.items[0]).toMatchObject({ viewCount: 50, likeCount: null, commentCount: null, viewsGained: null });
  });

  it("a view total that went down (a correction) is not shown as a negative gain", () => {
    const report = buildContentReport("c1", "VIDEOS", [row("a", "2026-10-06", { viewCount: 100 }), row("a", "2026-10-12", { viewCount: 90 })], "2026-10-05", now);
    expect(report.items[0].viewsGained).toBeNull();
  });

  it("lists the newest published first and counts publications per week inside the period only", () => {
    const report = buildContentReport(
      "c1",
      "POSTS",
      [
        row("old", "2026-10-12", {}, "2026-08-01T00:00:00Z"),
        row("w1", "2026-10-12", {}, "2026-10-06T03:00:00Z"),
        row("w2", "2026-10-12", {}, "2026-10-08T03:00:00Z"),
        row("w3", "2026-10-12", {}, "2026-10-11T03:00:00Z"),
      ],
      "2026-09-12",
      now,
    );
    expect(report.items.map((item) => item.id)).toEqual(["w3", "w2", "w1", "old"]);
    expect(report.weekly).toEqual([{ weekStart: "2026-10-05", count: 3 }]);
    expect(report.observedItems).toBe(4);
  });
});
