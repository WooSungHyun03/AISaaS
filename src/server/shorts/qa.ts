import { z } from "zod";
import type { VideoAnalysis } from "@/server/connectors/postprocess/types";
import type { AdPlan } from "./ad-plan";
import { missingProhibitions, REQUIRED_PROHIBITIONS } from "./ad-plan";
import type { VoiceMode } from "@/types/shorts-reference";

/**
 * Quality gate for a generated Short. Two independent looks, and neither one approves anything:
 *  1. Deterministic checks on what FFmpeg measured (length, size, ratio, black or frozen stretches, silence, clipping).
 *  2. A vision model that reads sampled frames against the plan (hook, product and label fidelity, invented screens or
 *     text, burned-in subtitles, artifacts, continuity).
 * A clear error in either rejects the video automatically. A video that passes both is only ever "needs a human check":
 * the owner watches it and decides.
 */
export type QaSeverity = "reject" | "warn";

export interface QaFinding {
  code: string;
  severity: QaSeverity;
  message: string;
  source: "auto" | "ai" | "prompt";
}

export const QA_LIMITS = {
  /** Output length may differ from the request by this much before it is a defect. */
  durationToleranceSec: 2,
  aspectTolerance: 0.03,
  minHeight: 1000,
  maxBlackSeconds: 1.2,
  warnBlackSeconds: 0.5,
  maxFrozenSeconds: 3,
  warnFrozenSeconds: 1.5,
  /** More silence than this and the native voice cannot be trusted. */
  maxSilentRatio: 0.55,
  quietMeanDb: -42,
  clippedSamplesWarn: 200,
  minBytes: 50_000,
} as const;

export interface DeterministicResult {
  findings: QaFinding[];
  /** The video has no usable sound although it should (native voice mode): the Korean voice fallback applies. */
  needsVoiceFallback: boolean;
}

export function evaluateAnalysis(args: { analysis: VideoAnalysis; expectedSeconds: number; voiceMode: VoiceMode }): DeterministicResult {
  const { analysis, expectedSeconds, voiceMode } = args;
  const { probe } = analysis;
  const findings: QaFinding[] = [];
  const add = (severity: QaSeverity, code: string, message: string) => findings.push({ code, severity, message, source: "auto" });
  let needsVoiceFallback = false;

  if (!probe.hasVideo || !probe.videoCodec) add("reject", "no-video", "영상 화면이 없는 파일이에요.");
  if (probe.sizeBytes < QA_LIMITS.minBytes) add("reject", "tiny-file", "영상 파일이 비정상적으로 작아요. 손상됐을 수 있어요.");
  if (probe.durationSec <= 0) add("reject", "no-duration", "영상 길이를 읽지 못했어요.");
  else if (Math.abs(probe.durationSec - expectedSeconds) > QA_LIMITS.durationToleranceSec) {
    add("reject", "duration", `영상 길이가 ${Math.round(probe.durationSec * 10) / 10}초예요. 요청한 ${expectedSeconds}초와 달라요.`);
  }
  if (probe.width && probe.height) {
    const ratio = probe.width / probe.height;
    if (Math.abs(ratio - 9 / 16) > QA_LIMITS.aspectTolerance) add("reject", "aspect", `화면 비율이 ${probe.width}×${probe.height}예요. 세로 9:16이어야 해요.`);
    if (probe.height < QA_LIMITS.minHeight) add("reject", "resolution", `해상도가 ${probe.width}×${probe.height}로 너무 낮아요.`);
  }

  if (analysis.black.seconds > QA_LIMITS.maxBlackSeconds) add("reject", "black-frames", `화면이 까맣게 비는 구간이 ${analysis.black.seconds}초 있어요.`);
  else if (analysis.black.seconds > QA_LIMITS.warnBlackSeconds) add("warn", "black-frames", `화면이 잠깐(${analysis.black.seconds}초) 까매져요. 장면 전환인지 확인해 주세요.`);
  if (analysis.frozen.seconds > QA_LIMITS.maxFrozenSeconds) add("reject", "frozen-frames", `화면이 멈춰 있는 구간이 ${analysis.frozen.seconds}초 있어요.`);
  else if (analysis.frozen.seconds > QA_LIMITS.warnFrozenSeconds) add("warn", "frozen-frames", `화면이 ${analysis.frozen.seconds}초 동안 거의 움직이지 않아요.`);

  if (!probe.hasAudio) {
    if (voiceMode === "native") needsVoiceFallback = true;
    add("warn", "no-audio", voiceMode === "native" ? "영상에 소리가 없어서 한국어 음성을 따로 입혀요." : "영상에 효과음·음악이 없어요.");
  } else if (analysis.audio) {
    if (analysis.audio.silentRatio > QA_LIMITS.maxSilentRatio || (analysis.audio.meanVolumeDb !== null && analysis.audio.meanVolumeDb < QA_LIMITS.quietMeanDb)) {
      if (voiceMode === "native") needsVoiceFallback = true;
      add("warn", "silent-audio", voiceMode === "native" ? "영상의 소리가 거의 비어 있어서 한국어 음성을 따로 입혀요." : "영상의 소리가 거의 비어 있어요.");
    }
    if (analysis.audio.clippedSamples > QA_LIMITS.clippedSamplesWarn) add("warn", "clipping", "소리가 일부 깨질 수 있어요. 마무리 작업에서 음량을 맞춰요.");
  }
  return { findings, needsVoiceFallback };
}

