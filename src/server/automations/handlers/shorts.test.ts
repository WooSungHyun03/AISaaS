import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Automation, Business } from "@/types/domain";
import type { AutomationHandlerResult, AutomationRunContext } from "@/types/automation";
import type { VideoAnalysis } from "@/server/connectors/postprocess/types";
import type { WanRequest, WanStatus } from "@/server/connectors/wan/types";
import { BudgetError } from "@/server/budget/errors";
import { ConnectorError } from "@/server/shared/errors";

/** Every collaborator is a controllable fake; the AI is the real mock provider, so prompts and schemas are exercised for real. */
const m = vi.hoisted(() => ({
  reserve: vi.fn(),
  settle: vi.fn(),
  release: vi.fn(),
  spend: vi.fn(),
  paidCallsAllowed: vi.fn(),
  real: { value: true },
  wanSubmit: vi.fn(),
  wanStatus: vi.fn(),
  startAnalyze: vi.fn(),
  getAnalysis: vi.fn(),
  startCompose: vi.fn(),
  getCompose: vi.fn(),
  tts: vi.fn(),
  uploads: [] as Array<{ bucket: string; path: string }>,
  aiRequests: [] as Array<{ purpose?: string; role?: string; prompt: string }>,
  aiFail: { purpose: "" },
  aiCalled: vi.fn(),
}));

vi.mock("@/server/ai/generate", () => ({
  generateStructured: async (request: { schema: { parse(value: unknown): unknown }; prompt: string; system?: string; purpose?: string; role?: string }) => {
    m.aiCalled(request.purpose);
    m.aiRequests.push({ purpose: request.purpose, role: request.role, prompt: request.prompt });
    if (m.aiFail.purpose && request.purpose === m.aiFail.purpose) throw new Error(`${request.purpose} failed`);
    const { MockAIProvider } = await import("@/server/ai/providers/mock");
    const { text } = await new MockAIProvider().generateText({ prompt: request.prompt, system: request.system });
    return request.schema.parse(JSON.parse(text));
  },
}));
vi.mock("@/server/budget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/budget")>()),
  reserveSpend: m.reserve,
  settleSpend: m.settle,
  releaseSpend: m.release,
  summarizeRunSpend: m.spend,
  assertPaidCallsAllowed: m.paidCallsAllowed,
  runPaidCall: async (call: { run: () => Promise<{ value: unknown }>; reserveUsd: number; step: string }) => {
    await m.reserve({ step: call.step, usd: call.reserveUsd });
    return (await call.run()).value;
  },
  withBudgetScope: (_scope: unknown, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/server/connectors/wan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/connectors/wan")>()),
  getWanProvider: () => ({ name: m.real.value ? "fal" : "mock", submit: m.wanSubmit, status: m.wanStatus }),
  isRealVideoGeneration: () => m.real.value,
}));
vi.mock("@/server/connectors/postprocess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/connectors/postprocess")>()),
  getPostprocessProvider: () => ({ name: "worker", probe: vi.fn(), startAnalyze: m.startAnalyze, getAnalysis: m.getAnalysis, startCompose: m.startCompose, getCompose: m.getCompose }),
}));
vi.mock("@/server/connectors/tts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/connectors/tts")>()),
  getTtsProvider: () => ({ name: "elevenlabs", synthesize: m.tts }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `https://project.supabase.co/upload/${bucket}/${path}`, token: "t", path }, error: null }),
        upload: async (path: string) => {
          m.uploads.push({ bucket, path });
          return { error: null };
        },
      }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { config: {} } }), maybeSingle: async () => ({ data: null }) }) }),
      update: () => ({ eq: async () => ({}) }),
    }),
  }),
}));
vi.mock("@/server/shorts/assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/shorts/assets")>()),
  ensureShortsBuckets: async () => undefined,
  loadImageBytes: async () => new Uint8Array([1, 2, 3]),
  signAsset: async (_admin: unknown, bucket: string, path: string) => `https://project.supabase.co/sign/${bucket}/${path}?t=1`,
  resolveAssetUrls: async (_admin: unknown, assets: Array<{ source: string }>) => assets.map((asset) => `https://project.supabase.co/sign/${asset.source}?t=1`),
}));
vi.mock("@/server/shorts/image-analysis", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/shorts/image-analysis")>()),
  prepareVisionImage: async () => ({ mediaType: "image/jpeg" as const, base64: "AAAA" }),
}));

