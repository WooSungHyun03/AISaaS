import { afterEach, describe, expect, it, vi } from "vitest";

const { createClientMock, getConnectionMock } = vi.hoisted(() => ({ createClientMock: vi.fn(), getConnectionMock: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/server/connectors/integrations", () => ({ getConnection: getConnectionMock }));

const { getChannelGrowthSeries, ALLOWED_GROWTH_METRICS } = await import("./growth-series");

function listQuery<T>(rows: T[]) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "lt", "in", "order", "range", "limit"]) builder[method] = vi.fn(() => builder);
  builder.then = (resolve: (value: { data: T[]; error: null }) => unknown) => resolve({ data: rows, error: null });
  return builder;
}

function errorQuery(error: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "lt", "in", "order", "range", "limit"]) builder[method] = vi.fn(() => builder);
  builder.then = (resolve: (value: { data: null; error: unknown }) => unknown) => resolve({ data: null, error });
  return builder;
}

/** businesses lookup uses .maybeSingle(), not the array-returning .then() chain the other tables use. */
function singleQuery<T>(row: T | null) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "lt", "in", "order", "range", "limit"]) builder[method] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  return builder;
}

function makeClient(tables: Record<string, ReturnType<typeof listQuery> | ReturnType<typeof errorQuery> | ReturnType<typeof singleQuery>>) {
  // Default: no business row found → ownerId undefined → getConnection never called → existing
  // tests that don't care about ticket 1-10's YouTube Analytics gating are unaffected.
  return { from: vi.fn((table: string) => tables[table] ?? singleQuery(null)) };
}

const DAY_MS = 86_400_000;
const NOW = new Date("2026-10-10T00:00:00.000Z");

function snapshot(channelId: string, metric: string, value: number, daysAgo: number, source = "mock") {
  return { channel_id: channelId, metric, value, recorded_at: new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString(), source };
}

