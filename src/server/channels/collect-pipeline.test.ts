import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, serverEnvMock, saveMetricSnapshotMock, youtubeCollectMock, tistoryCollectMock, naverCollectMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  serverEnvMock: { CHANNEL_DATA_PROVIDER: "mock" as string },
  saveMetricSnapshotMock: vi.fn().mockResolvedValue(undefined),
  youtubeCollectMock: vi.fn(),
  tistoryCollectMock: vi.fn(),
  naverCollectMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/env/server", () => ({ serverEnv: serverEnvMock }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./snapshot", () => ({ saveMetricSnapshot: saveMetricSnapshotMock }));
vi.mock("./providers", () => ({
  getYouTubeDataProvider: () => ({ collect: youtubeCollectMock }),
  getTistoryCollector: () => tistoryCollectMock,
  getNaverBlogCollector: () => naverCollectMock,
}));

const { snapshotChannelMetrics, cleanupOldSnapshots, processDueChannels } = await import("./collect-pipeline");

const NOW = new Date("2026-10-10T00:00:00.000Z");

beforeEach(() => {
  serverEnvMock.CHANNEL_DATA_PROVIDER = "mock";
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("snapshotChannelMetrics: platform dispatch (reuses 1-2/1-3/1-4's collectors)", () => {
  it("youtube: saves viewCount/videoCount/subscriberCount", async () => {
    youtubeCollectMock.mockResolvedValue({ subscriberCount: 500, hiddenSubscriberCount: false, viewCount: 10000, videoCount: 20, recentVideos: [] });
    await snapshotChannelMetrics({ id: "c1", platform: "youtube", external_id: "@x", url: "https://youtube.com/@x" }, undefined, NOW);

    expect(youtubeCollectMock).toHaveBeenCalledWith("@x", NOW);
    const metrics = saveMetricSnapshotMock.mock.calls.map((call) => call[0].metric);
    expect(metrics.sort()).toEqual(["subscriberCount", "videoCount", "viewCount"]);
  });

  it("youtube: omits subscriberCount when hidden", async () => {
    youtubeCollectMock.mockResolvedValue({ subscriberCount: null, hiddenSubscriberCount: true, viewCount: 10000, videoCount: 20, recentVideos: [] });
    await snapshotChannelMetrics({ id: "c1", platform: "youtube", external_id: "@x", url: "" }, undefined, NOW);
    const metrics = saveMetricSnapshotMock.mock.calls.map((call) => call[0].metric);
    expect(metrics).not.toContain("subscriberCount");
  });

  it("tistory: saves postCount, fetching {channel.url}/rss via getTistoryCollector", async () => {
    tistoryCollectMock.mockResolvedValue({ posts: [{ publishedAt: NOW.toISOString() }, { publishedAt: NOW.toISOString() }], observedCapped: false, unavailableReason: null });
    await snapshotChannelMetrics({ id: "c2", platform: "tistory", external_id: "myname", url: "https://myname.tistory.com/" }, undefined, NOW);

    expect(tistoryCollectMock).toHaveBeenCalledWith("https://myname.tistory.com/", NOW);
    expect(saveMetricSnapshotMock).toHaveBeenCalledWith(expect.objectContaining({ channelId: "c2", metric: "postCount", value: 2 }));
  });

  it("naver_blog: saves matchedPostCount and postsLast30Days, passing the business name through", async () => {
    naverCollectMock.mockResolvedValue({ matchedPostCount: 4, postsLast30Days: 3, averageGapDays: 5, lastPostDate: "2026-10-09", firstPostDate: "2026-09-20" });
    await snapshotChannelMetrics({ id: "c3", platform: "naver_blog", external_id: "myblogid", url: "" }, "우리동네 빵집", NOW);

    expect(naverCollectMock).toHaveBeenCalledWith("myblogid", "우리동네 빵집", NOW);
    const calls = saveMetricSnapshotMock.mock.calls.map((call) => [call[0].metric, call[0].value]);
    expect(calls).toEqual(expect.arrayContaining([["matchedPostCount", 4], ["postsLast30Days", 3]]));
  });

  it("saves every snapshot with the currently-configured CHANNEL_DATA_PROVIDER as source", async () => {
    serverEnvMock.CHANNEL_DATA_PROVIDER = "live";
    youtubeCollectMock.mockResolvedValue({ subscriberCount: 1, hiddenSubscriberCount: false, viewCount: 1, videoCount: 1, recentVideos: [] });
    await snapshotChannelMetrics({ id: "c1", platform: "youtube", external_id: "@x", url: "" }, undefined, NOW);
    expect(saveMetricSnapshotMock.mock.calls.every((call) => call[0].source === "live")).toBe(true);
  });
});

function supabaseStub(tables: Record<string, unknown>) {
  return { from: vi.fn((name: string) => tables[name]) };
}

describe("cleanupOldSnapshots", () => {
  it("deletes snapshots older than the retention window and returns the count", async () => {
    const lt = vi.fn().mockResolvedValue({ error: null, count: 7 });
    const del = vi.fn(() => ({ lt }));
    createClientMock.mockResolvedValue(supabaseStub({ marketing_metric_snapshots: { delete: del } }));

    const result = await cleanupOldSnapshots(NOW);
    expect(result).toBe(7);
    expect(del).toHaveBeenCalledWith({ count: "exact" });
    const cutoff = lt.mock.calls[0][1] as string;
    expect(new Date(NOW.getTime() - new Date(cutoff).getTime()).getTime() / 86_400_000).toBeCloseTo(200, 0);
  });

  it("throws ChannelsError when the delete fails", async () => {
    const lt = vi.fn().mockResolvedValue({ error: new Error("boom"), count: null });
    createClientMock.mockResolvedValue(supabaseStub({ marketing_metric_snapshots: { delete: vi.fn(() => ({ lt })) } }));
    await expect(cleanupOldSnapshots(NOW)).rejects.toMatchObject({ name: "ChannelsError", code: "DATABASE_ERROR" });
  });
});

describe("processDueChannels", () => {
  function makeDueChannelsClient(due: Array<Record<string, unknown>>) {
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn((_payload: Record<string, unknown>) => ({ eq: updateEq }));
    const trackedChannelsLte = vi.fn().mockResolvedValue({ data: due, error: null });
    const trackedChannelsEq = vi.fn(() => ({ lte: trackedChannelsLte }));
    const trackedChannelsSelect = vi.fn(() => ({ eq: trackedChannelsEq }));
    const businessesMaybeSingle = vi.fn().mockResolvedValue({ data: { name: "사업체" }, error: null });
    const businessesEq = vi.fn(() => ({ maybeSingle: businessesMaybeSingle }));
    const businessesSelect = vi.fn(() => ({ eq: businessesEq }));

    const client = supabaseStub({
      tracked_channels: { select: trackedChannelsSelect, update },
      businesses: { select: businessesSelect },
    });
    return { client, update, updateEq };
  }

  it("on success: resets consecutive_failure_count and advances next_snapshot_at", async () => {
    youtubeCollectMock.mockResolvedValue({ subscriberCount: 1, hiddenSubscriberCount: false, viewCount: 1, videoCount: 1, recentVideos: [] });
    const due = [{ id: "c1", business_id: "b1", platform: "youtube", external_id: "@x", url: "", consecutive_failure_count: 2 }];
    const { client, update } = makeDueChannelsClient(due);
    createClientMock.mockResolvedValue(client);

    const result = await processDueChannels(NOW, 30_000);

    expect(result).toEqual({ processed: 1, failed: 0, paused: 0 });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ consecutive_failure_count: 0, next_snapshot_at: expect.any(String) }));
  });

  it("on failure: increments consecutive_failure_count without pausing before the threshold", async () => {
    youtubeCollectMock.mockRejectedValue(new Error("boom"));
    const due = [{ id: "c1", business_id: "b1", platform: "youtube", external_id: "@x", url: "", consecutive_failure_count: 1 }];
    const { client, update } = makeDueChannelsClient(due);
    createClientMock.mockResolvedValue(client);

    const result = await processDueChannels(NOW, 30_000);

    expect(result).toEqual({ processed: 0, failed: 1, paused: 0 });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ consecutive_failure_count: 2 }));
    expect(update.mock.calls[0][0]).not.toHaveProperty("status");
  });

  it("pauses the channel once consecutive failures reach 5", async () => {
    youtubeCollectMock.mockRejectedValue(new Error("boom"));
    const due = [{ id: "c1", business_id: "b1", platform: "youtube", external_id: "@x", url: "", consecutive_failure_count: 4 }];
    const { client, update } = makeDueChannelsClient(due);
    createClientMock.mockResolvedValue(client);

    const result = await processDueChannels(NOW, 30_000);

    expect(result).toEqual({ processed: 0, failed: 1, paused: 1 });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ consecutive_failure_count: 5, status: "PAUSED" }));
  });

  it("stops processing once the time budget is exhausted, leaving the rest due for next tick", async () => {
    youtubeCollectMock.mockResolvedValue({ subscriberCount: 1, hiddenSubscriberCount: false, viewCount: 1, videoCount: 1, recentVideos: [] });
    const due = [
      { id: "c1", business_id: "b1", platform: "youtube", external_id: "@x", url: "", consecutive_failure_count: 0 },
      { id: "c2", business_id: "b1", platform: "youtube", external_id: "@y", url: "", consecutive_failure_count: 0 },
    ];
    const { client } = makeDueChannelsClient(due);
    createClientMock.mockResolvedValue(client);

    const result = await processDueChannels(NOW, -1); // already-expired budget: process nothing
    expect(result).toEqual({ processed: 0, failed: 0, paused: 0 });
  });
});