const { shortsAutomationHandler: handler } = await import("./shorts");

const business: Business = {
  id: "biz-1",
  owner_id: "user-1",
  name: "우리동네 빵집",
  industry: "베이커리",
  description: null,
  location: "서울 마포구",
  target_customer: null,
  brand_tone: "친근하고 따뜻한",
  keywords: ["소금빵", "크루아상"],
  website: null,
  sns_links: {},
  main_offering: "소금빵",
  strengths: null,
  marketing_goal: null,
  promotion_type: "STORE",
  promotion_details: {},
  public_widget_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};
const automation = { id: "auto-1", user_id: "user-1", business_id: "biz-1", template_id: "t", name: "숏폼", status: "ACTIVE", schedule: {}, config: {}, last_run_at: null, next_run_at: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" } as unknown as Automation;

const image = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "image", origin: "upload", source: `user-1/auto-1/assets/${id}.png`, label: `상품 사진 ${id}`, ...extra });
function context(config: Record<string, unknown> = {}, extra: Partial<AutomationRunContext> = {}): AutomationRunContext {
  return {
    automation,
    business,
    config: { assets: [image("a"), image("b")], durationSec: 25, voiceMode: "native", ...config } as never,
    recentTopics: [],
    runId: "run-1",
    shorts: { previewOnly: true },
    checkpoint: vi.fn().mockResolvedValue(undefined),
    ...extra,
  };
}

const probe = { durationSec: 25, sizeBytes: 4_000_000, formatName: "mp4", hasVideo: true, hasAudio: true, width: 720, height: 1280, fps: 30, videoCodec: "h264", audioCodec: "aac" };
function analysisOf(over: Partial<VideoAnalysis> = {}): VideoAnalysis {
  return { probe, black: { seconds: 0, spans: [] }, frozen: { seconds: 0, spans: [] }, audio: { meanVolumeDb: -20, maxVolumeDb: -3, silentSeconds: 0, silentRatio: 0, clippedSamples: 0 }, frames: [{ atSec: 3, base64: "AAAA" }, { atSec: 10, base64: "BBBB" }], ...over };
}
const done = (over: Partial<Extract<WanStatus, { state: "done" }>> = {}): WanStatus => ({ state: "done", videoUrl: "https://v3.fal.media/files/out.mp4", durationSec: 25, width: 720, height: 1280, seed: 9, actualPrompt: "No text or subtitles. Keep the product exactly the same. Do not invent screens. No distorted hands, no flicker.", ...over });

type Outcome = Awaited<ReturnType<NonNullable<typeof handler.resume>>>;
type Deferred = { deferred: { state: Record<string, unknown>; progress?: string } };
const isDeferred = (outcome: unknown): outcome is Deferred => Boolean(outcome && typeof outcome === "object" && "deferred" in outcome);

/** Drives the run like the runner: run, then resume until a result (or an error) comes out. */
async function drive(ctx: AutomationRunContext, onStep?: (outcome: Deferred) => void): Promise<AutomationHandlerResult> {
  let outcome: Outcome = await handler.run(ctx);
  for (let step = 0; step < 60; step++) {
    if (!isDeferred(outcome)) return outcome as AutomationHandlerResult;
    onStep?.(outcome);
    outcome = await handler.resume!(ctx, outcome.deferred.state as never);
  }
  throw new Error("shorts run did not finish");
}

