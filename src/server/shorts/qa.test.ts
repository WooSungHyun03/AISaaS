import { describe, expect, it } from "vitest";
import type { VideoAnalysis } from "@/server/connectors/postprocess/types";
import { aiQaSchema, buildAiQaPrompt, combineQa, evaluateAnalysis, promptFindings, retryNoteFrom, type QaFinding } from "./qa";
import { makeAdPlanSchema } from "./ad-plan";
import { mockAdPlan } from "@/server/ai/providers/mock-ad";

const probe = { durationSec: 25, sizeBytes: 4_000_000, formatName: "mp4", hasVideo: true, hasAudio: true, width: 720, height: 1280, fps: 30, videoCodec: "h264", audioCodec: "aac" };
type Over = Omit<Partial<VideoAnalysis>, "probe"> & { probe?: Partial<VideoAnalysis["probe"]> };
function analysis(over: Over = {}): VideoAnalysis {
  const { probe: probeOver, ...rest } = over;
  return { probe: { ...probe, ...probeOver }, black: { seconds: 0, spans: [] }, frozen: { seconds: 0, spans: [] }, audio: { meanVolumeDb: -20, maxVolumeDb: -3, silentSeconds: 0, silentRatio: 0, clippedSamples: 0 }, frames: [], ...rest };
}
const codes = (findings: QaFinding[], severity?: string) => findings.filter((finding) => !severity || finding.severity === severity).map((finding) => finding.code);

describe("deterministic checks", () => {
  const run = (over: Over, voiceMode: "native" | "tts" = "native", expected = 25) => evaluateAnalysis({ analysis: analysis(over), expectedSeconds: expected, voiceMode });

  it("passes a clean 25 s 720x1280 video with sound", () => {
    expect(run({})).toEqual({ findings: [], needsVoiceFallback: false });
  });

  it("rejects the wrong length (beyond 2 s), the wrong ratio, a low resolution, a broken or empty file", () => {
    expect(codes(run({ probe: { durationSec: 22 } }).findings, "reject")).toEqual(["duration"]);
    expect(codes(run({ probe: { durationSec: 26.5 } }).findings, "reject")).toEqual([]);
    expect(codes(run({ probe: { width: 1280, height: 720 } }).findings, "reject")).toContain("aspect");
    expect(codes(run({ probe: { width: 360, height: 640 } }).findings, "reject")).toEqual(["resolution"]);
    expect(codes(run({ probe: { hasVideo: false, videoCodec: null } }).findings, "reject")).toContain("no-video");
    expect(codes(run({ probe: { sizeBytes: 100 } }).findings, "reject")).toContain("tiny-file");
    expect(codes(run({ probe: { durationSec: 0 } }).findings, "reject")).toContain("no-duration");
  });

  it("rejects long black or frozen stretches, and only warns about short ones", () => {
    expect(codes(run({ black: { seconds: 2, spans: [] } }).findings, "reject")).toEqual(["black-frames"]);
    expect(codes(run({ black: { seconds: 0.8, spans: [] } }).findings, "warn")).toEqual(["black-frames"]);
    expect(codes(run({ black: { seconds: 0.3, spans: [] } }).findings)).toEqual([]);
    expect(codes(run({ frozen: { seconds: 3.5, spans: [] } }).findings, "reject")).toEqual(["frozen-frames"]);
    expect(codes(run({ frozen: { seconds: 2, spans: [] } }).findings, "warn")).toEqual(["frozen-frames"]);
  });

  it("does not reject silence: it asks for the Korean voice instead (native mode only)", () => {
    const missing = run({ probe: { hasAudio: false }, audio: null });
    expect(missing.needsVoiceFallback).toBe(true);
    expect(codes(missing.findings, "reject")).toEqual([]);
    expect(run({ audio: { meanVolumeDb: -60, maxVolumeDb: -50, silentSeconds: 20, silentRatio: 0.8, clippedSamples: 0 } }).needsVoiceFallback).toBe(true);
    expect(run({ audio: { meanVolumeDb: -50, maxVolumeDb: -40, silentSeconds: 2, silentRatio: 0.1, clippedSamples: 0 } }).needsVoiceFallback).toBe(true);
    expect(run({ probe: { hasAudio: false }, audio: null }, "tts").needsVoiceFallback).toBe(false);
  });

  it("warns about clipping", () => {
    expect(codes(run({ audio: { meanVolumeDb: -12, maxVolumeDb: 0, silentSeconds: 0, silentRatio: 0, clippedSamples: 5_000 } }).findings, "warn")).toEqual(["clipping"]);
  });
});

