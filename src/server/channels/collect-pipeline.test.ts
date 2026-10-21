import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb } from "@/test/fake-db";

const { createAdminClientMock, serverEnvMock, saveMetricSnapshotMock, youtubeCollectMock, tistoryCollectMock, naverCollectMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  serverEnvMock: { CHANNEL_DATA_PROVIDER: "mock" as string },
  saveMetricSnapshotMock: vi.fn().mockResolvedValue(undefined),
  youtubeCollectMock: vi.fn(),
  tistoryCollectMock: vi.fn(),
  naverCollectMock: vi.fn(),
}));

// Cron-only paths: no user session, so they must use the service-role client.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/env/server", () => ({ serverEnv: serverEnvMock }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./snapshot", () => ({ saveMetricSnapshot: saveMetricSnapshotMock }));
vi.mock("./providers", () => ({
  getYouTubeDataProvider: () => ({ collect: youtubeCollectMock }),
  getTistoryCollector: () => tistoryCollectMock,
  getNaverBlogCollector: () => naverCollectMock,
}));

const { cleanupOldSnapshots, collectAndPersistChannel, processDueChannels, planFailure } = await import("./collect-pipeline");
const { FeedTransientError } = await import("./providers/feed-failure");
const { YouTubeCollectorError } = await import("./providers/youtube-types");

// 2026-10-13 06:02 KST — just after the 06:00 slot.
const NOW = new Date("2026-10-12T21:02:00.000Z");
const NEXT_6AM = "2026-10-13T21:00:00.000Z";

const youtubeResult = (overrides: Record<string, unknown> = {}) => ({
  channelId: "UCabcdefghijklmnopqrstuv",
  title: "우리 채널",
  thumbnailUrl: "https://yt3.ggpht.com/m",
  subscriberCount: 500,
  hiddenSubscriberCount: false,
  viewCount: 10_000,
  videoCount: 20,
  recentVideos: [{ videoId: "v1", title: "첫 영상", publishedAt: "2026-10-10T00:00:00.000Z", viewCount: 300, likeCount: 12, commentCount: null }],
  ...overrides,
});

const channelRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  business_id: "b1",
  platform: "youtube",
  external_id: "UCabcdefghijklmnopqrstuv",
  url: "https://youtube.com/channel/UCabcdefghijklmnopqrstuv",
  status: "ACTIVE",
  consecutive_failure_count: 0,
  next_snapshot_at: "2026-10-12T21:00:00.000Z",
  ...overrides,
});

function setup(channels: Array<Record<string, unknown>>) {
  const db = makeFakeDb({ tracked_channels: channels, businesses: [{ id: "b1", name: "우리동네 빵집" }] });
  createAdminClientMock.mockReturnValue(db.client);
  return db;
}

