import { describe, expect, it, vi } from "vitest";
import { FalAnimationProvider, clipBody, musicBody } from "./fal";
import { MockAnimationProvider } from "./mock";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const handle = {
  requestId: "req-1",
  statusUrl: "https://queue.fal.run/fal-ai/kling-video/requests/req-1/status",
  responseUrl: "https://queue.fal.run/fal-ai/kling-video/requests/req-1",
};

describe("FalAnimationProvider", () => {
  it("submits an image + prompt with the key and a 5 second duration", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ request_id: "req-1", status_url: handle.statusUrl, response_url: handle.responseUrl }));
    const provider = new FalAnimationProvider({ apiKey: "fal-key", model: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", fetchFn });

    const result = await provider.startClip({ imageUrl: "https://img.example.com/frame.png", prompt: "The robot waves." });

    expect(result).toEqual(handle);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://queue.fal.run/fal-ai/kling-video/v2.5-turbo/pro/image-to-video");
    expect(init.headers).toMatchObject({ Authorization: "Key fal-key" });
    expect(JSON.parse(String(init.body))).toEqual({ image_url: "https://img.example.com/frame.png", prompt: "The robot waves.", duration: "5" });
  });

  it("maps queue states to pending, then fetches the video URL when completed", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json({ status: "IN_QUEUE" }))
      .mockResolvedValueOnce(json({ status: "IN_PROGRESS" }))
      .mockResolvedValueOnce(json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(json({ video: { url: "https://v3.fal.media/files/clip.mp4" } }));
    const provider = new FalAnimationProvider({ apiKey: "k", fetchFn });

    expect(await provider.getClip(handle)).toEqual({ state: "pending" });
    expect(await provider.getClip(handle)).toEqual({ state: "pending" });
    expect(await provider.getClip(handle)).toEqual({ state: "done", videoUrl: "https://v3.fal.media/files/clip.mp4" });
  });

  it("reports a failed job instead of throwing", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(json({ detail: "content policy violation" }, 422));
    const provider = new FalAnimationProvider({ apiKey: "k", fetchFn });

    expect(await provider.getClip(handle)).toEqual({ state: "failed", message: "content policy violation" });
  });

  it("fails when a finished job has no video URL", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(json({ status: "COMPLETED" })).mockResolvedValueOnce(json({ video: {} }));
    const provider = new FalAnimationProvider({ apiKey: "k", fetchFn });
    expect((await provider.getClip(handle)).state).toBe("failed");
  });

  it("never follows a stored URL that is not on fal's queue host", async () => {
    const fetchFn = vi.fn();
    const provider = new FalAnimationProvider({ apiKey: "k", fetchFn });
    await expect(provider.getClip({ ...handle, statusUrl: "https://evil.example.com/status" })).rejects.toMatchObject({ code: "INVALID_TARGET" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("needs a key and classifies upstream errors", async () => {
    await expect(new FalAnimationProvider({ apiKey: "", fetchFn: vi.fn() }).startClip({ imageUrl: "https://a.example.com/x.png", prompt: "p" }))
      .rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    const provider = new FalAnimationProvider({ apiKey: "k", fetchFn: vi.fn().mockResolvedValue(json({}, 401)) });
    await expect(provider.startClip({ imageUrl: "https://a.example.com/x.png", prompt: "p" })).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });
});

describe("model families and quality tiers", () => {
  it("maps the input names per model family", () => {
    const request = { imageUrl: "https://img.example.com/f.png", prompt: "Slow push-in." };
    expect(clipBody("fal-ai/kling-video/v2.5-turbo/pro/image-to-video", request)).toEqual({ image_url: request.imageUrl, prompt: request.prompt, duration: "5" });
    expect(clipBody("fal-ai/kling-video/v3/pro/image-to-video", request)).toEqual({ start_image_url: request.imageUrl, prompt: request.prompt, duration: "5", generate_audio: false });
  });

  it("uses the premium model only when asked, and the standard one otherwise", async () => {
    const fetchFn = vi.fn().mockImplementation(async () => json({ request_id: "r", status_url: handle.statusUrl, response_url: handle.responseUrl }));
    const provider = new FalAnimationProvider({ apiKey: "k", model: "fal-ai/standard/image-to-video", premiumModel: "fal-ai/kling-video/v3/pro/image-to-video", fetchFn });

    await provider.startClip({ imageUrl: "https://img.example.com/a.png", prompt: "p" });
    await provider.startClip({ imageUrl: "https://img.example.com/a.png", prompt: "p" }, { quality: "premium" });
    await provider.startClip({ imageUrl: "https://img.example.com/a.png", prompt: "p" }, { quality: "standard" });

    const calls = fetchFn.mock.calls.map((call) => [call[0], JSON.parse(String((call[1] as RequestInit).body))] as [string, Record<string, unknown>]);
    expect(calls[0][0]).toBe("https://queue.fal.run/fal-ai/standard/image-to-video");
    expect(calls[0][1]).toHaveProperty("image_url");
    expect(calls[1][0]).toBe("https://queue.fal.run/fal-ai/kling-video/v3/pro/image-to-video");
    expect(calls[1][1]).toHaveProperty("start_image_url");
    expect(calls[2][0]).toBe("https://queue.fal.run/fal-ai/standard/image-to-video");
  });
});

describe("background music", () => {
  it("submits an instrumental prompt (no vocals) to the music model", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ request_id: "m1", status_url: handle.statusUrl, response_url: handle.responseUrl }));
    const provider = new FalAnimationProvider({ apiKey: "k", fetchFn });

    await provider.startMusic({ prompt: "Warm, upbeat acoustic pop with a light beat." });

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://queue.fal.run/fal-ai/lyria2");
    const body = JSON.parse(String(init.body)) as { prompt: string; negative_prompt: string };
    expect(body.prompt).toContain("acoustic pop");
    expect(body.negative_prompt).toContain("vocals");
    expect(musicBody("fal-ai/minimax-music/v2.6", { prompt: "x" })).toEqual({ prompt: "x", is_instrumental: true });
  });

  it("returns the audio URL once the track is done, and reports failures instead of throwing", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json({ status: "IN_PROGRESS" }))
      .mockResolvedValueOnce(json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(json({ audio: { url: "https://v3.fal.media/files/track.wav" } }))
      .mockResolvedValueOnce(json({ status: "COMPLETED" }))
      .mockResolvedValueOnce(json({ audio: {} }));
    const provider = new FalAnimationProvider({ apiKey: "k", fetchFn });

    expect(await provider.getMusic(handle)).toEqual({ state: "pending" });
    expect(await provider.getMusic(handle)).toEqual({ state: "done", audioUrl: "https://v3.fal.media/files/track.wav" });
    expect((await provider.getMusic(handle)).state).toBe("failed");
  });
});

