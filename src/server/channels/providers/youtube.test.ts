import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { serverEnvMock } = vi.hoisted(() => ({ serverEnvMock: { YOUTUBE_API_KEY: "test-api-key" as string | undefined } }));
vi.mock("@/lib/env/server", () => ({ serverEnv: serverEnvMock }));

const { YouTubeChannelDataProvider } = await import("./youtube");
const { YouTubeCollectorError } = await import("./youtube-types");

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const CHANNELS_RESPONSE = {
  items: [
    {
      statistics: { subscriberCount: "1200", hiddenSubscriberCount: false, viewCount: "50000", videoCount: "3" },
      contentDetails: { relatedPlaylists: { uploads: "UUplaylist123" } },
    },
  ],
};

const PLAYLIST_ITEMS_RESPONSE = {
  items: [
    { contentDetails: { videoId: "vid1", videoPublishedAt: "2026-10-09T00:00:00.000Z" } },
    { contentDetails: { videoId: "vid2", videoPublishedAt: "2026-09-20T00:00:00.000Z" } },
  ],
};

const VIDEOS_RESPONSE = {
  items: [
    { id: "vid1", statistics: { viewCount: "600" } },
    { id: "vid2", statistics: { viewCount: "400" } },
  ],
};

beforeEach(() => {
  serverEnvMock.YOUTUBE_API_KEY = "test-api-key";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("YouTubeChannelDataProvider.collect", () => {
  it("collects subscriber/view/video counts and recent videos via @handle lookup", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(CHANNELS_RESPONSE))
      .mockResolvedValueOnce(jsonResponse(PLAYLIST_ITEMS_RESPONSE))
      .mockResolvedValueOnce(jsonResponse(VIDEOS_RESPONSE));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new YouTubeChannelDataProvider().collect("@mychannel");

    expect(result).toEqual({
      subscriberCount: 1200,
      hiddenSubscriberCount: false,
      viewCount: 50000,
      videoCount: 3,
      recentVideos: [
        { publishedAt: "2026-10-09T00:00:00.000Z", viewCount: 600 },
        { publishedAt: "2026-09-20T00:00:00.000Z", viewCount: 400 },
      ],
    });

    const firstCallUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(firstCallUrl.pathname).toBe("/youtube/v3/channels");
    expect(firstCallUrl.searchParams.get("forHandle")).toBe("@mychannel");
    expect(firstCallUrl.searchParams.get("id")).toBeNull();
  });

  it("uses the id parameter (not forHandle) for a bare channel id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [{ statistics: { viewCount: "0", videoCount: "0" }, contentDetails: {} }] }));
    vi.stubGlobal("fetch", fetchMock);

    await new YouTubeChannelDataProvider().collect("UCabcdefghijklmnopqrstuv");

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("id")).toBe("UCabcdefghijklmnopqrstuv");
    expect(url.searchParams.get("forHandle")).toBeNull();
  });

  it("returns subscriberCount: null when hiddenSubscriberCount is true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse({ items: [{ statistics: { hiddenSubscriberCount: true, viewCount: "100", videoCount: "0" }, contentDetails: {} }] }),
      ),
    );

    const result = await new YouTubeChannelDataProvider().collect("@hidden");
    expect(result.subscriberCount).toBeNull();
    expect(result.hiddenSubscriberCount).toBe(true);
  });

  it("throws INVALID_API_KEY immediately when YOUTUBE_API_KEY is unset, without calling fetch", async () => {
    serverEnvMock.YOUTUBE_API_KEY = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(new YouTubeChannelDataProvider().collect("@x")).rejects.toMatchObject({
      name: "YouTubeCollectorError",
      code: "INVALID_API_KEY",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws CHANNEL_NOT_FOUND when channels.list returns no items", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ items: [] })));
    await expect(new YouTubeChannelDataProvider().collect("@missing")).rejects.toMatchObject({ code: "CHANNEL_NOT_FOUND" });
  });

  it("throws CHANNEL_NOT_FOUND on an HTTP 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ error: { code: 404, errors: [{ reason: "channelNotFound" }] } }, 404)));
    await expect(new YouTubeChannelDataProvider().collect("@missing")).rejects.toMatchObject({ code: "CHANNEL_NOT_FOUND" });
  });

  it("throws QUOTA_EXCEEDED on a 403 with reason quotaExceeded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(jsonResponse({ error: { code: 403, errors: [{ reason: "quotaExceeded" }] } }, 403)),
    );
    await expect(new YouTubeChannelDataProvider().collect("@x")).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
  });

  it("throws INVALID_API_KEY on a 400/403 that isn't quotaExceeded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ error: { code: 400, errors: [{ reason: "badRequest" }] } }, 400)));
    await expect(new YouTubeChannelDataProvider().collect("@x")).rejects.toMatchObject({ code: "INVALID_API_KEY" });
  });

  it("throws UNKNOWN on an unexpected HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({}, 500)));
    await expect(new YouTubeChannelDataProvider().collect("@x")).rejects.toMatchObject({ code: "UNKNOWN" });
  });

  it("throws TIMEOUT when the request aborts", async () => {
    const abortError = new DOMException("The operation was aborted", "TimeoutError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(abortError));
    await expect(new YouTubeChannelDataProvider().collect("@x")).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("is an instance of YouTubeCollectorError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ items: [] })));
    await expect(new YouTubeChannelDataProvider().collect("@missing")).rejects.toBeInstanceOf(YouTubeCollectorError);
  });
});