afterEach(() => {
  vi.clearAllMocks();
  getConnectionMock.mockResolvedValue(null);
});

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

  describe("ticket 1-10: yt_analytics.* metrics", () => {
    const SCOPED = { status: "CONNECTED", metadata: { scope: "https://www.googleapis.com/auth/yt-analytics.readonly" } };

    function analyticsClient(rows: ReturnType<typeof snapshot>[]) {
      return makeClient({
        tracked_channels: listQuery([{ id: "c1", platform: "youtube", external_id: "@my", url: "" }]),
        marketing_metric_snapshots: listQuery(rows),
        businesses: singleQuery({ owner_id: "user-1" }),
      });
    }

    it("appear, tagged EXTERNAL_VERIFIED, only when the business owner has a CONNECTED + scoped YouTube integration", async () => {
      createClientMock.mockResolvedValue(analyticsClient([snapshot("c1", "yt_analytics.estimatedMinutesWatched", 400, 4)]));
      getConnectionMock.mockResolvedValue(SCOPED);

      const result = await getChannelGrowthSeries("business-1", { now: NOW, days: 7 });
      const metrics = result.channels[0].metrics.map((m) => m.metric);
      expect(metrics).toEqual([
        "subscriberCount",
        "viewCount",
        "yt_analytics.views",
        "yt_analytics.estimatedMinutesWatched",
        "yt_analytics.netSubscribers",
        "yt_analytics.averageViewDuration",
      ]);

      const watched = result.channels[0].metrics.find((m) => m.metric === "yt_analytics.estimatedMinutesWatched")!;
      expect(watched.source).toBe("EXTERNAL_VERIFIED");
      expect(watched.current).toBe(400);
      const subscriberCount = result.channels[0].metrics.find((m) => m.metric === "subscriberCount")!;
      expect(subscriberCount.source).toBeUndefined();
    });

    it("totals each period's days and compares with the period before, ending 3 days ago (the API's lag)", async () => {
      // days=7, lag=3: current window = days 4..10 ago, previous window = days 11..17 ago.
      const rows = [
        snapshot("c1", "yt_analytics.views", 100, 4),
        snapshot("c1", "yt_analytics.views", 150, 6),
        snapshot("c1", "yt_analytics.views", 50, 12),
        snapshot("c1", "yt_analytics.views", 50, 15),
        // Inside the lag: must not be counted at all.
        snapshot("c1", "yt_analytics.views", 9999, 1),
      ];
      createClientMock.mockResolvedValue(analyticsClient(rows));
      getConnectionMock.mockResolvedValue(SCOPED);

      const views = (await getChannelGrowthSeries("business-1", { now: NOW, days: 7 })).channels[0].metrics.find((m) => m.metric === "yt_analytics.views")!;
      expect(views.current).toBe(250);
      expect(views.previous).toBe(100);
      expect(views.absoluteDelta).toBe(150);
      expect(views.deltaPercent).toBe(150);
      expect(views.status).toBe("OK");
      // The chart shows real days only: a missing day is null, never a carried-forward value.
      expect(views.points.filter((point) => point.value !== null).map((point) => point.value)).toEqual([150, 100]);
    });

    it("averages (does not add up) the average view duration", async () => {
      createClientMock.mockResolvedValue(analyticsClient([
        snapshot("c1", "yt_analytics.averageViewDuration", 90, 5),
        snapshot("c1", "yt_analytics.averageViewDuration", 110, 6),
      ]));
      getConnectionMock.mockResolvedValue(SCOPED);

      const avg = (await getChannelGrowthSeries("business-1", { now: NOW, days: 7 })).channels[0].metrics.find((m) => m.metric === "yt_analytics.averageViewDuration")!;
      expect(avg.current).toBe(100);
    });

    it("reports a net subscriber loss as a negative total, not a missing value", async () => {
      createClientMock.mockResolvedValue(analyticsClient([
        snapshot("c1", "yt_analytics.netSubscribers", -3, 5),
        snapshot("c1", "yt_analytics.netSubscribers", 1, 6),
      ]));
      getConnectionMock.mockResolvedValue(SCOPED);

      const net = (await getChannelGrowthSeries("business-1", { now: NOW, days: 7 })).channels[0].metrics.find((m) => m.metric === "yt_analytics.netSubscribers")!;
      expect(net.current).toBe(-2);
    });

    it("says COLLECTING and shows no total for a period with no data yet", async () => {
      createClientMock.mockResolvedValue(analyticsClient([]));
      getConnectionMock.mockResolvedValue(SCOPED);

      const views = (await getChannelGrowthSeries("business-1", { now: NOW, days: 7 })).channels[0].metrics.find((m) => m.metric === "yt_analytics.views")!;
      expect(views.current).toBeNull();
      expect(views.status).toBe("COLLECTING");
    });

    it("tells the owner what to do: connect, reconnect, wrong account, or wait", async () => {
      const notice = async (connection: unknown) => {
        createClientMock.mockResolvedValue(analyticsClient([]));
        getConnectionMock.mockResolvedValue(connection);
        return (await getChannelGrowthSeries("business-1", { now: NOW, days: 7 })).channels[0].analyticsNotice;
      };
      expect((await notice(null))?.kind).toBe("CONNECT");
      expect((await notice({ status: "CONNECTED", metadata: { scope: "https://www.googleapis.com/auth/youtube.upload" } }))?.kind).toBe("RECONNECT");
      expect((await notice({ ...SCOPED, metadata: { ...SCOPED.metadata, analytics: { status: "TOKEN_REVOKED" } } }))?.kind).toBe("RECONNECT");
      expect((await notice({ ...SCOPED, metadata: { ...SCOPED.metadata, analytics: { status: "CHANNEL_MISMATCH" } } }))?.kind).toBe("CHANNEL_MISMATCH");
      expect((await notice({ ...SCOPED, metadata: { ...SCOPED.metadata, analytics: { status: "API_DISABLED" } } }))?.kind).toBe("API_DISABLED");
      expect((await notice({ ...SCOPED, metadata: { ...SCOPED.metadata, analytics: { status: "QUOTA" } } }))?.kind).toBe("QUOTA");
      expect((await notice({ ...SCOPED, metadata: { ...SCOPED.metadata, analytics: { status: "WAITING_FOR_DATA" } } }))?.kind).toBe("WAITING");
      expect(await notice({ ...SCOPED, metadata: { ...SCOPED.metadata, analytics: { status: "OK" } } })).toBeNull();
    });

    it("stay hidden (not just empty) for an unconnected YouTube channel — no business row at all", async () => {
      createClientMock.mockResolvedValue(
        makeClient({
          tracked_channels: listQuery([{ id: "c1", platform: "youtube", external_id: "@my", url: "" }]),
          marketing_metric_snapshots: listQuery([]),
        }),
      );

      const result = await getChannelGrowthSeries("business-1", { now: NOW, days: 7 });
      expect(result.channels[0].metrics.map((m) => m.metric)).toEqual(["subscriberCount", "viewCount"]);
      expect(getConnectionMock).not.toHaveBeenCalled();
    });

    it("stay hidden after disconnect, even though the previously-collected data is preserved in the snapshots table (retention option A)", async () => {
      createClientMock.mockResolvedValue(
        makeClient({
          tracked_channels: listQuery([{ id: "c1", platform: "youtube", external_id: "@my", url: "" }]),
          // Data from before the disconnect is still sitting in the table.
          marketing_metric_snapshots: listQuery([snapshot("c1", "yt_analytics.estimatedMinutesWatched", 400, 1)]),
          businesses: singleQuery({ owner_id: "user-1" }),
        }),
      );
      getConnectionMock.mockResolvedValue({ status: "DISCONNECTED", metadata: { scope: "https://www.googleapis.com/auth/yt-analytics.readonly" } });

      const result = await getChannelGrowthSeries("business-1", { now: NOW, days: 7 });
      expect(result.channels[0].metrics.map((m) => m.metric)).toEqual(["subscriberCount", "viewCount"]);
    });

    it("stay hidden when connected but the token predates the yt-analytics.readonly scope", async () => {
      createClientMock.mockResolvedValue(
        makeClient({
          tracked_channels: listQuery([{ id: "c1", platform: "youtube", external_id: "@my", url: "" }]),
          marketing_metric_snapshots: listQuery([]),
          businesses: singleQuery({ owner_id: "user-1" }),
        }),
      );
      getConnectionMock.mockResolvedValue({ status: "CONNECTED", metadata: { scope: "https://www.googleapis.com/auth/youtube.upload" } });

      const result = await getChannelGrowthSeries("business-1", { now: NOW, days: 7 });
      expect(result.channels[0].metrics.map((m) => m.metric)).toEqual(["subscriberCount", "viewCount"]);
    });

    it("never apply to non-YouTube platforms, and never trigger a connection lookup for them", async () => {
      createClientMock.mockResolvedValue(
        makeClient({
          tracked_channels: listQuery([{ id: "c1", platform: "tistory", external_id: "myname", url: "" }]),
          marketing_metric_snapshots: listQuery([]),
        }),
      );

      const result = await getChannelGrowthSeries("business-1", { now: NOW, days: 7 });
      expect(result.channels[0].metrics.map((m) => m.metric)).toEqual(["postCount"]);
      expect(getConnectionMock).not.toHaveBeenCalled();
    });
  });
});

