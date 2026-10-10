import { describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

const { getChannelGrowthSeries, ALLOWED_GROWTH_METRICS } = await import("./growth-series");

function listQuery<T>(rows: T[]) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "in", "order"]) builder[method] = vi.fn(() => builder);
  builder.then = (resolve: (value: { data: T[]; error: null }) => unknown) => resolve({ data: rows, error: null });
  return builder;
}

function errorQuery(error: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "in", "order"]) builder[method] = vi.fn(() => builder);
  builder.then = (resolve: (value: { data: null; error: unknown }) => unknown) => resolve({ data: null, error });
  return builder;
}

function makeClient(tables: Record<string, ReturnType<typeof listQuery> | ReturnType<typeof errorQuery>>) {
  return { from: vi.fn((table: string) => tables[table]) };
}

const DAY_MS = 86_400_000;
const NOW = new Date("2026-10-10T00:00:00.000Z");

function snapshot(channelId: string, metric: string, value: number, daysAgo: number, source = "mock") {
  return { channel_id: channelId, metric, value, recorded_at: new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString(), source };
}

describe("getChannelGrowthSeries", () => {
  it("returns hasAnyData: false when the business has no tracked channels", async () => {
    createClientMock.mockResolvedValue(makeClient({ tracked_channels: listQuery([]) }));
    const result = await getChannelGrowthSeries("business-1", { now: NOW, days: 30 });
    expect(result).toEqual({ businessId: "business-1", days: 30, channels: [], hasAnyData: false });
  });

  it("always lists every platform-allowed metric, even ones with zero snapshots (e.g. a hidden-subscriber-count YouTube channel)", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        tracked_channels: listQuery([{ id: "c1", platform: "youtube", external_id: "@my", url: "https://youtube.com/@my" }]),
        marketing_metric_snapshots: listQuery([snapshot("c1", "viewCount", 1000, 1), snapshot("c1", "viewCount", 900, 10)]),
      }),
    );

    const result = await getChannelGrowthSeries("business-1", { now: NOW, days: 7 });
    const metrics = result.channels[0].metrics.map((m) => m.metric);
    expect(metrics).toEqual(["subscriberCount", "viewCount"]);

    const subscriberCount = result.channels[0].metrics.find((m) => m.metric === "subscriberCount")!;
    expect(subscriberCount.current).toBeNull();
    expect(subscriberCount.previous).toBeNull();
    expect(subscriberCount.absoluteDelta).toBeNull();
    expect(subscriberCount.points.every((p) => p.value === null)).toBe(true);
    expect(subscriberCount.status).toBe("COLLECTING");
  });

  it("structurally never surfaces a view/visitor-style metric for naver_blog or tistory, even if one somehow exists in the snapshots table", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        tracked_channels: listQuery([
          { id: "c-naver", platform: "naver_blog", external_id: "myblog", url: "https://blog.naver.com/myblog" },
          { id: "c-tistory", platform: "tistory", external_id: "myname", url: "https://myname.tistory.com/" },
        ]),
        // Deliberately malformed/unexpected rows: a view/visitor-style metric for platforms that should never have one.
        marketing_metric_snapshots: listQuery([
          snapshot("c-naver", "matchedPostCount", 5, 1),
          snapshot("c-naver", "viewCount", 999, 1),
          snapshot("c-naver", "visitorCount", 123, 1),
          snapshot("c-tistory", "postCount", 3, 1),
          snapshot("c-tistory", "viewCount", 888, 1),
        ]),
      }),
    );

    const result = await getChannelGrowthSeries("business-1", { now: NOW, days: 7 });

    const naver = result.channels.find((c) => c.channelId === "c-naver")!;
    const tistory = result.channels.find((c) => c.channelId === "c-tistory")!;
    expect(naver.metrics.map((m) => m.metric)).toEqual(["matchedPostCount", "postsLast30Days"]);
    expect(tistory.metrics.map((m) => m.metric)).toEqual(["postCount"]);
    expect(naver.metrics.some((m) => /view|visitor/i.test(m.metric))).toBe(false);
    expect(tistory.metrics.some((m) => /view|visitor/i.test(m.metric))).toBe(false);
    // Sanity: the allowed-metrics table itself never lists a view/visitor metric for these platforms.
    expect(ALLOWED_GROWTH_METRICS.naver_blog.some((m) => /view|visitor/i.test(m))).toBe(false);
    expect(ALLOWED_GROWTH_METRICS.tistory.some((m) => /view|visitor/i.test(m))).toBe(false);
  });

  it("computes current/previous/absoluteDelta/deltaPercent using the gap-day rule (latestBefore), and marks status OK once >= 2 snapshots land in the current period", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        tracked_channels: listQuery([{ id: "c1", platform: "youtube", external_id: "@my", url: "https://youtube.com/@my" }]),
        marketing_metric_snapshots: listQuery([
          snapshot("c1", "subscriberCount", 1000, 13), // previous period
          snapshot("c1", "subscriberCount", 1038, 1), // current period
          snapshot("c1", "subscriberCount", 1050, 0), // current period, most recent
        ]),
      }),
    );

    const result = await getChannelGrowthSeries("business-1", { now: NOW, days: 7 });
    const subscriberCount = result.channels[0].metrics.find((m) => m.metric === "subscriberCount")!;

    expect(subscriberCount.status).toBe("OK");
    expect(subscriberCount.current).toBe(1050);
    expect(subscriberCount.previous).toBe(1000);
    expect(subscriberCount.absoluteDelta).toBe(50);
    expect(subscriberCount.deltaPercent).toBe(5);
    expect(subscriberCount.points).toHaveLength(7);
    expect(subscriberCount.points[subscriberCount.points.length - 1].value).toBe(1050);
  });

  it("never computes a percent (or treats it as 0%) when there is no previous-period value — shows 'comparison unavailable' territory instead", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        tracked_channels: listQuery([{ id: "c1", platform: "youtube", external_id: "@my", url: "https://youtube.com/@my" }]),
        marketing_metric_snapshots: listQuery([snapshot("c1", "subscriberCount", 500, 1), snapshot("c1", "subscriberCount", 520, 0)]),
      }),
    );

    const result = await getChannelGrowthSeries("business-1", { now: NOW, days: 7 });
    const subscriberCount = result.channels[0].metrics.find((m) => m.metric === "subscriberCount")!;

    expect(subscriberCount.previous).toBeNull();
    expect(subscriberCount.absoluteDelta).toBeNull();
    expect(subscriberCount.deltaPercent).toBeNull();
    expect(subscriberCount.current).toBe(520);
  });

  it("flags hasDemoSeedData when any underlying snapshot came from the demo seed script", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        tracked_channels: listQuery([{ id: "c1", platform: "youtube", external_id: "@my", url: "https://youtube.com/@my" }]),
        marketing_metric_snapshots: listQuery([snapshot("c1", "subscriberCount", 1000, 1, "DEMO_SEED"), snapshot("c1", "subscriberCount", 1010, 0, "DEMO_SEED")]),
      }),
    );

    const result = await getChannelGrowthSeries("business-1", { now: NOW, days: 7 });
    const subscriberCount = result.channels[0].metrics.find((m) => m.metric === "subscriberCount")!;
    expect(subscriberCount.hasDemoSeedData).toBe(true);

    const viewCount = result.channels[0].metrics.find((m) => m.metric === "viewCount")!;
    expect(viewCount.hasDemoSeedData).toBe(false);
  });

  it("builds exactly `days` chart points, covering only the selected period (not the comparison period too)", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        tracked_channels: listQuery([{ id: "c1", platform: "tistory", external_id: "myname", url: "" }]),
        marketing_metric_snapshots: listQuery([snapshot("c1", "postCount", 10, 0)]),
      }),
    );

    const result7 = await getChannelGrowthSeries("business-1", { now: NOW, days: 7 });
    expect(result7.channels[0].metrics[0].points).toHaveLength(7);

    const result30 = await getChannelGrowthSeries("business-1", { now: NOW, days: 30 });
    expect(result30.channels[0].metrics[0].points).toHaveLength(30);
  });

  it("throws ChannelsError when the tracked_channels query fails", async () => {
    createClientMock.mockResolvedValue(makeClient({ tracked_channels: errorQuery(new Error("boom")) }));
    await expect(getChannelGrowthSeries("business-1", { now: NOW })).rejects.toMatchObject({ name: "ChannelsError", code: "DATABASE_ERROR" });
  });

  it("throws ChannelsError when the snapshots query fails", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        tracked_channels: listQuery([{ id: "c1", platform: "youtube", external_id: "@my", url: "" }]),
        marketing_metric_snapshots: errorQuery(new Error("boom")),
      }),
    );
    await expect(getChannelGrowthSeries("business-1", { now: NOW })).rejects.toMatchObject({ name: "ChannelsError", code: "DATABASE_ERROR" });
  });

  it("reports hasAnyData: false when channels exist but nothing was ever collected", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        tracked_channels: listQuery([{ id: "c1", platform: "youtube", external_id: "@my", url: "" }]),
        marketing_metric_snapshots: listQuery([]),
      }),
    );
    const result = await getChannelGrowthSeries("business-1", { now: NOW, days: 7 });
    expect(result.hasAnyData).toBe(false);
  });
});
