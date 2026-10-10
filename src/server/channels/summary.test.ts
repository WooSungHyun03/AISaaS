import { describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

const { getLatestChannelDiagnosisSummary, getGrowthSummary } = await import("./summary");

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

const CHANNEL_ID = "channel-1";

describe("getLatestChannelDiagnosisSummary", () => {
  it("returns hasAnyData: false and an empty list when the business has no tracked channels", async () => {
    createClientMock.mockResolvedValue(makeClient({ tracked_channels: listQuery([]) }));

    const result = await getLatestChannelDiagnosisSummary("business-1");
    expect(result).toEqual({ businessId: "business-1", channels: [], hasAnyData: false });
  });

  it("returns hasAnyData: false when channels exist but none have a diagnosis yet", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        tracked_channels: listQuery([{ id: CHANNEL_ID, platform: "youtube", external_id: "@my", url: "https://youtube.com/@my" }]),
        channel_diagnoses: listQuery([]),
      }),
    );

    const result = await getLatestChannelDiagnosisSummary("business-1");
    expect(result).toEqual({ businessId: "business-1", channels: [], hasAnyData: false });
  });

  it("keeps only the latest diagnosis per channel and maps it to the camelCase shape", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        tracked_channels: listQuery([{ id: CHANNEL_ID, platform: "youtube", external_id: "@my", url: "https://youtube.com/@my" }]),
        channel_diagnoses: listQuery([
          {
            channel_id: CHANNEL_ID,
            overall_score: 80,
            activity_score: 70,
            consistency_score: 90,
            content_score: 75,
            metrics: { subscriberCount: 1200 },
            findings: ["최근 업로드가 꾸준해요"],
            recommendations: ["주 2회 업로드를 유지하세요"],
            completeness: "COMPLETE",
            data_source: "mock",
            created_at: "2026-10-10T00:00:00.000Z",
          },
          {
            channel_id: CHANNEL_ID,
            overall_score: 10,
            activity_score: 10,
            consistency_score: 10,
            content_score: 10,
            metrics: {},
            findings: [],
            recommendations: [],
            completeness: "INSUFFICIENT_DATA",
            data_source: "mock",
            created_at: "2026-10-01T00:00:00.000Z",
          },
        ]),
      }),
    );

    const result = await getLatestChannelDiagnosisSummary("business-1");
    expect(result.hasAnyData).toBe(true);
    expect(result.channels).toEqual([
      {
        channelId: CHANNEL_ID,
        externalId: "@my",
        url: "https://youtube.com/@my",
        channel: "youtube",
        overallScore: 80,
        activityScore: 70,
        consistencyScore: 90,
        contentScore: 75,
        metrics: { subscriberCount: 1200 },
        findings: ["최근 업로드가 꾸준해요"],
        recommendations: ["주 2회 업로드를 유지하세요"],
        dataSource: "mock",
        collectedAt: "2026-10-10T00:00:00.000Z",
        completeness: "COMPLETE",
      },
    ]);
  });

  it("throws ChannelsError when the tracked_channels query fails", async () => {
    createClientMock.mockResolvedValue(makeClient({ tracked_channels: errorQuery(new Error("boom")) }));
    await expect(getLatestChannelDiagnosisSummary("business-1")).rejects.toMatchObject({ name: "ChannelsError", code: "DATABASE_ERROR" });
  });
});

describe("getGrowthSummary", () => {
  const now = new Date("2026-10-10T00:00:00.000Z");

  it("returns hasAnyData: false when there are no tracked channels", async () => {
    createClientMock.mockResolvedValue(makeClient({ tracked_channels: listQuery([]) }));

    const result = await getGrowthSummary("business-1", { now });
    expect(result).toEqual({ businessId: "business-1", days: 7, trends: [], hasAnyData: false });
  });

  it("returns hasAnyData: false when channels exist but have no snapshots in the window", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        tracked_channels: listQuery([{ id: CHANNEL_ID, platform: "youtube" }]),
        marketing_metric_snapshots: listQuery([]),
      }),
    );

    const result = await getGrowthSummary("business-1", { now });
    expect(result).toEqual({ businessId: "business-1", days: 7, trends: [], hasAnyData: false });
  });

  it("computes current vs. previous and the delta percent for each (channel, metric)", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        tracked_channels: listQuery([{ id: CHANNEL_ID, platform: "youtube" }]),
        marketing_metric_snapshots: listQuery([
          { channel_id: CHANNEL_ID, metric: "subscriberCount", value: 100, recorded_at: "2026-09-29T00:00:00.000Z" }, // previous window
          { channel_id: CHANNEL_ID, metric: "subscriberCount", value: 120, recorded_at: "2026-10-09T00:00:00.000Z" }, // current window
        ]),
      }),
    );

    const result = await getGrowthSummary("business-1", { now, days: 7 });
    expect(result.hasAnyData).toBe(true);
    expect(result.trends).toEqual([
      { channelId: CHANNEL_ID, platform: "youtube", metric: "subscriberCount", current: 120, previous: 100, deltaPercent: 20 },
    ]);
  });

  it("leaves deltaPercent null when there is no previous-window value to compare against", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        tracked_channels: listQuery([{ id: CHANNEL_ID, platform: "youtube" }]),
        marketing_metric_snapshots: listQuery([
          { channel_id: CHANNEL_ID, metric: "subscriberCount", value: 120, recorded_at: "2026-10-09T00:00:00.000Z" },
        ]),
      }),
    );

    const result = await getGrowthSummary("business-1", { now, days: 7 });
    expect(result.trends).toEqual([
      { channelId: CHANNEL_ID, platform: "youtube", metric: "subscriberCount", current: 120, previous: null, deltaPercent: null },
    ]);
  });

  it("throws ChannelsError when the snapshots query fails", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        tracked_channels: listQuery([{ id: CHANNEL_ID, platform: "youtube" }]),
        marketing_metric_snapshots: errorQuery(new Error("boom")),
      }),
    );
    await expect(getGrowthSummary("business-1", { now })).rejects.toMatchObject({ name: "ChannelsError", code: "DATABASE_ERROR" });
  });
});
