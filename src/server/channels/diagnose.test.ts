import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, serverEnvMock, collectMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  serverEnvMock: { CHANNEL_DATA_PROVIDER: "mock" as string },
  collectMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/env/server", () => ({ serverEnv: serverEnvMock }));
vi.mock("./providers", () => ({ getYouTubeDataProvider: () => ({ collect: collectMock }) }));

const { diagnoseYouTubeChannel } = await import("./diagnose");

const TRACKED_CHANNEL = { id: "channel-1", business_id: "business-1", external_id: "@mychannel" };
const NOW = new Date("2026-10-10T12:00:00.000Z");

const SAMPLE_METRICS = {
  subscriberCount: 1000,
  hiddenSubscriberCount: false,
  viewCount: 50_000,
  videoCount: 10,
  recentVideos: [
    { publishedAt: "2026-10-09T00:00:00.000Z", viewCount: 600 },
    { publishedAt: "2026-09-25T00:00:00.000Z", viewCount: 400 },
  ],
};

function tableBuilder({ selectResult, insertResult }: { selectResult: { data: unknown; error: unknown }; insertResult?: { data: unknown; error: unknown } }) {
  const insertBuilder = {
    select: vi.fn(() => insertBuilder),
    single: vi.fn().mockResolvedValue(insertResult),
  };
  const insertSpy = vi.fn((_payload: Record<string, unknown>) => insertBuilder);
  const selectBuilder = {
    select: vi.fn(() => selectBuilder),
    eq: vi.fn(() => selectBuilder),
    order: vi.fn(() => selectBuilder),
    limit: vi.fn(() => selectBuilder),
    maybeSingle: vi.fn().mockResolvedValue(selectResult),
    insert: insertSpy,
  };
  return selectBuilder;
}

function makeClient(args: { selectResult: { data: unknown; error: unknown }; insertResult?: { data: unknown; error: unknown } }) {
  const table = tableBuilder(args);
  return { from: vi.fn(() => table), table };
}