beforeEach(() => {
  vi.resetAllMocks();
  m.uploads.length = 0;
  m.aiRequests.length = 0;
  m.aiFail.purpose = "";
  m.real.value = true;
  m.reserve.mockImplementation(async (input: { usd: number }) => ({ id: `res-${m.reserve.mock.calls.length}`, usd: input.usd }));
  m.settle.mockResolvedValue(undefined);
  m.release.mockResolvedValue(undefined);
  m.spend.mockResolvedValue({ totalUsd: 4.1, steps: [{ step: "video.generate", usd: 3.75 }] });
  m.wanSubmit.mockResolvedValue({ requestId: "r1", statusUrl: "https://queue.fal.run/x/requests/r1/status", responseUrl: "https://queue.fal.run/x/requests/r1" });
  m.wanStatus.mockResolvedValue(done());
  m.startAnalyze.mockResolvedValue({ jobId: "an-1" });
  m.getAnalysis.mockResolvedValue({ state: "done", result: analysisOf() });
  m.startCompose.mockResolvedValue({ jobId: "co-1" });
  m.getCompose.mockResolvedValue({ state: "done", result: { probe } });
  m.tts.mockResolvedValue({ audio: new Uint8Array(5_000), characters: 90 });
});

const generateReservations = () => m.reserve.mock.calls.map((call) => call[0]).filter((input) => input.step === "video.generate");