beforeEach(() => {
  serverEnvMock.CHANNEL_DATA_PROVIDER = "live";
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("collectAndPersistChannel: what gets saved per platform", () => {
  it("youtube: channel metrics, the recent videos with their public counts, and the channel's display info", async () => {
    const db = setup([channelRow("c1")]);
    youtubeCollectMock.mockResolvedValue(youtubeResult());

    const saved = await collectAndPersistChannel({ id: "c1", platform: "youtube", external_id: "UCabcdefghijklmnopqrstuv", url: "" }, undefined, NOW);

    expect(saved).toMatchObject({ status: "SUCCESS", metricsSaved: 3, contentSaved: 1 });
    expect(saveMetricSnapshotMock.mock.calls.map((call) => call[0].metric).sort()).toEqual(["subscriberCount", "videoCount", "viewCount"]);
    const content = db.tables.channel_content_snapshots[0];
    expect(content).toMatchObject({ channel_id: "c1", external_content_id: "v1", title: "첫 영상", snapshot_date: "2026-10-13", metrics: { viewCount: 300, likeCount: 12 } });
    // a hidden comment count is left out, not saved as 0
    expect(content.metrics).not.toHaveProperty("commentCount");
    expect(db.tables.tracked_channels[0]).toMatchObject({ display_name: "우리 채널", thumbnail_url: "https://yt3.ggpht.com/m", last_collection_status: "SUCCESS", last_error_code: null });
  });

  it("youtube: a hidden subscriber count is not saved at all", async () => {
    setup([channelRow("c1")]);
    youtubeCollectMock.mockResolvedValue(youtubeResult({ subscriberCount: null, hiddenSubscriberCount: true }));
    await collectAndPersistChannel({ id: "c1", platform: "youtube", external_id: "UC", url: "" }, undefined, NOW);
    expect(saveMetricSnapshotMock.mock.calls.map((call) => call[0].metric)).not.toContain("subscriberCount");
  });

  it("tistory: feed-based counts plus the posts; an unreadable blog is UNAVAILABLE and saves no zero", async () => {
    const db = setup([channelRow("c2", { platform: "tistory", external_id: "myname" })]);
    tistoryCollectMock.mockResolvedValueOnce({ posts: [{ publishedAt: "2026-10-12T00:00:00.000Z", title: "글", url: "https://myname.tistory.com/1" }, { publishedAt: "2026-09-01T00:00:00.000Z", title: "옛글", url: "https://myname.tistory.com/0" }], observedCapped: false, unavailableReason: null, blogTitle: "내 블로그" });
    await collectAndPersistChannel({ id: "c2", platform: "tistory", external_id: "myname", url: "https://myname.tistory.com/" }, undefined, NOW);
    const metrics = Object.fromEntries(saveMetricSnapshotMock.mock.calls.map((call) => [call[0].metric, call[0].value]));
    expect(metrics).toEqual({ postCount: 2, postsLast7Days: 1, postsLast30Days: 1 });
    expect(db.tables.tracked_channels[0]).toMatchObject({ display_name: "내 블로그" });

    saveMetricSnapshotMock.mockClear();
    tistoryCollectMock.mockResolvedValueOnce({ posts: [], observedCapped: false, unavailableReason: "RSS를 가져올 수 없어요" });
    const saved = await collectAndPersistChannel({ id: "c2", platform: "tistory", external_id: "myname", url: "https://myname.tistory.com/" }, undefined, NOW);
    expect(saved.status).toBe("UNAVAILABLE");
    expect(saveMetricSnapshotMock).not.toHaveBeenCalled();
    expect(db.tables.tracked_channels[0]).toMatchObject({ last_collection_status: "UNAVAILABLE", last_error_code: "NO_PUBLIC_DATA" });
  });

  it("naver_blog: counts and 7-day posts come from the feed's own post dates", async () => {
    setup([channelRow("c3", { platform: "naver_blog", external_id: "myblogid" })]);
    naverCollectMock.mockResolvedValue({ matchedPostCount: 2, postsLast30Days: 2, averageGapDays: 3, lastPostDate: "2026-10-12", firstPostDate: "2026-10-09", basis: "rss", posts: [{ title: "a", url: "https://blog.naver.com/x/1", publishedAt: "2026-10-12T00:00:00.000Z" }, { title: "b", url: "https://blog.naver.com/x/2", publishedAt: "2026-10-09T00:00:00.000Z" }] });
    await collectAndPersistChannel({ id: "c3", platform: "naver_blog", external_id: "myblogid", url: "" }, "우리동네 빵집", NOW);
    expect(naverCollectMock).toHaveBeenCalledWith("myblogid", "우리동네 빵집", NOW);
    expect(Object.fromEntries(saveMetricSnapshotMock.mock.calls.map((call) => [call[0].metric, call[0].value]))).toEqual({ matchedPostCount: 2, postsLast30Days: 2, postsLast7Days: 2 });
  });

  it("saves every snapshot with the configured CHANNEL_DATA_PROVIDER as its source", async () => {
    serverEnvMock.CHANNEL_DATA_PROVIDER = "mock";
    setup([channelRow("c1")]);
    youtubeCollectMock.mockResolvedValue(youtubeResult());
    await collectAndPersistChannel({ id: "c1", platform: "youtube", external_id: "UC", url: "" }, undefined, NOW);
    expect(saveMetricSnapshotMock.mock.calls.every((call) => call[0].source === "mock")).toBe(true);
  });

  it("collecting the same KST day twice keeps one row per video (upsert), not a duplicate", async () => {
    const db = setup([channelRow("c1")]);
    youtubeCollectMock.mockResolvedValue(youtubeResult());
    await collectAndPersistChannel({ id: "c1", platform: "youtube", external_id: "UC", url: "" }, undefined, NOW);
    youtubeCollectMock.mockResolvedValue(youtubeResult({ recentVideos: [{ videoId: "v1", title: "첫 영상", publishedAt: "2026-10-10T00:00:00.000Z", viewCount: 320, likeCount: 13, commentCount: null }] }));
    await collectAndPersistChannel({ id: "c1", platform: "youtube", external_id: "UC", url: "" }, undefined, new Date(NOW.getTime() + 3_600_000));
    expect(db.tables.channel_content_snapshots).toHaveLength(1);
    expect(db.tables.channel_content_snapshots[0].metrics).toMatchObject({ viewCount: 320 });
  });
});

describe("cleanupOldSnapshots", () => {
  it("deletes metric and per-video snapshots older than the retention window (200 days)", async () => {
    const db = makeFakeDb({
      marketing_metric_snapshots: [{ id: "old", recorded_at: "2026-01-01T00:00:00.000Z" }, { id: "new", recorded_at: "2026-10-01T00:00:00.000Z" }],
      channel_content_snapshots: [{ id: "old", snapshot_date: "2026-01-01" }, { id: "new", snapshot_date: "2026-10-01" }],
    });
    createAdminClientMock.mockReturnValue(db.client);
    const removed = await cleanupOldSnapshots(NOW);
    expect(removed).toBe(1);
    expect(db.tables.marketing_metric_snapshots.map((row) => row.id)).toEqual(["new"]);
    expect(db.tables.channel_content_snapshots.map((row) => row.id)).toEqual(["new"]);
  });
});

describe("processDueChannels: the 06:00 KST tick", () => {
  it("collects a due channel, moves it to the NEXT 06:00 KST, logs the run, and resets failures", async () => {
    const db = setup([channelRow("c1", { consecutive_failure_count: 2 })]);
    youtubeCollectMock.mockResolvedValue(youtubeResult());

    const result = await processDueChannels(NOW, 30_000);

    expect(result).toMatchObject({ processed: 1, failed: 0, paused: 0, skipped: 0, quotaExceeded: false });
    expect(db.tables.tracked_channels[0]).toMatchObject({ next_snapshot_at: NEXT_6AM, consecutive_failure_count: 0, last_collection_status: "SUCCESS" });
    expect(db.tables.channel_collection_runs).toHaveLength(1);
    expect(db.tables.channel_collection_runs[0]).toMatchObject({ trigger: "CRON", status: "SUCCESS", channels_total: 1, channels_succeeded: 1, channels_failed: 0, scheduled_for: "2026-10-12T21:00:00.000Z" });
  });

  it("does nothing, and writes no run log, when no channel is due", async () => {
    // the fake ignores `or`; a channel that is in no collectable state (ERROR) never shows up
    const db = setup([channelRow("c1", { status: "ERROR" })]);
    const result = await processDueChannels(NOW, 30_000);
    expect(result).toMatchObject({ processed: 0, failed: 0, skipped: 0 });
    expect(db.tables.channel_collection_runs ?? []).toHaveLength(0);
    expect(youtubeCollectMock).not.toHaveBeenCalled();
  });

  it("two overlapping ticks never collect the same channel twice (compare-and-set claim)", async () => {
    const db = setup([channelRow("c1")]);
    youtubeCollectMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return youtubeResult();
    });
    const [a, b] = await Promise.all([processDueChannels(NOW, 30_000), processDueChannels(NOW, 30_000)]);
    expect(youtubeCollectMock).toHaveBeenCalledTimes(1);
    expect(a.processed + b.processed).toBe(1);
    expect(a.skipped + b.skipped).toBe(1);
    expect(db.tables.tracked_channels[0].next_snapshot_at).toBe(NEXT_6AM);
  });

  it("a broken channel is retried in 30 minutes and never blocks the others; its earlier data is untouched", async () => {
    const db = setup([channelRow("bad", { external_id: "UCbad" }), channelRow("good", { external_id: "UCgood" })]);
    youtubeCollectMock.mockImplementation(async (externalId: string) => {
      if (externalId === "UCbad") throw new YouTubeCollectorError("TIMEOUT", "응답 시간 초과");
      return youtubeResult();
    });

    const result = await processDueChannels(NOW, 30_000);

    expect(result).toMatchObject({ processed: 1, failed: 1, paused: 0 });
    const bad = db.tables.tracked_channels.find((row) => row.id === "bad")!;
    expect(bad).toMatchObject({ consecutive_failure_count: 1, last_collection_status: "FAILED", last_error_code: "TIMEOUT" });
    expect(bad.next_snapshot_at).toBe(new Date(NOW.getTime() + 30 * 60_000).toISOString());
    expect(db.tables.tracked_channels.find((row) => row.id === "good")).toMatchObject({ last_collection_status: "SUCCESS", next_snapshot_at: NEXT_6AM });
    // only the good channel wrote anything
    expect(saveMetricSnapshotMock.mock.calls.every((call) => call[0].channelId === "good")).toBe(true);
    expect(db.tables.channel_collection_runs[0]).toMatchObject({ status: "PARTIAL", channels_failed: 1, channels_succeeded: 1 });
  });

  describe("planFailure: what a failed attempt changes", () => {
    const plan = (overrides: Record<string, unknown>) => planFailure({ kind: "TRANSIENT", failuresBefore: 0, paused: false, now: NOW, ...overrides } as never);

    it("transient: two retries 30 minutes apart, then the next 06:00 KST", () => {
      expect(plan({ failuresBefore: 0 }).nextAt.toISOString()).toBe(new Date(NOW.getTime() + 30 * 60_000).toISOString());
      expect(plan({ failuresBefore: 1 }).nextAt.toISOString()).toBe(new Date(NOW.getTime() + 30 * 60_000).toISOString());
      expect(plan({ failuresBefore: 2 }).nextAt.toISOString()).toBe(NEXT_6AM);
    });

    it("transient: the longer it keeps failing the longer the gap (daily, then every other day, then weekly) and it is never paused", () => {
      expect(plan({ failuresBefore: 5 }).nextAt.toISOString()).toBe(NEXT_6AM); // 6th failure: still daily
      expect(plan({ failuresBefore: 8 }).nextAt.toISOString()).toBe("2026-10-14T21:00:00.000Z"); // 9th: every other day
      expect(plan({ failuresBefore: 14 }).nextAt.toISOString()).toBe("2026-10-19T21:00:00.000Z"); // 15th: weekly
      for (const failuresBefore of [11, 40, 400]) expect(plan({ failuresBefore }).pause).toBe(false);
    });

    it("transient: a Retry-After longer than the retry slot is honoured", () => {
      expect(plan({ failuresBefore: 0, retryAfterMs: 2 * 3_600_000 }).nextAt.toISOString()).toBe(new Date(NOW.getTime() + 2 * 3_600_000).toISOString());
      expect(plan({ failuresBefore: 0, retryAfterMs: 60_000 }).nextAt.toISOString()).toBe(new Date(NOW.getTime() + 30 * 60_000).toISOString());
    });

    it("not found: one attempt a day, paused only after three days in a row", () => {
      expect(plan({ kind: "NOT_FOUND", failuresBefore: 0 })).toMatchObject({ failures: 1, pause: false });
      expect(plan({ kind: "NOT_FOUND", failuresBefore: 0 }).nextAt.toISOString()).toBe(NEXT_6AM);
      expect(plan({ kind: "NOT_FOUND", failuresBefore: 1 }).pause).toBe(false);
      expect(plan({ kind: "NOT_FOUND", failuresBefore: 2 }).pause).toBe(true);
    });

    it("our own configuration problem is not the channel's failure: not counted, looked at again in a few hours", () => {
      expect(plan({ kind: "CONFIG", failuresBefore: 3 })).toMatchObject({ failures: 3, pause: false });
      expect(plan({ kind: "CONFIG", failuresBefore: 3 }).nextAt.toISOString()).toBe(new Date(NOW.getTime() + 6 * 3_600_000).toISOString());
    });

    it("a paused channel stays paused when its probe fails, and is probed again in about a week", () => {
      const probe = plan({ kind: "TRANSIENT", paused: true, failuresBefore: 3 });
      expect(probe.pause).toBe(true);
      expect(probe.nextAt.toISOString()).toBe("2026-10-19T21:00:00.000Z");
    });
  });

  it("a streak of transient failures never pauses the channel: it just backs off", async () => {
    const db = setup([channelRow("c1", { consecutive_failure_count: 30 })]);
    youtubeCollectMock.mockRejectedValue(new YouTubeCollectorError("TIMEOUT", "응답 시간 초과"));
    const result = await processDueChannels(NOW, 30_000);
    expect(result).toMatchObject({ failed: 1, paused: 0 });
    expect(db.tables.tracked_channels[0]).toMatchObject({ status: "ACTIVE", consecutive_failure_count: 31 });
  });

  it("a channel that is gone (404) is retried once a day and paused after the third day", async () => {
    const db = setup([channelRow("c1", { consecutive_failure_count: 2 })]);
    youtubeCollectMock.mockRejectedValue(new YouTubeCollectorError("CHANNEL_NOT_FOUND", "없음"));
    const result = await processDueChannels(NOW, 30_000);
    expect(result).toMatchObject({ failed: 1, paused: 1 });
    expect(db.tables.tracked_channels[0]).toMatchObject({ status: "PAUSED", consecutive_failure_count: 3, last_error_code: "CHANNEL_NOT_FOUND", last_collection_status: "UNAVAILABLE" });
  });

  it("an invalid API key is our problem: the channel is not blamed and keeps its failure count", async () => {
    const db = setup([channelRow("c1", { consecutive_failure_count: 1 })]);
    youtubeCollectMock.mockRejectedValue(new YouTubeCollectorError("INVALID_API_KEY", "키 거부"));
    await processDueChannels(NOW, 30_000);
    expect(db.tables.tracked_channels[0]).toMatchObject({ status: "ACTIVE", consecutive_failure_count: 1, last_error_code: "INVALID_API_KEY" });
    expect(db.tables.tracked_channels[0].next_snapshot_at).toBe(new Date(NOW.getTime() + 6 * 3_600_000).toISOString());
  });

  it("a blog that cannot be reached right now (timeout, 429, 5xx) is a failed attempt with a retry, not 'no data'", async () => {
    const db = setup([channelRow("t1", { platform: "tistory", external_id: "https://myname.tistory.com", url: "https://myname.tistory.com" })]);
    tistoryCollectMock.mockRejectedValue(new FeedTransientError("티스토리 RSS에 지금 연결하지 못했어요 (HTTP 503).", 90 * 60_000));
    const result = await processDueChannels(NOW, 30_000);
    expect(result).toMatchObject({ failed: 1, paused: 0 });
    expect(db.tables.tracked_channels[0]).toMatchObject({ consecutive_failure_count: 1, last_collection_status: "FAILED", last_error_code: "FEED_TRANSIENT" });
    // the source asked for 90 minutes: that is longer than the usual 30-minute retry
    expect(db.tables.tracked_channels[0].next_snapshot_at).toBe(new Date(NOW.getTime() + 90 * 60_000).toISOString());
  });

  it("a paused channel is probed again and resumes by itself once the source answers", async () => {
    const db = setup([channelRow("c1", { status: "PAUSED", consecutive_failure_count: 12, next_snapshot_at: "2026-10-12T20:00:00.000Z" })]);
    youtubeCollectMock.mockResolvedValue(youtubeResult());
    const result = await processDueChannels(NOW, 30_000);
    expect(result).toMatchObject({ processed: 1, failed: 0 });
    expect(db.tables.tracked_channels[0]).toMatchObject({ status: "ACTIVE", consecutive_failure_count: 0, last_collection_status: "SUCCESS", next_snapshot_at: NEXT_6AM });
  });

  it("a paused channel whose probe fails stays paused and waits a week", async () => {
    const db = setup([channelRow("c1", { status: "PAUSED", consecutive_failure_count: 12, next_snapshot_at: "2026-10-12T20:00:00.000Z" })]);
    youtubeCollectMock.mockRejectedValue(new YouTubeCollectorError("TIMEOUT", "응답 시간 초과"));
    const result = await processDueChannels(NOW, 30_000);
    expect(result).toMatchObject({ failed: 1, paused: 0 });
    expect(db.tables.tracked_channels[0]).toMatchObject({ status: "PAUSED" });
    expect(db.tables.tracked_channels[0].next_snapshot_at).toBe("2026-10-19T21:00:00.000Z");
  });

  it("YouTube quota exhausted: it stops calling YouTube, the channel is not blamed, and everything is retried an hour later", async () => {
    const db = setup([channelRow("a", { external_id: "UCa" }), channelRow("b", { external_id: "UCb" }), channelRow("blog", { platform: "tistory", external_id: "blog", url: "https://blog.tistory.com/" })]);
    youtubeCollectMock.mockRejectedValue(new YouTubeCollectorError("QUOTA_EXCEEDED", "쿼터 초과"));
    tistoryCollectMock.mockResolvedValue({ posts: [{ publishedAt: "2026-10-12T00:00:00.000Z", title: "글", url: "https://blog.tistory.com/1" }], observedCapped: false, unavailableReason: null });

    const result = await processDueChannels(NOW, 30_000);

    expect(youtubeCollectMock).toHaveBeenCalledTimes(1); // the second YouTube channel was not even tried
    expect(result).toMatchObject({ quotaExceeded: true, processed: 1, failed: 0, skipped: 2 });
    const hourLater = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    expect(db.tables.tracked_channels.find((row) => row.id === "a")).toMatchObject({ consecutive_failure_count: 0, last_collection_status: "QUOTA_EXCEEDED", next_snapshot_at: hourLater });
    expect(db.tables.tracked_channels.find((row) => row.id === "b")!.next_snapshot_at).toBe(hourLater);
    expect(db.tables.tracked_channels.find((row) => row.id === "blog")).toMatchObject({ last_collection_status: "SUCCESS" }); // blogs are not affected by YouTube's quota
    expect(db.tables.channel_collection_runs[0]).toMatchObject({ quota_exceeded: true });
  });

  it("stops at the time budget and leaves the rest due for the next tick", async () => {
    const db = setup([channelRow("c1"), channelRow("c2", { external_id: "UC2" })]);
    youtubeCollectMock.mockResolvedValue(youtubeResult());
    const result = await processDueChannels(NOW, -1); // already-expired budget
    expect(result).toMatchObject({ processed: 0, skipped: 2 });
    expect(db.tables.tracked_channels.every((row) => row.next_snapshot_at === "2026-10-12T21:00:00.000Z")).toBe(true);
  });

  it("an unreadable blog (no public data) counts as a failed day instead of looking healthy", async () => {
    const db = setup([channelRow("blog", { platform: "tistory", external_id: "blog", url: "https://blog.tistory.com/" })]);
    tistoryCollectMock.mockResolvedValue({ posts: [], observedCapped: false, unavailableReason: "비공개" });
    const result = await processDueChannels(NOW, 30_000);
    expect(result).toMatchObject({ processed: 0, failed: 1 });
    expect(db.tables.tracked_channels[0]).toMatchObject({ consecutive_failure_count: 0, last_collection_status: "UNAVAILABLE", next_snapshot_at: NEXT_6AM });
  });

  it("days without public data do not build the error streak, so one later timeout cannot pause the channel", async () => {
    const db = setup([channelRow("blog", { platform: "tistory", external_id: "blog", url: "https://blog.tistory.com/", consecutive_failure_count: 11 })]);
    tistoryCollectMock.mockResolvedValue({ posts: [], observedCapped: false, unavailableReason: "비공개" });
    await processDueChannels(NOW, 30_000);
    expect(db.tables.tracked_channels[0]).toMatchObject({ status: "ACTIVE", consecutive_failure_count: 0 });

    db.tables.tracked_channels[0].next_snapshot_at = null;
    tistoryCollectMock.mockRejectedValue(new Error("timeout"));
    const result = await processDueChannels(NOW, 30_000);
    expect(result.paused).toBe(0);
    expect(db.tables.tracked_channels[0]).toMatchObject({ status: "ACTIVE", consecutive_failure_count: 1 });
  });

  it("a paused channel resumes daily collection once a user-triggered collection reaches the source", async () => {
    // not due yet (its next probe is in a week), so the daily run leaves it alone
    const db = setup([channelRow("c1", { status: "PAUSED", consecutive_failure_count: 12, next_snapshot_at: "2026-10-19T21:00:00.000Z" })]);
    youtubeCollectMock.mockResolvedValue(youtubeResult());

    await collectAndPersistChannel({ id: "c1", platform: "youtube", external_id: "UCabcdefghijklmnopqrstuv", url: "" }, undefined, NOW);
    expect(db.tables.tracked_channels[0]).toMatchObject({ status: "ACTIVE", consecutive_failure_count: 0, next_snapshot_at: NEXT_6AM });
  });

  it("collecting an active channel does not touch its schedule (the daily run sets next_snapshot_at itself)", async () => {
    const db = setup([channelRow("c1", { next_snapshot_at: "2026-10-12T21:15:00.000Z" })]);
    youtubeCollectMock.mockResolvedValue(youtubeResult());
    await collectAndPersistChannel({ id: "c1", platform: "youtube", external_id: "UCabcdefghijklmnopqrstuv", url: "" }, undefined, NOW);
    expect(db.tables.tracked_channels[0].next_snapshot_at).toBe("2026-10-12T21:15:00.000Z");
  });

  it("admin 'collect now' (all: true) collects channels that are not due yet and logs it as MANUAL_ADMIN", async () => {
    const db = setup([channelRow("c1", { next_snapshot_at: NEXT_6AM })]);
    youtubeCollectMock.mockResolvedValue(youtubeResult());
    // `all` skips the due filter; the fake ignores `or`, so this also proves the claim copes with a future next_snapshot_at
    const result = await processDueChannels(NOW, 30_000, { trigger: "MANUAL_ADMIN", triggeredBy: "admin-1", all: true });
    expect(result.processed).toBe(1);
    expect(db.tables.channel_collection_runs[0]).toMatchObject({ trigger: "MANUAL_ADMIN", triggered_by: "admin-1" });
  });
});