const check = z.object({ ok: z.boolean(), note: z.string().trim().max(240).default("") });
export const AI_QA_PROBLEM_CODES = ["hook-weak", "concept-mismatch", "product-distorted", "label-wrong", "brand-text-wrong", "ui-fabricated", "subtitles-burned", "artifacts", "discontinuity", "other"] as const;

export const aiQaSchema = z.object({
  checks: z.object({
    hook: check,
    concept: check,
    productFidelity: check,
    brandText: check,
    uiFabrication: check,
    subtitles: check,
    artifacts: check,
    continuity: check,
  }),
  problems: z
    .array(z.object({ code: z.enum(AI_QA_PROBLEM_CODES).catch("other"), severity: z.enum(["high", "low"]), note: z.string().trim().min(1).max(240) }))
    .max(12)
    .default([]),
  summary: z.string().trim().max(240).default(""),
});
export type AiQaResult = z.infer<typeof aiQaSchema>;

export interface AiQaPromptInput {
  plan: AdPlan;
  durationSec: number;
  /** What the AI saw in the owner's photos (summary + readable text), so label fidelity can be judged. */
  referenceNotes: string[];
  frameTimes: number[];
}

export function buildAiQaPrompt({ plan, durationSec, referenceNotes, frameTimes }: AiQaPromptInput) {
  const system = [
    "You are a strict quality reviewer of AI-generated vertical video ads for small businesses. You see evenly spaced frames of one generated video and the plan it was generated from.",
    "Judge only what is visible in the frames. You cannot hear the video. Report a problem as severity 'high' ONLY when it is clearly visible: a product, package, label or logo that is deformed or differs from the references; invented text, prices, screens or brand names; burned-in subtitles or captions; obvious AI artifacts (melted hands or faces, extra limbs, flicker, objects morphing); a scene that contradicts the plan. Doubtful things are severity 'low'.",
    "Never praise a video to approve it: a human decides. Be specific and brief. Write notes in Korean.",
  ].join("\n");
  const prompt = [
    "AUTOBIZ_AD_QA_V1",
    `Video length: ${durationSec} seconds. The frames are in time order: ${frameTimes.map((time, index) => `frame ${index + 1} at ${time}s`).join(", ")}.`,
    `Concept: ${plan.concept}`,
    `Hook (first 2 seconds): ${plan.hook.visual}`,
    "Storyboard:",
    ...plan.storyboard.map((scene) => `- ${scene.startSec}-${scene.endSec}s: ${scene.visual}`),
    plan.preservation.length ? `Must stay unchanged: ${plan.preservation.join("; ")}` : null,
    referenceNotes.length ? `What the owner's reference photos show (text on packaging and labels included):\n${referenceNotes.map((note) => `- ${note}`).join("\n")}` : null,
    "Check: hook (does the opening show the real subject and stop the scroll?), concept (does it follow the plan?), productFidelity (are products and packages faithful to the references?), brandText (is any visible brand text correct and not invented?), uiFabrication (are there invented screens, prices or interfaces?), subtitles (any burned-in subtitles or captions?), artifacts, continuity (do the same product and person look the same across shots?).",
    `Problem codes: ${AI_QA_PROBLEM_CODES.join(" | ")}.`,
    'Return JSON with exactly these fields: { "checks": { "hook": {"ok": true, "note": ""}, "concept": {...}, "productFidelity": {...}, "brandText": {...}, "uiFabrication": {...}, "subtitles": {...}, "artifacts": {...}, "continuity": {...} }, "problems": [{ "code": "product-distorted", "severity": "high|low", "note": "Korean, what and where" }], "summary": "Korean, one sentence" }',
  ].filter(Boolean).join("\n");
  return { system, prompt };
}