describe("isAnimationAvailable", () => {
  it("is false for the mock next to a real renderer (its fake clip URLs would break the render) and for fal without a key", async () => {
    const check = async (env: Record<string, string | undefined>) => {
      vi.resetModules();
      vi.doMock("@/lib/env/server", () => ({ serverEnv: env }));
      return (await import("./index")).isAnimationAvailable();
    };
    expect(await check({ ANIMATION_PROVIDER: "mock", VIDEO_RENDER_PROVIDER: "mock" })).toBe(true);
    expect(await check({ ANIMATION_PROVIDER: "mock", VIDEO_RENDER_PROVIDER: "json2video" })).toBe(false);
    expect(await check({ ANIMATION_PROVIDER: "fal", VIDEO_RENDER_PROVIDER: "json2video" })).toBe(false);
    expect(await check({ ANIMATION_PROVIDER: "fal", FAL_KEY: "k", VIDEO_RENDER_PROVIDER: "json2video" })).toBe(true);
    vi.doUnmock("@/lib/env/server");
  });
});

describe("MockAnimationProvider", () => {
  it("returns a done clip without touching the network", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const provider = new MockAnimationProvider();
    const clip = await provider.startClip({ imageUrl: "https://a.example.com/x.png", prompt: "p" });
    expect(await provider.getClip(clip)).toMatchObject({ state: "done", videoUrl: expect.stringMatching(/^https:\/\/.*\.mp4$/) });
    const music = await provider.startMusic({ prompt: "calm" });
    expect(await provider.getMusic(music)).toMatchObject({ state: "done", audioUrl: expect.stringMatching(/^https:\/\/.*\.mp3$/) });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
