import { afterEach, describe, expect, it, vi } from "vitest";

const { adminClientMock, getConnectionMock, updateConnectionStatusMock, collectorMock, getCollectorMock, saveMetricSnapshotMock } = vi.hoisted(() => ({
  adminClientMock: { __marker: "admin" },
  getConnectionMock: vi.fn(),
  updateConnectionStatusMock: vi.fn().mockResolvedValue(undefined),
  collectorMock: vi.fn(),
  getCollectorMock: vi.fn(),
  saveMetricSnapshotMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminClientMock }));
vi.mock("@/server/connectors/integrations", () => ({ getConnection: getConnectionMock, updateConnectionStatus: updateConnectionStatusMock }));
vi.mock("./providers", () => ({ getYouTubeAnalyticsCollector: getCollectorMock }));
vi.mock("./snapshot", () => ({ saveMetricSnapshot: saveMetricSnapshotMock }));

const { collectYouTubeAnalyticsIfConnected } = await import("./youtube-analytics-pipeline");

const CHANNEL = { id: "channel-1", business_id: "business-1", platform: "youtube" as const, external_id: "@x", url: "" };
const NOW = new Date("2026-10-10T12:00:00.000Z");

afterEach(() => {
  vi.clearAllMocks();
});

describe("collectYouTubeAnalyticsIfConnected", () => {
  it("does nothing for a non-youtube channel", async () => {
    getCollectorMock.mockReturnValue(collectorMock);
    await collectYouTubeAnalyticsIfConnected({ ...CHANNEL, platform: "tistory" as unknown as "youtube" }, "user-1", NOW);
    expect(getConnectionMock).not.toHaveBeenCalled();
  });

  it("does nothing when there is no owner id", async () => {
    getCollectorMock.mockReturnValue(collectorMock);
    await collectYouTubeAnalyticsIfConnected(CHANNEL, null, NOW);
    expect(getConnectionMock).not.toHaveBeenCalled();
  });

  it("skips when there is no connection at all", async () => {
    getCollectorMock.mockReturnValue(collectorMock);
    getConnectionMock.mockResolvedValue(null);
    await collectYouTubeAnalyticsIfConnected(CHANNEL, "user-1", NOW);
    expect(saveMetricSnapshotMock).not.toHaveBeenCalled();
  });

  it("stops collecting once the connection is disconnected", async () => {
    getCollectorMock.mockReturnValue(collectorMock);
    getConnectionMock.mockResolvedValue({ status: "DISCONNECTED", metadata: { scope: "https://www.googleapis.com/auth/yt-analytics.readonly" } });
    await collectYouTubeAnalyticsIfConnected(CHANNEL, "user-1", NOW);
    expect(saveMetricSnapshotMock).not.toHaveBeenCalled();
  });

  it("skips when connected but missing the yt-analytics.readonly scope (needs reconnect)", async () => {
    getCollectorMock.mockReturnValue(collectorMock);
    getConnectionMock.mockResolvedValue({ status: "CONNECTED", metadata: { scope: "https://www.googleapis.com/auth/youtube.upload" } });
    await collectYouTubeAnalyticsIfConnected(CHANNEL, "user-1", NOW);
    expect(collectorMock).not.toHaveBeenCalled();
    expect(saveMetricSnapshotMock).not.toHaveBeenCalled();
  });

  it("collects and saves views, watch time, average duration and net subscribers under the yt_analytics namespace", async () => {
    getCollectorMock.mockReturnValue(collectorMock);
    getConnectionMock.mockResolvedValue({ id: "conn-1", status: "CONNECTED", metadata: { scope: "https://www.googleapis.com/auth/yt-analytics.readonly" } });
    collectorMock.mockResolvedValue([
      { date: "2026-10-07", views: 300, estimatedMinutesWatched: 400, averageViewDuration: 95, subscribersGained: 9, subscribersLost: 2 },
      { date: "2026-10-08", views: 320, estimatedMinutesWatched: 412, averageViewDuration: 97, subscribersGained: 3, subscribersLost: 5 },
    ]);

    await collectYouTubeAnalyticsIfConnected(CHANNEL, "user-1", NOW);

    expect(saveMetricSnapshotMock).toHaveBeenCalledTimes(8);
    const saved = (metric: string, value: number) => expect(saveMetricSnapshotMock).toHaveBeenCalledWith(expect.objectContaining({ channelId: "channel-1", metric, value }));
    saved("yt_analytics.views", 300);
    saved("yt_analytics.estimatedMinutesWatched", 400);
    saved("yt_analytics.averageViewDuration", 95);
    saved("yt_analytics.netSubscribers", 7);
    saved("yt_analytics.netSubscribers", -2);
    const call = saveMetricSnapshotMock.mock.calls.find((args) => args[0].metric === "yt_analytics.estimatedMinutesWatched" && args[0].value === 400);
    expect(call?.[0].recordedAt.toISOString()).toBe(new Date("2026-10-07T00:00:00+09:00").toISOString());
    expect(updateConnectionStatusMock).toHaveBeenCalledWith(adminClientMock, "conn-1", "CONNECTED", expect.objectContaining({ analytics: { status: "OK", checkedAt: NOW.toISOString() } }));
  });

  it("records WAITING_FOR_DATA when the API has nothing yet (new channel / 48–72h delay)", async () => {
    getCollectorMock.mockReturnValue(collectorMock);
    getConnectionMock.mockResolvedValue({ id: "conn-1", status: "CONNECTED", metadata: { scope: "https://www.googleapis.com/auth/yt-analytics.readonly" } });
    collectorMock.mockResolvedValue([]);

    await collectYouTubeAnalyticsIfConnected(CHANNEL, "user-1", NOW);

    expect(saveMetricSnapshotMock).not.toHaveBeenCalled();
    expect(updateConnectionStatusMock).toHaveBeenCalledWith(adminClientMock, "conn-1", "CONNECTED", expect.objectContaining({ analytics: expect.objectContaining({ status: "WAITING_FOR_DATA" }) }));
  });

  it("remembers why collection failed (so the report can tell the owner what to do) without throwing", async () => {
    const { YouTubeAnalyticsError } = await import("@/server/connectors/youtube/analytics");
    getCollectorMock.mockReturnValue(collectorMock);
    getConnectionMock.mockResolvedValue({ id: "conn-1", status: "CONNECTED", metadata: { scope: "https://www.googleapis.com/auth/yt-analytics.readonly" } });
    collectorMock.mockRejectedValue(new YouTubeAnalyticsError("CHANNEL_MISMATCH", "PERMISSION_DENIED", "mismatch"));

    await expect(collectYouTubeAnalyticsIfConnected(CHANNEL, "user-1", NOW)).resolves.toBeUndefined();
    expect(updateConnectionStatusMock).toHaveBeenCalledWith(adminClientMock, "conn-1", "CONNECTED", expect.objectContaining({ analytics: expect.objectContaining({ status: "CHANNEL_MISMATCH" }) }));
  });

  it("never throws when the collector itself fails — logs and swallows instead", async () => {
    getCollectorMock.mockReturnValue(collectorMock);
    getConnectionMock.mockResolvedValue({ status: "CONNECTED", metadata: { scope: "https://www.googleapis.com/auth/yt-analytics.readonly" } });
    collectorMock.mockRejectedValue(new Error("boom"));

    await expect(collectYouTubeAnalyticsIfConnected(CHANNEL, "user-1", NOW)).resolves.toBeUndefined();
    expect(saveMetricSnapshotMock).not.toHaveBeenCalled();
  });

  it("never throws when getConnection itself fails — logs and swallows instead", async () => {
    getCollectorMock.mockReturnValue(collectorMock);
    getConnectionMock.mockRejectedValue(new Error("db down"));

    await expect(collectYouTubeAnalyticsIfConnected(CHANNEL, "user-1", NOW)).resolves.toBeUndefined();
    expect(saveMetricSnapshotMock).not.toHaveBeenCalled();
  });
});