const AI_CODE_MESSAGE: Record<(typeof AI_QA_PROBLEM_CODES)[number], string> = {
  "hook-weak": "첫 2초가 시선을 끌지 못해요.",
  "concept-mismatch": "기획과 다른 장면이 있어요.",
  "product-distorted": "상품 모양이 원본과 달라 보여요.",
  "label-wrong": "라벨이나 포장 글자가 원본과 달라 보여요.",
  "brand-text-wrong": "상호·브랜드 글자가 잘못 나와요.",
  "ui-fabricated": "없는 화면이나 가격이 만들어졌어요.",
  "subtitles-burned": "영상 안에 자막이 박혀 있어요.",
  artifacts: "손·얼굴·물체가 일그러지는 부분이 있어요.",
  discontinuity: "장면마다 상품이나 인물이 달라 보여요.",
  other: "확인이 필요한 부분이 있어요.",
};

export function aiFindings(result: AiQaResult): QaFinding[] {
  return result.problems.map((problem) => ({
    code: problem.code,
    severity: problem.severity === "high" ? "reject" : "warn",
    message: `${AI_CODE_MESSAGE[problem.code]} ${problem.note}`.trim(),
    source: "ai",
  }));
}

export function promptFindings(actualPrompt: string | undefined, voiceMode: VoiceMode): QaFinding[] {
  const missing = missingProhibitions(actualPrompt, voiceMode);
  if (missing === null) return [{ code: "prompt-unknown", severity: "warn", message: "영상 서비스가 실제로 쓴 설명문을 알려주지 않아 금지 규칙이 지켜졌는지 확인하지 못했어요.", source: "prompt" }];
  if (missing.length === 0) return [];
  const labels = missing.map((id) => REQUIRED_PROHIBITIONS.find((item) => item.id === id)?.text ?? id);
  return [{ code: "prompt-rules-dropped", severity: "warn", message: `영상 서비스가 설명문을 다듬으면서 일부 금지 규칙이 빠졌을 수 있어요. 결과 영상을 꼼꼼히 확인해 주세요. (${labels.length}개)`, source: "prompt" }];
}

export type QaStatus = "REJECTED" | "NEEDS_HUMAN_CHECK";

export interface QaReport {
  status: QaStatus;
  findings: QaFinding[];
  summary: string;
  /** True when frames were sent to the vision model. */
  aiChecked: boolean;
  checkedAt: string;
}

/** Joins the checks. There is no "approved": at best a video needs a person's final look. */
export function combineQa(args: { deterministic: QaFinding[]; ai: AiQaResult | null; prompt: QaFinding[]; now?: Date }): QaReport {
  const findings = [...args.deterministic, ...(args.ai ? aiFindings(args.ai) : []), ...args.prompt];
  const rejected = findings.some((finding) => finding.severity === "reject");
  return {
    status: rejected ? "REJECTED" : "NEEDS_HUMAN_CHECK",
    findings,
    summary: args.ai?.summary ?? "",
    aiChecked: Boolean(args.ai),
    checkedAt: (args.now ?? new Date()).toISOString(),
  };
}

/** What the second attempt is told, from what the first one got wrong. */
export function retryNoteFrom(report: QaReport): string {
  const issues = report.findings.filter((finding) => finding.severity === "reject").map((finding) => finding.code);
  const notes: string[] = [];
  if (issues.some((code) => ["product-distorted", "label-wrong", "brand-text-wrong"].includes(code))) notes.push("keep the product, its label and packaging text exactly as in the reference images; show them large, sharp and steady");
  if (issues.includes("ui-fabricated")) notes.push("show no screens, prices or interfaces other than those in the references");
  if (issues.includes("subtitles-burned")) notes.push("no subtitles or captions anywhere in the frame");
  if (issues.includes("artifacts")) notes.push("avoid close-ups of hands and faces, use calm camera moves and simple actions");
  if (issues.includes("discontinuity")) notes.push("keep the same product and person identical in every shot");
  if (issues.includes("black-frames") || issues.includes("frozen-frames")) notes.push("keep continuous motion and light throughout, no black frames or still frames");
  if (issues.includes("duration")) notes.push("fill the whole requested duration");
  return notes.join("; ");
}
