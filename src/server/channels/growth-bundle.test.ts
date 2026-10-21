import { describe, expect, it } from "vitest";
import { GROWTH_PERIODS, bucketPoints, defaultGranularity, selectChannelSeries } from "@/lib/growth/select";
import { assembleBundleChannel } from "./growth-bundle";
import { buildChannelSeries, type ChannelRow, type SnapshotRow } from "./growth-series";

const DAY = 86_400_000;
// Saturday 2026-10-10, 09:00 KST
const NOW = Date.parse("2026-10-10T00:00:00.000Z");

const channel = (platform: ChannelRow["platform"]): ChannelRow => ({
  id: `c-${platform}`, platform, external_id: "ext", url: "https://example.com", status: "ACTIVE", display_name: "채널", thumbnail_url: null,
  next_snapshot_at: null, last_collected_at: new Date(NOW - 3_600_000).toISOString(), last_success_at: new Date(NOW - 3_600_000).toISOString(), last_collection_status: "SUCCESS", last_error_code: null,
});

/** ~200 days of daily snapshots with a few gaps, so every period, bucket and gap rule is exercised. */
function snapshots(channelId: string, metrics: Record<string, (day: number) => number>, source = "live"): SnapshotRow[] {
  const rows: SnapshotRow[] = [];
  for (let day = 200; day >= 0; day--) {
    if (day % 17 === 5) continue; // collection gaps
    for (const [metric, valueOf] of Object.entries(metrics)) rows.push({ channel_id: channelId, metric, value: valueOf(day), recorded_at: new Date(NOW - day * DAY - 3 * 3_600_000).toISOString(), source });
  }
  return rows;
}

const youtube = channel("youtube");
const youtubeRows = snapshots(youtube.id, { subscriberCount: (d) => 1_000 + (200 - d) * 2, viewCount: (d) => 50_000 + (200 - d) * 90 + ((200 - d) % 7) * 11, videoCount: (d) => 20 + Math.floor((200 - d) / 9) });
const naver = channel("naver_blog");
const naverRows = snapshots(naver.id, { matchedPostCount: (d) => 10 + Math.floor((200 - d) / 4), postsLast30Days: (d) => 3 + (d % 4), postsLast7Days: (d) => d % 3 });

const NO_CONTENT = { 7: null, 30: null, 90: null };

describe("the growth bundle: what the browser derives equals what the server used to compute per request", () => {
  for (const [name, ch, rows] of [["youtube", youtube, youtubeRows], ["naver_blog", naver, naverRows]] as const) {
    const bundle = assembleBundleChannel(ch, rows, NOW, NO_CONTENT);
    for (const days of GROWTH_PERIODS) {
      for (const granularity of ["day", "week", "month"] as const) {
        it(`${name}: ${days} days, ${granularity}`, () => {
          const fromBundle = selectChannelSeries(bundle, days, granularity);
          const direct = buildChannelSeries(ch, rows, NOW, days, granularity);
          expect(fromBundle).toEqual(direct);
        });
      }
    }
  }

  it("a long period's daily points contain the shorter period's points, so a smaller period is just the tail", () => {
    const bundle = assembleBundleChannel(youtube, youtubeRows, NOW, NO_CONTENT);
    const metric = bundle.metrics[0];
    expect(metric.points).toHaveLength(90);
    const seven = selectChannelSeries(bundle, 7, "day").metrics[0].points;
    expect(seven).toEqual(metric.points.slice(-7));
  });

  it("the derived daily-increase metric (viewCountDaily) keeps its FLOW kind and sums inside a bucket", () => {
    const bundle = assembleBundleChannel(youtube, youtubeRows, NOW, NO_CONTENT);
    const daily = bundle.metrics.find((metric) => metric.metric === "viewCountDaily")!;
    expect(daily.kind).toBe("FLOW");
    const weekly = selectChannelSeries(bundle, 30, "week").metrics.find((metric) => metric.metric === "viewCountDaily")!;
    const sumOfDays = daily.points.slice(-30).reduce((sum, point) => sum + (point.value ?? 0), 0);
    expect(weekly.points.reduce((sum, point) => sum + (point.value ?? 0), 0)).toBe(sumOfDays);
  });

  it("sample (mock) and demo flags survive into the bundle so the screen can label them", () => {
    const mock = assembleBundleChannel(youtube, snapshots(youtube.id, { viewCount: (d) => 1_000 + (200 - d) }, "mock"), NOW, NO_CONTENT);
    expect(mock.metrics.find((metric) => metric.metric === "viewCount")!.hasSampleData).toBe(true);
    const demo = assembleBundleChannel(youtube, snapshots(youtube.id, { viewCount: (d) => 1_000 + (200 - d) }, "DEMO_SEED"), NOW, NO_CONTENT);
    expect(demo.metrics.find((metric) => metric.metric === "viewCount")!.hasDemoSeedData).toBe(true);
  });

  it("the reading under the charts is the rule-based summary of the real numbers unless today's AI reading exists", () => {
    const withoutAi = assembleBundleChannel(youtube, youtubeRows, NOW, NO_CONTENT);
    expect(withoutAi.narratives[30].aiUsed).toBe(false);
    expect(withoutAi.narratives[30].text).toContain("구독자 수");
    const withAi = assembleBundleChannel(youtube, youtubeRows, NOW, NO_CONTENT, new Map([[`${youtube.id}:30`, "AI가 쓴 해석이에요."]]));
    expect(withAi.narratives[30]).toEqual({ text: "AI가 쓴 해석이에요.", aiUsed: true });
    expect(withAi.narratives[7].aiUsed).toBe(false); // only the period that has one
  });

  it("the payload stays small: no raw rows, just 90 points per metric", () => {
    const bundle = assembleBundleChannel(youtube, youtubeRows, NOW, NO_CONTENT);
    expect(JSON.stringify(bundle).length).toBeLessThan(40_000);
  });
});

describe("bucketPoints / defaultGranularity", () => {
  it("weeks start on Monday and months on the 1st; a running total keeps the last value, a flow adds up", () => {
    const points = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-11", "2026-10-12"].map((date, index) => ({ date, value: index + 1, measured: true }));
    expect(bucketPoints(points, "week", "TOTAL").map((point) => [point.date, point.value])).toEqual([["2026-09-28", 1], ["2026-10-05", 4], ["2026-10-12", 5]]);
    expect(bucketPoints(points, "week", "FLOW").map((point) => [point.date, point.value])).toEqual([["2026-09-28", 1], ["2026-10-05", 9], ["2026-10-12", 5]]);
    expect(bucketPoints(points, "month", "TOTAL").map((point) => point.date)).toEqual(["2026-10-01"]);
  });

  it("a bucket with no known value is null, never 0", () => {
    expect(bucketPoints([{ date: "2026-10-05", value: null, measured: false }], "week", "FLOW")).toEqual([{ date: "2026-10-05", value: null, measured: false }]);
  });

  it("a 7-day chart is daily; longer ones read better by week", () => {
    expect(defaultGranularity(7)).toBe("day");
    expect(defaultGranularity(30)).toBe("day");
    expect(defaultGranularity(90)).toBe("week");
  });
});
