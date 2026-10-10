import { afterEach, describe, expect, it, vi } from "vitest";
import { isConnectorError } from "@/server/shared/errors";
import { Json2VideoRenderProvider } from "./json2video";
import { MockVideoRenderProvider } from "./mock";
import { videoRenderSceneSchema } from "./types";

const movie = { resolution: "custom", width: 1080, height: 1920, scenes: [] };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("video render providers", () => {
  it("returns a deterministic finished MP4 in mock mode without a network request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const provider = new MockVideoRenderProvider();

    const project = await provider.startMovie(movie);
    const status = await provider.getMovieStatus(project);

    expect(status).toMatchObject({ state: "done", videoUrl: expect.stringMatching(/^https:\/\/.*\.mp4$/) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the movie with the API key and returns the project id", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ success: true, project: "project-12345678" }));
    const provider = new Json2VideoRenderProvider({ apiKey: "test-api-key", fetchFn: fetchMock });

    expect(await provider.startMovie(movie)).toBe("project-12345678");

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://api.json2video.com/v2/movies");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "x-api-key": "test-api-key" });
    expect(JSON.parse(String(init.body))).toEqual(movie);
  });

  it("fails before any request when the API key is missing", async () => {
    const fetchMock = vi.fn();
    const provider = new Json2VideoRenderProvider({ apiKey: "", fetchFn: fetchMock });

    const error = await provider.startMovie(movie).catch((caught: unknown) => caught);

    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("NOT_CONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a create response without a project id", async () => {
    const provider = new Json2VideoRenderProvider({ apiKey: "k", fetchFn: vi.fn().mockResolvedValueOnce(jsonResponse({ success: true })) });
    await expect(provider.startMovie(movie)).rejects.toMatchObject({ code: "UPSTREAM_SERVER_ERROR" });
  });

  it("maps pending, running, done, error and timeout states", async () => {
    const statuses = [
      { status: "pending" },
      { status: "running" },
      { status: "done", url: "https://assets.example.com/rendered/short.mp4", width: 1080, height: 1920 },
      { status: "error", message: "bad asset" },
      { status: "timeout", message: "too slow" },
    ];
    const fetchMock = vi.fn();
    for (const movieStatus of statuses) fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, movie: movieStatus }));
    const provider = new Json2VideoRenderProvider({ apiKey: "k", fetchFn: fetchMock });

    expect(await provider.getMovieStatus("p")).toEqual({ state: "pending" });
    expect(await provider.getMovieStatus("p")).toEqual({ state: "pending" });
    expect(await provider.getMovieStatus("p")).toEqual({ state: "done", videoUrl: "https://assets.example.com/rendered/short.mp4" });
    expect(await provider.getMovieStatus("p")).toMatchObject({ state: "failed", message: expect.stringContaining("bad asset") });
    expect(await provider.getMovieStatus("p")).toMatchObject({ state: "failed", message: expect.stringContaining("too slow") });

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.searchParams.get("project")).toBe("p");
  });

  it("rejects non-portrait or non-MP4 results and unknown states", async () => {
    const wide = new Json2VideoRenderProvider({
      apiKey: "k",
      fetchFn: vi.fn().mockResolvedValueOnce(jsonResponse({ success: true, movie: { status: "done", url: "https://assets.example.com/wide.mp4", width: 1920, height: 1080 } })),
    });
    await expect(wide.getMovieStatus("p")).rejects.toMatchObject({ code: "UPSTREAM_SERVER_ERROR" });

    const notMp4 = new Json2VideoRenderProvider({
      apiKey: "k",
      fetchFn: vi.fn().mockResolvedValueOnce(jsonResponse({ success: true, movie: { status: "done", url: "https://assets.example.com/x.gif", width: 1080, height: 1920 } })),
    });
    await expect(notMp4.getMovieStatus("p")).rejects.toMatchObject({ code: "UPSTREAM_SERVER_ERROR" });

    const unknown = new Json2VideoRenderProvider({ apiKey: "k", fetchFn: vi.fn().mockResolvedValueOnce(jsonResponse({ success: true, movie: { status: "weird" } })) });
    await expect(unknown.getMovieStatus("p")).rejects.toMatchObject({ code: "UPSTREAM_SERVER_ERROR" });
  });

  it("classifies HTTP failures", async () => {
    const provider = new Json2VideoRenderProvider({ apiKey: "k", fetchFn: vi.fn().mockResolvedValue(jsonResponse({}, 401)) });
    await expect(provider.startMovie(movie)).rejects.toMatchObject({ code: "AUTH_FAILED" });
    await expect(provider.getMovieStatus("p")).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });
});

describe("videoRenderSceneSchema", () => {
  it("only accepts HTTPS media URLs", () => {
    const scene = { text: "안녕하세요", visualPrompt: "v", durationSec: 3 };
    expect(videoRenderSceneSchema.safeParse({ ...scene, videoUrl: "https://v3.fal.media/a.mp4" }).success).toBe(true);
    expect(videoRenderSceneSchema.safeParse({ ...scene, videoUrl: "http://insecure.example.com/a.mp4" }).success).toBe(false);
    expect(videoRenderSceneSchema.safeParse({ ...scene, imageUrl: "http://insecure.example.com/a.png" }).success).toBe(false);
  });
});
