import { afterEach, describe, expect, it, vi } from "vitest";

const { adminClientMock, getConnectionMock, collectorMock, getCollectorMock, saveMetricSnapshotMock } = vi.hoisted(() => ({
  adminClientMock: { __marker: "admin" },
  getConnectionMock: vi.fn(),
  collectorMock: vi.fn(),
  getCollectorMock: vi.fn(),
  saveMetricSnapshotMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminClientMock }));
vi.mock("@/server/connectors/integrations", () => ({ getConnection: getConnectionMock }));
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

  it("skips cleanly when no real collector exists yet (CHANNEL_DATA_PROVIDER=live) — never calls getConnection or saveMetricSnapshot", async () => {
    getCollectorMock.mockReturnValue(null);
    await collectYouTubeAnalyticsIfConnected(CHANNEL, "user-1", NOW);
    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(saveMetricSnapshotMock).not.toHaveBeenCalled();
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

  it("collects and saves both metrics under the yt_analytics namespace when connected with scope", async () => {
    getCollectorMock.mockReturnValue(collectorMock);
    getConnectionMock.mockResolvedValue({ status: "CONNECTED", metadata: { scope: "https://www.googleapis.com/auth/yt-analytics.readonly" } });
    collectorMock.mockResolvedValue([
      { date: "2026-10-07", estimatedMinutesWatched: 400, averageViewDuration: 95 },
      { date: "2026-10-08", estimatedMinutesWatched: 412, averageViewDuration: 97 },
    ]);

    await collectYouTubeAnalyticsIfConnected(CHANNEL, "user-1", NOW);

    expect(saveMetricSnapshotMock).toHaveBeenCalledTimes(4);
    expect(saveMetricSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "channel-1", metric: "yt_analytics.estimatedMinutesWatched", value: 400 }),
    );
    expect(saveMetricSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "channel-1", metric: "yt_analytics.averageViewDuration", value: 95 }),
    );
    const call = saveMetricSnapshotMock.mock.calls.find((args) => args[0].metric === "yt_analytics.estimatedMinutesWatched" && args[0].value === 400);
    expect(call?.[0].recordedAt.toISOString()).toBe(new Date("2026-10-07T00:00:00+09:00").toISOString());
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