describe("ad Shorts pipeline", () => {
  it("plans, generates with Wan 3.0 at 720p / 9:16 / 25 s, checks, finishes and returns a video that still needs a human look", async () => {
    const steps: string[] = [];
    const result = await drive(context(), (step) => steps.push(String(step.deferred.state.stage)));

    expect(steps).toEqual(["SUBMIT", "WAIT", "CHECK", "CHECK", "FINISH", "FINISH"]);
    const request = m.wanSubmit.mock.calls[0][0] as WanRequest;
    expect(request).toMatchObject({ durationSec: 25, resolution: "720p", thinking: true, promptExpansion: true });
    expect(request.imageUrls).toHaveLength(2);
    expect(request.prompt).toContain("Vertical 9:16");
    expect(request.prompt).toContain("Rules:");

    const output = result.output as Record<string, unknown>;
    expect(result.contentType).toBe("shorts");
    expect(output).toMatchObject({ format: "ad", durationSec: 25, videoPath: "user-1/auto-1/run-1/final.mp4", qa: { status: "NEEDS_HUMAN_CHECK" } });
    expect(String(output.videoUrl)).toContain("/sign/shorts-videos/user-1/auto-1/run-1/final.mp4");
    expect(JSON.stringify(output)).not.toContain("APPROVED");
    expect(output.generation).toMatchObject({ pipeline: "wan3-v1", model: "alibaba/wan-3.0/reference-to-video", resolution: "720p", costUsd: 4.1 });
    expect(output.publishing).toBeTruthy();
    expect(result.externalApiCallCount).toBe(1);
  });

  it("reserves the generation BEFORE planning, at 720p price x thinking safety margin, and settles it when the video is ready", async () => {
    await drive(context());
    expect(generateReservations()).toHaveLength(1);
    expect(generateReservations()[0]).toMatchObject({ kind: "VIDEO", runId: "run-1", attempt: 1, provider: "fal", usd: 3.75, idempotencyKey: "run-1:wan:1" });
    // Reserved first: the ledger call precedes the first AI call of the run.
    expect(m.reserve.mock.invocationCallOrder[0]).toBeLessThan(m.aiCalled.mock.invocationCallOrder[0]);
    expect(m.settle).toHaveBeenCalledWith("res-1", 3.75, expect.objectContaining({ note: "generation finished" }));
    expect(m.release).not.toHaveBeenCalled();
  });

  it.each([
    [20, 0, 3],
    [25, 0, 3.75],
    [30, 0, 4.5],
    [25, 15, 6],
    [30, 15, 6.75],
  ])("reserves %i s with %i s of reference video at $%d", async (durationSec, videoSeconds, usd) => {
    const config = { durationSec, assets: [image("a"), ...(videoSeconds ? [{ id: "v", kind: "video", origin: "upload", source: "user-1/auto-1/assets/v.mp4", label: "참고", durationSec: videoSeconds, fps: 30 }] : [])] };
    await handler.run(context(config));
    expect(generateReservations()[0].usd).toBeCloseTo(usd, 6);
  });

  it("refuses to start when the budget has no room, before any planning is paid for", async () => {
    m.reserve.mockRejectedValue(new BudgetError("BUDGET_CAP_EXCEEDED", "cap"));
    await expect(handler.run(context())).rejects.toMatchObject({ code: "BUDGET_CAP_EXCEEDED" });
    expect(m.aiRequests).toHaveLength(0);
    expect(m.wanSubmit).not.toHaveBeenCalled();
  });

  it("releases the reservation when planning fails (nothing was sent to the video service)", async () => {
    m.aiFail.purpose = "video.plan";
    await expect(handler.run(context())).rejects.toThrow("video.plan failed");
    expect(m.release).toHaveBeenCalledWith("res-1", expect.any(String));
    expect(m.wanSubmit).not.toHaveBeenCalled();
  });

  it("needs a photo or a reference video, and checks that before anything is reserved", async () => {
    await expect(handler.run(context({ assets: [] }))).rejects.toThrow("사진이나 참고 영상");
    expect(m.reserve).not.toHaveBeenCalled();
  });

  it("saves the job id before the step ends, and never submits twice when resumed from a saved WAIT state", async () => {
    const ctx = context();
    const started = (await handler.run(ctx)) as Deferred;
    const submitted = (await handler.resume!(ctx, started.deferred.state as never)) as Deferred;
    expect(ctx.checkpoint).toHaveBeenCalledWith(expect.objectContaining({ stage: "WAIT", wan: expect.objectContaining({ requestId: "r1" }) }));
    expect(m.wanSubmit).toHaveBeenCalledTimes(1);

    // The process died after the checkpoint: the next step starts from the saved state and only polls.
    m.wanStatus.mockResolvedValueOnce({ state: "pending" });
    const polling = (await handler.resume!(ctx, submitted.deferred.state as never)) as Deferred;
    expect(polling.deferred.state.stage).toBe("WAIT");
    expect(m.wanSubmit).toHaveBeenCalledTimes(1);
    expect(generateReservations()).toHaveLength(1);
  });

  it("gives up on a generation that never finishes and keeps it booked as spent", async () => {
    const ctx = context();
    const started = (await handler.run(ctx)) as Deferred;
    const submitted = (await handler.resume!(ctx, started.deferred.state as never)) as Deferred;
    m.wanStatus.mockResolvedValue({ state: "pending" });
    const old = { ...submitted.deferred.state, wanSubmittedAt: new Date(Date.now() - 31 * 60_000).toISOString() };
    const retry = (await handler.resume!(ctx, old as never)) as Deferred;
    expect(m.settle).toHaveBeenCalledWith("res-1", 3.75, expect.objectContaining({ note: "generation timed out" }));
    expect(retry.deferred.state).toMatchObject({ stage: "SUBMIT", attempt: 2 });
  });

  describe("failed generations", () => {
    it("books a failed job as spent (it may be billed) and tries once more on a new reservation", async () => {
      m.wanStatus.mockResolvedValueOnce({ state: "failed", message: "content policy" }).mockResolvedValue(done());
      const result = await drive(context());
      expect(generateReservations().map((input) => input.attempt)).toEqual([1, 2]);
      expect(m.settle).toHaveBeenCalledWith("res-1", 3.75, expect.objectContaining({ note: expect.stringContaining("content policy") }));
      expect((result.output as { generation: { attempts: Array<{ outcome: string }> } }).generation.attempts.map((item) => item.outcome)).toEqual(["failed", "accepted"]);
      expect(m.wanSubmit).toHaveBeenCalledTimes(2);
    });

    it("stops after the second failure: no third generation, nothing more reserved", async () => {
      m.wanStatus.mockResolvedValue({ state: "failed", message: "boom" });
      await expect(drive(context())).rejects.toThrow("영상을 만들지 못했어요");
      expect(m.wanSubmit).toHaveBeenCalledTimes(2);
      expect(generateReservations()).toHaveLength(2);
    });

    it("does not pay for a regeneration the budget cannot afford: the run ends with the budget's own message", async () => {
      m.wanStatus.mockResolvedValue({ state: "failed", message: "boom" });
      m.reserve.mockImplementation(async (input: { usd: number; attempt?: number }) => {
        if (input.attempt === 2) throw new BudgetError("BUDGET_ITEM_CAP_EXCEEDED", "item cap");
        return { id: "res-1", usd: input.usd };
      });
      await expect(drive(context())).rejects.toMatchObject({ code: "BUDGET_ITEM_CAP_EXCEEDED" });
      expect(m.wanSubmit).toHaveBeenCalledTimes(1);
    });

    it("releases the reservation when fal rejects the request outright (nothing was queued)", async () => {
      m.wanSubmit.mockRejectedValue(new ConnectorError("fal", "UPSTREAM_CLIENT_ERROR", "HTTP 422"));
      await expect(drive(context())).rejects.toMatchObject({ code: "UPSTREAM_CLIENT_ERROR" });
      expect(m.release).toHaveBeenCalledWith("res-1", "submit rejected");
      expect(m.settle).not.toHaveBeenCalled();
      expect(m.wanSubmit).toHaveBeenCalledTimes(1);
    });

    it("releases (does not book) the reservation when the request cannot even be prepared, e.g. a file address cannot be signed", async () => {
      const assets = await import("@/server/shorts/assets");
      const spy = vi.spyOn(assets, "resolveAssetUrls").mockRejectedValueOnce(new Error("storage unreachable"));
      try {
        await expect(drive(context())).rejects.toThrow("storage unreachable");
      } finally {
        spy.mockRestore();
      }
      expect(m.release).toHaveBeenCalledWith("res-1", "request could not be prepared");
      expect(m.settle).not.toHaveBeenCalled();
      expect(m.wanSubmit).not.toHaveBeenCalled();
    });

    it("books a submit that timed out as spent (a job may exist that we have no id for) and retries once", async () => {
      m.wanSubmit.mockRejectedValueOnce(new ConnectorError("fal", "TIMEOUT", "slow")).mockResolvedValue({ requestId: "r2", statusUrl: "https://queue.fal.run/x/requests/r2/status", responseUrl: "https://queue.fal.run/x/requests/r2" });
      const result = await drive(context());
      expect(m.settle).toHaveBeenCalledWith("res-1", 3.75, expect.objectContaining({ note: "submit outcome unknown" }));
      expect(generateReservations().map((input) => input.attempt)).toEqual([1, 2]);
      expect(result.contentType).toBe("shorts");
    });
  });

  describe("quality gate", () => {
    const blackVideo = analysisOf({ black: { seconds: 4, spans: [{ start: 10, end: 14 }] } });

    it("rejects a clearly broken video automatically and regenerates ONCE, with a correction in the new prompt", async () => {
      m.getAnalysis.mockResolvedValueOnce({ state: "done", result: blackVideo }).mockResolvedValue({ state: "done", result: analysisOf() });
      const result = await drive(context());
      expect(m.wanSubmit).toHaveBeenCalledTimes(2);
      expect(String((m.wanSubmit.mock.calls[1][0] as WanRequest).prompt)).toContain("Correction for this attempt");
      expect(String((m.wanSubmit.mock.calls[1][0] as WanRequest).prompt)).toContain("no black frames");
      expect((result.output as { generation: { attempts: Array<{ outcome: string }> } }).generation.attempts.map((item) => item.outcome)).toEqual(["rejected", "accepted"]);
    });

    it("fails the run when the second video is rejected too: no third generation, and the user is told why", async () => {
      m.getAnalysis.mockResolvedValue({ state: "done", result: blackVideo });
      await expect(drive(context())).rejects.toThrow(/품질 점검을 통과하지 못했어요/);
      expect(m.wanSubmit).toHaveBeenCalledTimes(2);
      expect(m.startCompose).not.toHaveBeenCalled();
    });

    it("sends the sampled frames to the vision model together with the plan, and a high-severity finding rejects", async () => {
      const bad = { checks: Object.fromEntries(["hook", "concept", "productFidelity", "brandText", "uiFabrication", "subtitles", "artifacts", "continuity"].map((key) => [key, { ok: true, note: "" }])), problems: [{ code: "label-wrong", severity: "high", note: "라벨 글자가 달라요" }], summary: "라벨 문제" };
      const { MockAIProvider } = await import("@/server/ai/providers/mock");
      const original = MockAIProvider.prototype.generateText;
      let calls = 0;
      MockAIProvider.prototype.generateText = async function (params) {
        if (params.prompt.includes("AUTOBIZ_AD_QA_V1") && calls++ === 0) return { text: JSON.stringify(bad) };
        return original.call(this, params);
      };
      try {
        const result = await drive(context());
        const qaRequests = m.aiRequests.filter((request) => request.purpose === "video.qa");
        expect(qaRequests).toHaveLength(2);
        expect(qaRequests[0].role).toBe("vision");
        expect(qaRequests[0].prompt).toContain("frame 1 at 3s");
        expect(m.wanSubmit).toHaveBeenCalledTimes(2);
        expect(String((m.wanSubmit.mock.calls[1][0] as WanRequest).prompt)).toContain("label");
        expect((result.output as { generation: { attempts: Array<{ outcome: string }> } }).generation.attempts[0].outcome).toBe("rejected");
      } finally {
        MockAIProvider.prototype.generateText = original;
      }
    });

    it("keeps going with a warning when the vision check is unavailable, and never calls the video 'approved'", async () => {
      m.aiFail.purpose = "video.qa";
      const result = await drive(context());
      const qa = (result.output as { qa: { status: string; aiChecked: boolean; notes: string[] } }).qa;
      expect(qa).toMatchObject({ status: "NEEDS_HUMAN_CHECK", aiChecked: false });
      expect(qa.notes.join(" ")).toContain("AI 화면 점검을 하지 못했어요");
    });

    it("warns, but does not reject, when the video service reports a prompt without the standing rules", async () => {
      m.wanStatus.mockResolvedValue(done({ actualPrompt: "A lovely cinematic ad for bread." }));
      const result = await drive(context());
      const qa = (result.output as { qa: { findings: Array<{ code: string; severity: string; message: string }>; notes: string[] } }).qa;
      expect(qa.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "prompt-rules-dropped", severity: "warn", message: expect.stringContaining("금지 규칙") })]));
      expect(qa.notes).toEqual([]);
      expect(m.wanSubmit).toHaveBeenCalledTimes(1);
    });

    it("carries on, with a note, when the worker cannot measure the video", async () => {
      m.getAnalysis.mockResolvedValue({ state: "failed", message: "ffmpeg exploded" });
      const result = await drive(context());
      expect(JSON.stringify(result.output)).toContain("자동 품질 점검을 하지 못했어요");
    });
  });

  describe("voice", () => {
    const silent = analysisOf({ probe: { ...probe, hasAudio: false }, audio: null });

    it("uses the video's own voice when it has one, and records the voice call as not needed", async () => {
      await drive(context());
      expect(m.tts).not.toHaveBeenCalled();
      expect(m.startCompose.mock.calls[0][0]).toMatchObject({ audioMode: "native" });
    });

    it("falls back to a Korean narration (paid from the video budget) when the video came out silent, and mixes it in", async () => {
      m.getAnalysis.mockResolvedValue({ state: "done", result: silent });
      const result = await drive(context());
      expect(m.tts).toHaveBeenCalledWith(expect.stringContaining("오늘 소개할 건"));
      expect(m.reserve.mock.calls.map((call) => call[0].step)).toContain("video.tts");
      expect(m.uploads).toContainEqual({ bucket: "shorts-videos", path: "user-1/auto-1/run-1/voice-1.mp3" });
      expect(m.startCompose.mock.calls[0][0]).toMatchObject({ audioMode: "voice_only", voiceUrl: expect.stringContaining("voice-1.mp3") });
      expect(result.output).toMatchObject({ voiceFallback: true });
    });

    it("always adds the Korean voice when the owner chose it, mixed over the video's music and effects", async () => {
      const result = await drive(context({ voiceMode: "tts" }));
      expect(String((m.wanSubmit.mock.calls[0][0] as WanRequest).prompt)).toContain("No speech, no singing and no vocals");
      expect(m.tts).toHaveBeenCalledTimes(1);
      expect(m.startCompose.mock.calls[0][0]).toMatchObject({ audioMode: "mix" });
      expect(result.output).toMatchObject({ voiceMode: "tts", voiceFallback: false });
    });

    it("finishes the video, with a note, when the voice cannot be made", async () => {
      m.tts.mockRejectedValue(new ConnectorError("elevenlabs", "UPSTREAM_SERVER_ERROR", "503"));
      const result = await drive(context({ voiceMode: "tts" }));
      expect(JSON.stringify(result.output)).toContain("한국어 음성을 입히지 못해서");
      expect(m.startCompose.mock.calls[0][0]).toMatchObject({ audioMode: "native" });
    });
  });

  describe("finishing with FFmpeg", () => {
    it("lays the logo, the call to action and exact images over the finished video through the worker", async () => {
      const logo = { id: "logo", kind: "logo", origin: "upload", source: "user-1/auto-1/assets/logo.png", label: "" };
      const exact = image("c", { role: "exact", label: "라벨" });
      await drive(context({ assets: [image("a"), exact, logo] }));
      const spec = m.startCompose.mock.calls[0][0];
      expect(spec.videoUrl).toBe("https://v3.fal.media/files/out.mp4");
      expect(spec.uploadUrl).toContain("/upload/shorts-videos/user-1/auto-1/run-1/final.mp4");
      expect(spec.target).toEqual({ width: 720, height: 1280, fps: 30 });
      const kinds = spec.overlays.map((overlay: { kind: string; position: string }) => `${overlay.kind}:${overlay.position}`);
      expect(kinds).toContain("image:top-right"); // the logo
      expect(kinds).toContain("image:center"); // the exact image
      expect(kinds).toContain("text:bottom"); // the call to action
      expect(spec.overlays.find((overlay: { kind: string; text?: string }) => overlay.kind === "text")?.text).toBeTruthy();
    });

    it("never signs a logo outside this automation's own folder (config is owner-writable)", async () => {
      const assets = await import("@/server/shorts/assets");
      const real = await vi.importActual<typeof import("@/server/shorts/assets")>("@/server/shorts/assets");
      const spy = vi.spyOn(assets, "resolveAssetUrls").mockImplementation(async (_admin, list, owner) => {
        for (const asset of list) if (asset.origin === "upload" && !real.isOwnedAssetPath(asset.source, owner.userId, owner.automationId)) throw new Error("foreign asset");
        return list.map((asset) => `https://project.supabase.co/sign/${asset.source}?t=1`);
      });
      const foreignLogo = { id: "logo", kind: "logo", origin: "upload", source: "user-2/auto-9/assets/logo.png", label: "" };
      try {
        await expect(drive(context({ assets: [image("a"), foreignLogo] }))).rejects.toThrow("foreign asset");
      } finally {
        spy.mockRestore();
      }
      expect(m.startCompose).not.toHaveBeenCalled();
    });

    it("writes the business name when there is no logo", async () => {
      await drive(context());
      expect(m.startCompose.mock.calls[0][0].overlays).toContainEqual(expect.objectContaining({ kind: "text", text: "우리동네 빵집", position: "top-left" }));
    });

    it("sends the job again when the worker lost it, and fails after three tries (the work is free, so retrying is fine)", async () => {
      m.getCompose.mockResolvedValueOnce({ state: "failed", message: "gone", lost: true }).mockResolvedValue({ state: "done", result: { probe } });
      await drive(context());
      expect(m.startCompose).toHaveBeenCalledTimes(2);

      m.startCompose.mockClear();
      m.getCompose.mockResolvedValue({ state: "failed", message: "ffmpeg exited with 1" });
      await expect(drive(context())).rejects.toThrow("영상 마무리 작업에 실패했어요");
      expect(m.startCompose).toHaveBeenCalledTimes(3);
    });
  });

  it("gives up on a run that has been going too long", async () => {
    const ctx = context();
    const started = (await handler.run(ctx)) as Deferred;
    const stale = { ...started.deferred.state, startedAt: new Date(Date.now() - 81 * 60_000).toISOString() };
    await expect(handler.resume!(ctx, stale as never)).rejects.toThrow("너무 오래");
  });

  it("refuses the old job format with a clear message", async () => {
    await expect(handler.resume!(context(), { v: 1, stage: "ANIMATING" } as never)).rejects.toThrow("읽지 못했어요");
  });

  describe("plan -> prompt", () => {
    it("builds the video prompt from the plan by rules, mentioning each reference by position and carrying the standing rules", async () => {
      const started = (await handler.run(context({ assets: [image("a"), image("b"), { id: "v", kind: "video", origin: "upload", source: "user-1/auto-1/assets/v.mp4", label: "", durationSec: 8, fps: 30 }] }))) as Deferred;
      const prompt = String(started.deferred.state.wanPrompt);
      expect(prompt).toContain("Image 1:");
      expect(prompt).toContain("Image 2:");
      expect(prompt).toContain("Video 1:");
      expect(prompt).toContain('Korean voice-over');
      expect(prompt).toContain("Do not render any text, subtitles, captions, watermarks or logos");
      expect(prompt.length).toBeLessThanOrEqual(2_000);
      expect(m.aiRequests.map((request) => `${request.role}:${request.purpose}`)).toEqual(["vision:video.analyze", "planner:video.plan", "reviewer:video.publishing"]);
    });

    it("keeps a calendar topic fixed", async () => {
      const calendarItem = { id: "c1", businessId: "biz-1", plannedDate: "2026-10-01", platform: "youtube_shorts" as const, contentType: "숏폼", topic: "아침 소금빵 소개", goal: "방문 늘리기", summary: "요약", cta: "예약하기" };
      const started = (await handler.run(context({}, { calendarItem }))) as Deferred;
      expect(started.deferred.state.topic).toBe("아침 소금빵 소개");
    });

    it("does not analyse photos that already have a description, and looks at the others in ONE call", async () => {
      await handler.run(context({ assets: [image("a", { summary: "갓 구운 소금빵", role: "product" }), image("b"), image("c")] }));
      const analysis = m.aiRequests.filter((request) => request.purpose === "video.analyze");
      expect(analysis).toHaveLength(1);
      expect(analysis[0].prompt).toContain("Image 2 label");
      expect(analysis[0].prompt).not.toContain("Image 3 label");
    });
  });

  describe("no account publishing", () => {
    it("only renders the video: nothing is posted to any platform, the owner uploads it by hand", async () => {
      const result = await drive(context({ platforms: ["youtube"] }));
      expect(result.output).not.toHaveProperty("publicationResults");
    });
  });

  describe("mock mode (no keys, no money)", () => {
    beforeEach(() => {
      m.real.value = false;
      m.wanStatus.mockResolvedValue(done({ videoUrl: "https://wan-mock.invalid/mock-1-25.mp4" }));
    });

    it("never touches the ledger and returns a flagged sample instead of a video", async () => {
      const result = await drive(context());
      expect(m.reserve).not.toHaveBeenCalled();
      expect(m.settle).not.toHaveBeenCalled();
      expect(result.output).toMatchObject({ sampleVideo: true, videoUrl: "https://wan-mock.invalid/mock-1-25.mp4" });
      expect(result.output).not.toHaveProperty("videoPath");
    });
  });

  describe("budget gating", () => {
    it("draws on the video budget when videos (or any AI) are really paid for", () => {
      const ctx = context();
      m.real.value = true;
      expect(handler.metered!(ctx)).toBe("VIDEO");
      m.real.value = false;
      expect(handler.metered!(ctx)).toBeNull();
    });
  });
});