describe("frame review by the vision model", () => {
  const plan = makeAdPlanSchema({ durationSec: 25, imageCount: 2, videoCount: 0, audioCount: 0, exactImages: [] }).parse(JSON.parse(mockAdPlan("DURATION=25\nIMAGE_COUNT=2\nVIDEO_COUNT=0\nAUDIO_COUNT=0", "상호: 빵집")));
  const ok = { ok: true, note: "" };
  const review = (problems: unknown[]) => aiQaSchema.parse({ checks: { hook: ok, concept: ok, productFidelity: ok, brandText: ok, uiFabrication: ok, subtitles: ok, artifacts: ok, continuity: ok }, problems, summary: "요약" });

  it("shows the reviewer the plan, the reference notes and the time of each frame, and asks for Korean notes", () => {
    const { system, prompt } = buildAiQaPrompt({ plan, durationSec: 25, referenceNotes: ["갓 구운 소금빵 (글자: 소금빵)"], frameTimes: [3, 9] });
    expect(prompt).toContain("frame 1 at 3s, frame 2 at 9s");
    expect(prompt).toContain("(글자: 소금빵)");
    expect(prompt).toContain(plan.concept);
    expect(prompt).toContain("productFidelity");
    expect(system).toContain("human decides");
    expect(system).toContain("Korean");
  });

  it("turns a high-severity problem into a rejection and a low one into a warning", () => {
    const report = combineQa({ deterministic: [], ai: review([{ code: "label-wrong", severity: "high", note: "라벨 글자가 달라요" }, { code: "hook-weak", severity: "low", note: "" }].map((item) => ({ ...item, note: item.note || "약해요" }))), prompt: [] });
    expect(report.status).toBe("REJECTED");
    expect(report.findings.map((finding) => `${finding.source}:${finding.code}:${finding.severity}`)).toEqual(["ai:label-wrong:reject", "ai:hook-weak:warn"]);
    expect(report.findings[0].message).toContain("라벨");
  });

  it("falls back to 'other' for a problem code it does not know", () => {
    expect(review([{ code: "weird", severity: "low", note: "?" }]).problems[0].code).toBe("other");
  });
});

describe("combined report", () => {
  it("never approves: a clean video at best needs a human check", () => {
    const report = combineQa({ deterministic: [], ai: null, prompt: [], now: new Date("2026-10-12T00:00:00Z") });
    expect(report).toMatchObject({ status: "NEEDS_HUMAN_CHECK", aiChecked: false, checkedAt: "2026-10-12T00:00:00.000Z" });
  });

  it("is rejected by any single deterministic error, whatever the AI says", () => {
    const report = combineQa({ deterministic: evaluateAnalysis({ analysis: analysis({ black: { seconds: 3, spans: [] } }), expectedSeconds: 25, voiceMode: "native" }).findings, ai: null, prompt: [] });
    expect(report.status).toBe("REJECTED");
  });

  it("warns, without rejecting, about a prompt the video service rewrote", () => {
    const dropped = promptFindings("A lovely ad.", "native");
    expect(dropped).toEqual([expect.objectContaining({ code: "prompt-rules-dropped", severity: "warn", source: "prompt" })]);
    expect(promptFindings(undefined, "native")).toEqual([expect.objectContaining({ code: "prompt-unknown", severity: "warn" })]);
    expect(promptFindings("No text or subtitles. Keep the product exactly the same. Do not invent screens. No flicker.", "native")).toEqual([]);
    expect(combineQa({ deterministic: [], ai: null, prompt: dropped }).status).toBe("NEEDS_HUMAN_CHECK");
  });

  it("tells the second attempt what to fix", () => {
    const report = combineQa({
      deterministic: [{ code: "black-frames", severity: "reject", message: "", source: "auto" }, { code: "duration", severity: "reject", message: "", source: "auto" }],
      ai: aiQaSchema.parse({ checks: Object.fromEntries(["hook", "concept", "productFidelity", "brandText", "uiFabrication", "subtitles", "artifacts", "continuity"].map((key) => [key, { ok: true, note: "" }])), problems: [{ code: "label-wrong", severity: "high", note: "x" }, { code: "subtitles-burned", severity: "high", note: "y" }], summary: "" }),
      prompt: [],
    });
    const note = retryNoteFrom(report);
    expect(note).toContain("label");
    expect(note).toContain("no subtitles");
    expect(note).toContain("no black frames");
    expect(note).toContain("whole requested duration");
    expect(retryNoteFrom(combineQa({ deterministic: [], ai: null, prompt: [] }))).toBe("");
  });
});