/** A snapshots table that honours .range() like PostgREST (at most `max` rows per request) and .lt()/.gte() on recorded_at. */
function realisticSnapshots(rows: Array<ReturnType<typeof snapshot>>, max = 1_000) {
  const state = { gte: "", lt: "", from: 0, to: Number.MAX_SAFE_INTEGER, limit: Number.MAX_SAFE_INTEGER, desc: false, calls: 0 };
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "in", "eq"]) builder[method] = vi.fn(() => builder);
  builder.gte = vi.fn((_: string, value: string) => { state.gte = value; return builder; });
  builder.lt = vi.fn((_: string, value: string) => { state.lt = value; return builder; });
  builder.order = vi.fn((column: string, options?: { ascending?: boolean }) => { if (column === "recorded_at") state.desc = options?.ascending === false; return builder; });
  builder.range = vi.fn((from: number, to: number) => { state.from = from; state.to = to; return builder; });
  builder.limit = vi.fn((value: number) => { state.limit = value; return builder; });
  builder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) => {
    state.calls += 1;
    let list = rows.filter((row) => (!state.gte || row.recorded_at >= state.gte) && (!state.lt || row.recorded_at < state.lt));
    list = [...list].sort((a, b) => (state.desc ? b.recorded_at.localeCompare(a.recorded_at) : a.recorded_at.localeCompare(b.recorded_at)));
    const sliced = list.slice(state.from, Math.min(state.to + 1, state.from + Math.min(max, state.limit)));
    state.from = 0; state.to = Number.MAX_SAFE_INTEGER; state.gte = ""; state.lt = "";
    return resolve({ data: sliced, error: null });
  };
  return { builder, state };
}

