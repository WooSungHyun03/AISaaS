import { afterEach, describe, expect, it, vi } from "vitest";
import { isConnectorError } from "@/server/shared/errors";

vi.mock("@/lib/env/server", () => ({
  serverEnv: {
    YOUTUBE_CLIENT_ID: undefined,
    YOUTUBE_CLIENT_SECRET: undefined,
    YOUTUBE_REFRESH_TOKEN: undefined,
  },
}));

const { YouTubeConnector } = await import("./index");

const CONNECTION = {
  clientId: "youtube-client-id",
  clientSecret: "youtube-client-secret",
  refreshToken: "youtube-refresh-token",
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

function videoResponse(): Response {
  const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]);
  return new Response(bytes, {
    status: 200,
    headers: { "Content-Type": "video/mp4", "Content-Length": String(bytes.byteLength) },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("YouTubeConnector", () => {
  it("uploads a rendered MP4 through videos.insert with privacy fixed to private", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(videoResponse())
      .mockResolvedValueOnce(jsonResponse({ access_token: "fresh-access-token", expires_in: 3600 }))
      .mockResolvedValueOnce(new Response(null, {
        status: 200,
        headers: { Location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=upload-1" },
      }))
      .mockResolvedValueOnce(jsonResponse({ id: "youtube-video-1", status: { privacyStatus: "private" } }));
    const connector = new YouTubeConnector(CONNECTION, { fetchFn: fetchMock });

    const result = await connector.publish({
      title: "오늘의 마케팅 Shorts",
      content: "영상 설명과 #해시태그",
      videoUrl: "https://assets.example.com/rendered/short.mp4",
    });

    expect(result).toEqual({
      externalId: "youtube-video-1",
      externalUrl: "https://www.youtube.com/watch?v=youtube-video-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const tokenBody = fetchMock.mock.calls[1][1]?.body as URLSearchParams;
    expect(tokenBody.get("grant_type")).toBe("refresh_token");
    expect(tokenBody.get("refresh_token")).toBe("youtube-refresh-token");

    const insertUrl = new URL(String(fetchMock.mock.calls[2][0]));
    expect(insertUrl.pathname).toBe("/upload/youtube/v3/videos");
    expect(insertUrl.searchParams.get("uploadType")).toBe("resumable");
    expect(insertUrl.searchParams.get("part")).toBe("snippet,status");
    const metadata = JSON.parse(String(fetchMock.mock.calls[2][1]?.body)) as {
      snippet: { title: string; description: string };
      status: { privacyStatus: string; selfDeclaredMadeForKids: boolean };
    };
    expect(metadata).toEqual({
      snippet: {
        title: "오늘의 마케팅 Shorts",
        description: "영상 설명과 #해시태그",
        categoryId: "22",
      },
      status: { privacyStatus: "private", selfDeclaredMadeForKids: false },
    });

    const uploadInit = fetchMock.mock.calls[3][1] as RequestInit;
    expect(uploadInit.method).toBe("PUT");
    expect(uploadInit.headers).toMatchObject({ "Content-Type": "video/mp4" });
  });

  it("rejects a missing video URL before making a network request", async () => {
    const fetchMock = vi.fn();
    const connector = new YouTubeConnector(CONNECTION, { fetchFn: fetchMock });

    const error = await connector.publish({ content: "caption" }).catch((caught: unknown) => caught);

    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("INVALID_TARGET");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails as NOT_CONFIGURED without env credentials", async () => {
    const fetchMock = vi.fn();
    const connector = new YouTubeConnector(undefined, { fetchFn: fetchMock });

    const error = await connector.publish({ content: "caption", videoUrl: "https://assets.example.com/a.mp4" })
      .catch((caught: unknown) => caught);

    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("NOT_CONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-MP4 response before creating an upload session", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("not a video", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    }));
    const connector = new YouTubeConnector(CONNECTION, { fetchFn: fetchMock });

    const error = await connector.publish({ content: "caption", videoUrl: "https://assets.example.com/a.mp4" })
      .catch((caught: unknown) => caught);

    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("INVALID_TARGET");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies a rejected refresh token as AUTH_FAILED", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(videoResponse())
      .mockResolvedValueOnce(jsonResponse({ error: "invalid_grant" }, { status: 400 }));
    const connector = new YouTubeConnector(CONNECTION, { fetchFn: fetchMock });

    const error = await connector.publish({ content: "caption", videoUrl: "https://assets.example.com/a.mp4" })
      .catch((caught: unknown) => caught);

    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("AUTH_FAILED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("classifies a video upload network failure without returning partial success", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(videoResponse())
      .mockResolvedValueOnce(jsonResponse({ access_token: "fresh-access-token" }))
      .mockResolvedValueOnce(new Response(null, {
        status: 200,
        headers: { Location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=upload-1" },
      }))
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    const connector = new YouTubeConnector(CONNECTION, { fetchFn: fetchMock });

    const error = await connector.publish({ content: "caption", videoUrl: "https://assets.example.com/a.mp4" })
      .catch((caught: unknown) => caught);

    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("NETWORK_FAILURE");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
