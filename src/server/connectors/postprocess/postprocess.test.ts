import { describe, expect, it, vi } from "vitest";
import { WorkerPostprocessProvider } from "./worker";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const probe = { durationSec: 25, sizeBytes: 1_000, formatName: "mp4", hasVideo: true, hasAudio: true, width: 720, height: 1280, fps: 30, videoCodec: "h264", audioCodec: "aac" };

function provider(fetchFn: typeof fetch) {
  return new WorkerPostprocessProvider({ baseUrl: "https://worker.example.com/", token: "t".repeat(20), fetchFn });
}

describe("worker client", () => {
  it("sends the bearer token on every call and probes media", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json(probe));
    expect(await provider(fetchFn).probe("https://files.example.com/v.mp4")).toMatchObject({ durationSec: 25, hasAudio: true });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://worker.example.com/v1/probe");
    expect(init.headers.Authorization).toBe(`Bearer ${"t".repeat(20)}`);
    expect(JSON.parse(init.body)).toEqual({ url: "https://files.example.com/v.mp4" });
  });

  it("starts a compose job in the worker's format and reads its result", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json({ jobId: "j1" }, 202))
      .mockResolvedValueOnce(json({ jobId: "j1", state: "running" }))
      .mockResolvedValueOnce(json({ jobId: "j1", state: "done", result: { probe } }));
    const client = provider(fetchFn);
    const handle = await client.startCompose({ videoUrl: "https://a.b/v.mp4", voiceUrl: "https://a.b/v.mp3", audioMode: "mix", overlays: [{ kind: "text", text: "예약", position: "bottom" }], uploadUrl: "https://a.b/up" });
    expect(handle).toEqual({ jobId: "j1" });
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toMatchObject({ type: "compose", audio: { mode: "mix", loudnorm: true }, output: { uploadUrl: "https://a.b/up" } });
    expect(await client.getCompose(handle)).toEqual({ state: "pending" });
    expect(await client.getCompose(handle)).toMatchObject({ state: "done", result: { probe: { durationSec: 25 } } });
  });

  it("reports a failed job, a lost job (worker restarted) and an unreadable result", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json({ jobId: "j", state: "failed", error: "ffmpeg exited with 1" }))
      .mockResolvedValueOnce(json({ error: "unknown job" }, 404))
      .mockResolvedValueOnce(json({ jobId: "j", state: "done", result: { nonsense: true } }));
    const client = provider(fetchFn);
    expect(await client.getAnalysis({ jobId: "j" })).toEqual({ state: "failed", message: "ffmpeg exited with 1" });
    expect(await client.getAnalysis({ jobId: "j" })).toMatchObject({ state: "failed", lost: true });
    expect(await client.getAnalysis({ jobId: "j" })).toMatchObject({ state: "failed" });
  });

  it("classifies transport problems and needs configuration", async () => {
    await expect(provider(vi.fn().mockRejectedValue(new TypeError("fetch failed"))).probe("https://a.b/v.mp4")).rejects.toMatchObject({ code: "NETWORK_FAILURE", retryable: true });
    await expect(provider(vi.fn().mockResolvedValue(json({ error: "unauthorized" }, 401))).probe("https://a.b/v.mp4")).rejects.toMatchObject({ code: "AUTH_FAILED" });
    await expect(new WorkerPostprocessProvider({ baseUrl: "", token: "", fetchFn: vi.fn() }).probe("https://a.b/v.mp4")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
});
