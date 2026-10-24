import { describe, expect, it, vi } from "vitest";
import { buildWanInput, FalWanProvider } from "./fal";
import { MockWanProvider } from "./mock";
import type { WanRequest } from "./types";

const request: WanRequest = {
  prompt: "Image 1 is the product.",
  durationSec: 25,
  resolution: "720p",
  imageUrls: ["https://files.example.com/a.png"],
  videoUrls: [],
  audioUrls: [],
  thinking: true,
  promptExpansion: true,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Wan 3.0 request body", () => {
  it("sends resolution, duration and aspect ratio explicitly, with audio, expansion, thinking and the safety checker", () => {
    expect(buildWanInput(request)).toEqual({
      prompt: "Image 1 is the product.",
      resolution: "720p",
      aspect_ratio: "9:16",
      duration: 25,
      audio: true,
      enable_prompt_expansion: true,
      enable_thinking: true,
      enable_safety_checker: true,
      reference_image_urls: ["https://files.example.com/a.png"],
    });
  });

  it("adds reference videos and audio only when there are some", () => {
    const body = buildWanInput({ ...request, videoUrls: ["https://files.example.com/v.mp4"], audioUrls: ["https://files.example.com/m.mp3"], seed: 7 });
    expect(body).toMatchObject({ reference_video_urls: ["https://files.example.com/v.mp4"], reference_audio_urls: ["https://files.example.com/m.mp3"], seed: 7 });
    expect(buildWanInput({ ...request, imageUrls: [] })).not.toHaveProperty("reference_image_urls");
  });

  it("refuses requests that break an official limit before anything is sent", () => {
    for (const durationSec of [19, 31, 25.5, 5]) expect(() => buildWanInput({ ...request, durationSec })).toThrow("20~30초");
    for (const durationSec of [20, 25, 30]) expect(() => buildWanInput({ ...request, durationSec })).not.toThrow();
    expect(() => buildWanInput({ ...request, imageUrls: Array(11).fill("https://a.b/c.png") })).toThrow("10장");
    expect(() => buildWanInput({ ...request, videoUrls: Array(6).fill("https://a.b/c.mp4") })).toThrow("5개");
    expect(() => buildWanInput({ ...request, audioUrls: Array(6).fill("https://a.b/c.mp3") })).toThrow("5개");
    expect(() => buildWanInput({ ...request, imageUrls: ["http://a.b/c.png"] })).toThrow("HTTPS");
  });
});

describe("fal queue", () => {
  const handle = { requestId: "r1", statusUrl: "https://queue.fal.run/alibaba/wan-3.0/requests/r1/status", responseUrl: "https://queue.fal.run/alibaba/wan-3.0/requests/r1" };

  it("submits to the Wan endpoint with the key and returns a handle", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ request_id: "r1", status_url: handle.statusUrl, response_url: handle.responseUrl }));
    const provider = new FalWanProvider({ apiKey: "k", fetchFn });
    expect(await provider.submit(request)).toEqual(handle);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://queue.fal.run/alibaba/wan-3.0/reference-to-video");
    expect(init.headers.Authorization).toBe("Key k");
    expect(JSON.parse(init.body)).toMatchObject({ resolution: "720p", duration: 25, aspect_ratio: "9:16" });
  });

  it("reports queued and running jobs as pending", async () => {
    const provider = new FalWanProvider({ apiKey: "k", fetchFn: vi.fn().mockResolvedValueOnce(json({ status: "IN_QUEUE", queue_position: 2 })).mockResolvedValueOnce(json({ status: "IN_PROGRESS" })) });
    expect(await provider.status(handle)).toEqual({ state: "pending", queuePosition: 2 });
    expect(await provider.status(handle)).toEqual({ state: "pending" });
  });

  it("fetches the result once the job is completed", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(json({ video: { url: "https://v3.fal.media/out.mp4", width: 720, height: 1280 }, seed: 5, duration: 25, actual_prompt: "expanded" }));
    const provider = new FalWanProvider({ apiKey: "k", fetchFn });
    expect(await provider.status(handle)).toEqual({ state: "done", videoUrl: "https://v3.fal.media/out.mp4", durationSec: 25, width: 720, height: 1280, seed: 5, actualPrompt: "expanded" });
  });

  it("reads a value fal sends as null (seed, actual_prompt, duration) as not given, never as null", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(json({ video: { url: "https://v3.fal.media/out.mp4", width: null, height: 1280, duration: null }, seed: null, duration: null, actual_prompt: null }));
    const status = await new FalWanProvider({ apiKey: "k", fetchFn }).status(handle);
    expect(status).toMatchObject({ state: "done", videoUrl: "https://v3.fal.media/out.mp4", height: 1280 });
    expect(status).toEqual({ state: "done", videoUrl: "https://v3.fal.media/out.mp4", height: 1280 });
    for (const key of ["seed", "actualPrompt", "durationSec", "width"]) expect(status).not.toHaveProperty(key, null);
  });

  it("turns failed and malformed jobs into a failed status, and transport problems into retryable errors", async () => {
    const failed = new FalWanProvider({ apiKey: "k", fetchFn: vi.fn().mockResolvedValueOnce(json({ status: "COMPLETED", error: "content policy" })) });
    expect(await failed.status(handle)).toEqual({ state: "failed", message: "content policy" });
    const noVideo = new FalWanProvider({ apiKey: "k", fetchFn: vi.fn().mockResolvedValueOnce(json({ status: "COMPLETED" })).mockResolvedValueOnce(json({})) });
    expect(await noVideo.status(handle)).toMatchObject({ state: "failed" });
    const down = new FalWanProvider({ apiKey: "k", fetchFn: vi.fn().mockRejectedValue(new TypeError("fetch failed")) });
    await expect(down.status(handle)).rejects.toMatchObject({ code: "NETWORK_FAILURE", retryable: true });
    const serverError = new FalWanProvider({ apiKey: "k", fetchFn: vi.fn().mockResolvedValue(json({}, 503)) });
    await expect(serverError.status(handle)).rejects.toMatchObject({ code: "UPSTREAM_SERVER_ERROR", retryable: true });
  });

  it("classifies a rejected submit and never follows a foreign status url", async () => {
    const rejected = new FalWanProvider({ apiKey: "k", fetchFn: vi.fn().mockResolvedValue(json({ detail: "bad input" }, 422)) });
    await expect(rejected.submit(request)).rejects.toMatchObject({ code: "UPSTREAM_CLIENT_ERROR", retryable: false });
    const fetchFn = vi.fn();
    const provider = new FalWanProvider({ apiKey: "k", fetchFn });
    await expect(provider.status({ ...handle, statusUrl: "https://evil.example.com/status" })).rejects.toMatchObject({ code: "INVALID_TARGET" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("needs a key", async () => {
    await expect(new FalWanProvider({ apiKey: "", fetchFn: vi.fn() }).submit(request)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
});

describe("mock provider", () => {
  it("answers without a network and remembers what it was asked", async () => {
    const mock = new MockWanProvider();
    const handle = await mock.submit({ ...request, durationSec: 30 });
    expect(await mock.status(handle)).toMatchObject({ state: "done", durationSec: 30, videoUrl: expect.stringContaining(".invalid/") });
    expect(mock.submitted).toHaveLength(1);
  });
});