describe("getChannelGrowthSeries — the chart data", () => {
  const youtube = [{ id: "c1", platform: "youtube", external_id: "@my", url: "https://youtube.com/@my" }];

  it("reads every snapshot of a long window page by page instead of silently stopping at 1,000 rows", async () => {
    // 90 days x 2 metrics x 8 collections a day = 1,440 snapshots: more than one PostgREST page.
    const rows: Array<ReturnType<typeof snapshot>> = [];
    for (let day = 0; day < 190; day++) {
      for (let hour = 0; hour < 8; hour++) {
        const at = NOW.getTime() - day * DAY_MS - hour * 3 * 3_600_000;
        rows.push({ channel_id: "c1", metric: "subscriberCount", value: 1_000 + (190 - day), recorded_at: new Date(at).toISOString(), source: "live" });
      }
    }
    const table = realisticSnapshots(rows);
    createClientMock.mockResolvedValue(makeClient({ tracked_channels: listQuery(youtube), marketing_metric_snapshots: table.builder as never }));

    const result = await getChannelGrowthSeries("business-1", { now: NOW, days: 90 });
    const subscribers = result.channels[0].metrics.find((metric) => metric.metric === "subscriberCount")!;

    expect(rows.length).toBeGreaterThan(1_000);
    expect(subscribers.points).toHaveLength(90);
    expect(subscribers.points.every((point) => point.value !== null)).toBe(true);
    // The oldest day of the window must be there (the first page alone would have ended long before it).
    expect(subscribers.points[0].value).toBeLessThan(subscribers.points[89].value!);
    expect(subscribers.current).toBe(1_190);
    expect(subscribers.previous).not.toBeNull();
  });

  it("uses the last value from before the comparison window when the channel was not collected inside it", async () => {
    const rows = [snapshot("c1", "subscriberCount", 500, 100), snapshot("c1", "subscriberCount", 560, 3), snapshot("c1", "subscriberCount", 580, 1)];
    const table = realisticSnapshots(rows);
    createClientMock.mockResolvedValue(makeClient({ tracked_channels: listQuery(youtube), marketing_metric_snapshots: table.builder as never }));

    const metric = (await getChannelGrowthSeries("business-1", { now: NOW, days: 7 })).channels[0].metrics.find((m) => m.metric === "subscriberCount")!;

    expect(metric.current).toBe(580);
    expect(metric.previous).toBe(500); // collected 100 days ago, the latest value before the period began
    expect(metric.absoluteDelta).toBe(80);
  });

  it("accepts numbers that arrive as strings and drops values that are not numbers instead of charting them as 0", async () => {
    const rows = [
      { ...snapshot("c1", "subscriberCount", 0, 2), value: "1200" as unknown as number },
      { ...snapshot("c1", "subscriberCount", 0, 1), value: "n/a" as unknown as number },
      { ...snapshot("c1", "subscriberCount", 1300, 0) },
    ];
    createClientMock.mockResolvedValue(makeClient({ tracked_channels: listQuery(youtube), marketing_metric_snapshots: realisticSnapshots(rows).builder as never }));

    const metric = (await getChannelGrowthSeries("business-1", { now: NOW, days: 7 })).channels[0].metrics.find((m) => m.metric === "subscriberCount")!;

    expect(metric.current).toBe(1300);
    expect(metric.points.map((point) => point.value).filter((value) => value !== null)).toEqual([1200, 1200, 1300]);
    expect(metric.points.every((point) => point.value !== 0)).toBe(true);
  });

  it("shows each Korean calendar day's value as of the end of that day, not at the same clock time", async () => {
    // 2026-10-09 23:30 KST = 14:30Z: belongs to KST Oct 9, so Oct 9's point must already include it.
    const rows = [
      { channel_id: "c1", metric: "subscriberCount", value: 100, recorded_at: "2026-10-08T03:00:00.000Z", source: "live" },
      { channel_id: "c1", metric: "subscriberCount", value: 150, recorded_at: "2026-10-09T14:30:00.000Z", source: "live" },
    ];
    createClientMock.mockResolvedValue(makeClient({ tracked_channels: listQuery(youtube), marketing_metric_snapshots: realisticSnapshots(rows).builder as never }));

    const metric = (await getChannelGrowthSeries("business-1", { now: new Date("2026-10-10T05:00:00.000Z"), days: 4 })).channels[0].metrics.find((m) => m.metric === "subscriberCount")!;

    expect(metric.points.map((point) => `${point.date}:${point.value}`)).toEqual(["2026-10-07:null", "2026-10-08:100", "2026-10-09:150", "2026-10-10:150"]);
  });
});