beforeEach(() => {
  serverEnvMock.CHANNEL_DATA_PROVIDER = "mock";
  collectMock.mockResolvedValue(SAMPLE_METRICS);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("diagnoseYouTubeChannel", () => {
  it("reuses a fresh same-provider cached diagnosis without calling the provider", async () => {
    const cachedRow = {
      overall_score: 70,
      activity_score: 70,
      consistency_score: 70,
      content_score: 70,
      metrics: { viewCount: 100 },
      findings: [],
      recommendations: [],
      completeness: "COMPLETE",
      data_source: "mock",
      created_at: new Date(NOW.getTime() - 10 * 60 * 1000).toISOString(), // 10 minutes ago
    };
    const client = makeClient({ selectResult: { data: cachedRow, error: null } });
    createClientMock.mockResolvedValue(client);

    const result = await diagnoseYouTubeChannel(TRACKED_CHANNEL, { now: NOW });

    expect(result.overallScore).toBe(70);
    expect(result.dataSource).toBe("mock");
    expect(collectMock).not.toHaveBeenCalled();
    expect(client.table.insert).not.toHaveBeenCalled();
  });

  it("collects, scores, and persists a new diagnosis when there is no cached row", async () => {
    const insertedRow = {
      overall_score: 73,
      activity_score: 40,
      consistency_score: 100,
      content_score: 70,
      metrics: { viewCount: 50000, videoCount: 10, uploadsLast30Days: 2, subscriberCount: 1000, averageRecentViews: 500 },
      findings: [],
      recommendations: [],
      completeness: "COMPLETE",
      data_source: "mock",
      created_at: NOW.toISOString(),
    };
    const client = makeClient({ selectResult: { data: null, error: null }, insertResult: { data: insertedRow, error: null } });
    createClientMock.mockResolvedValue(client);

    const result = await diagnoseYouTubeChannel(TRACKED_CHANNEL, { now: NOW });

    expect(collectMock).toHaveBeenCalledWith("@mychannel", NOW);
    expect(client.table.insert).toHaveBeenCalledTimes(1);
    const insertArg = client.table.insert.mock.calls[0][0];
    expect(insertArg.business_id).toBe("business-1");
    expect(insertArg.channel_id).toBe("channel-1");
    expect(insertArg.data_source).toBe("mock");
    expect(insertArg.metrics).toEqual({ viewCount: 50000, videoCount: 10, uploadsLast30Days: expect.any(Number), subscriberCount: 1000, averageRecentViews: 500 });
    expect(result.collectedAt).toBe(NOW.toISOString());
  });

  it("re-collects when the cached row is older than 1 hour", async () => {
    const staleRow = {
      overall_score: 10,
      activity_score: 10,
      consistency_score: 10,
      content_score: 10,
      metrics: {},
      findings: [],
      recommendations: [],
      completeness: "COMPLETE",
      data_source: "mock",
      created_at: new Date(NOW.getTime() - 61 * 60 * 1000).toISOString(), // 61 minutes ago
    };
    const insertedRow = { ...staleRow, overall_score: 73, created_at: NOW.toISOString() };
    const client = makeClient({ selectResult: { data: staleRow, error: null }, insertResult: { data: insertedRow, error: null } });
    createClientMock.mockResolvedValue(client);

    await diagnoseYouTubeChannel(TRACKED_CHANNEL, { now: NOW });
    expect(collectMock).toHaveBeenCalledTimes(1);
  });

  it("re-collects when the cached row's data_source no longer matches CHANNEL_DATA_PROVIDER", async () => {
    const cachedFromLive = {
      overall_score: 90,
      activity_score: 90,
      consistency_score: 90,
      content_score: 90,
      metrics: {},
      findings: [],
      recommendations: [],
      completeness: "COMPLETE",
      data_source: "live",
      created_at: new Date(NOW.getTime() - 5 * 60 * 1000).toISOString(),
    };
    serverEnvMock.CHANNEL_DATA_PROVIDER = "mock";
    const insertedRow = { ...cachedFromLive, data_source: "mock", created_at: NOW.toISOString() };
    const client = makeClient({ selectResult: { data: cachedFromLive, error: null }, insertResult: { data: insertedRow, error: null } });
    createClientMock.mockResolvedValue(client);

    await diagnoseYouTubeChannel(TRACKED_CHANNEL, { now: NOW });
    expect(collectMock).toHaveBeenCalledTimes(1);
  });

  it("throws ChannelsError when the cache lookup query fails", async () => {
    const client = makeClient({ selectResult: { data: null, error: new Error("boom") } });
    createClientMock.mockResolvedValue(client);

    await expect(diagnoseYouTubeChannel(TRACKED_CHANNEL, { now: NOW })).rejects.toMatchObject({ name: "ChannelsError", code: "DATABASE_ERROR" });
  });

  it("throws ChannelsError when persisting the new diagnosis fails", async () => {
    const client = makeClient({ selectResult: { data: null, error: null }, insertResult: { data: null, error: new Error("boom") } });
    createClientMock.mockResolvedValue(client);

    await expect(diagnoseYouTubeChannel(TRACKED_CHANNEL, { now: NOW })).rejects.toMatchObject({ name: "ChannelsError", code: "DATABASE_ERROR" });
  });

  it("propagates the provider's error (e.g. quota exceeded) without inserting a row", async () => {
    const client = makeClient({ selectResult: { data: null, error: null } });
    createClientMock.mockResolvedValue(client);
    collectMock.mockRejectedValueOnce(Object.assign(new Error("quota"), { name: "YouTubeCollectorError", code: "QUOTA_EXCEEDED" }));

    await expect(diagnoseYouTubeChannel(TRACKED_CHANNEL, { now: NOW })).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect(client.table.insert).not.toHaveBeenCalled();
  });
});
