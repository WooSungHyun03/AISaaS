import { describe, expect, it, vi } from "vitest";
import { FalAnimationProvider } from "./fal";
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

describe("MockAnimationProvider", () => {
  it("returns a done clip without touching the network", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const provider = new MockAnimationProvider();
    const clip = await provider.startClip({ imageUrl: "https://a.example.com/x.png", prompt: "p" });
    expect(await provider.getClip(clip)).toMatchObject({ state: "done", videoUrl: expect.stringMatching(/^https:\/\/.*\.mp4$/) });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
