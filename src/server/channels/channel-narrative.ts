import "server-only";
import { generateText } from "@/server/ai/generate";
import { stripUnverifiedNumbers } from "@/server/shared/ai-number-guard";
import type { ChannelDiagnosis } from "./types";
import type { Business } from "@/types/domain";

export interface ChannelNarrativeResult {
  narrative: string;
  /** False when the AI step failed, or every sentence it wrote mentioned a number not in `diagnosis` (ai-number-guard stripped all of it) — `narrative` falls back to the rule-based summary either way, so the screen is never left without an explanation. */
  aiUsed: boolean;
}

const PLATFORM_LABEL: Record<ChannelDiagnosis["channel"], string> = {
  youtube: "유튜브",
  naver_blog: "네이버 블로그",
  tistory: "티스토리",
};

function tierLabel(score: number): string {
  if (score >= 80) return "아주 잘하고 있어요";
  if (score >= 60) return "꾸준히 하고 있어요";
  if (score >= 40) return "조금 더 힘을 내야 해요";
  return "지금부터 시작해볼 때예요";
}

/** Deterministic, always available — used when the AI step below fails or gets fully stripped by ai-number-guard. */
function buildRuleBasedNarrative(diagnosis: ChannelDiagnosis): string {
  const sentences = [`${PLATFORM_LABEL[diagnosis.channel]} 채널의 전체 점수는 ${diagnosis.overallScore}점이에요. ${tierLabel(diagnosis.overallScore)}.`];
  if (diagnosis.findings[0]) sentences.push(diagnosis.findings[0]);
  return sentences.join(" ");
}

/**
 * Exactly what the prompt below embeds as DIAGNOSIS_DATA — ai-number-guard
 * checks the AI's response against this same string, so "a number the
 * model wrote" and "a number we actually gave it" are always compared
 * against the same source.
 */
function buildAllowedSourceText(diagnosis: ChannelDiagnosis): string {
  return JSON.stringify({
    overallScore: diagnosis.overallScore,
    activityScore: diagnosis.activityScore,
    consistencyScore: diagnosis.consistencyScore,
    contentScore: diagnosis.contentScore,
    metrics: diagnosis.metrics,
    collectedAt: diagnosis.collectedAt,
  });
}

function buildNarrativePrompt(diagnosis: ChannelDiagnosis, business: Pick<Business, "name" | "industry">) {
  const system = [
    "당신은 한국 소상공인을 위한 채널 운영 코치입니다.",
    "아래 DIAGNOSIS_DATA는 이미 계산이 끝난 진단 결과입니다 — 점수나 수치를 새로 만들거나 추측하지 마세요.",
    "DIAGNOSIS_DATA에 없는 숫자(날짜의 연/월/일 구성요소는 예외)는 절대 언급하지 마세요.",
  ].join("\n");

  const prompt = [
    `사업체명: ${business.name}`,
    business.industry ? `업종: ${business.industry}` : null,
    `채널: ${PLATFORM_LABEL[diagnosis.channel]}`,
    "다음 진단 결과를 바탕으로, 사장님께 보여줄 다정하고 구체적인 설명을 한국어 2~3문장으로 써주세요.",
    "오직 DIAGNOSIS_DATA에 있는 수치만 언급하세요.",
    "===DIAGNOSIS_DATA_START===",
    buildAllowedSourceText(diagnosis),
    "===DIAGNOSIS_DATA_END===",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, prompt };
}

/**
 * One short AI-written explanation of a channel diagnosis, with every
 * number it wrote checked against the diagnosis data itself
 * (stripUnverifiedNumbers) — a hallucinated number drops that sentence,
 * not the whole explanation. Falls back to a deterministic rule-based
 * summary when the AI call fails outright, or when nothing survives the
 * check, mirroring diagnosis.ts's "AI 실패는 진단 전체를 실패시키지 않는다"
 * rule: this never throws, and the already-persisted diagnosis this
 * narrates is unaffected either way.
 */
export async function buildChannelNarrative(diagnosis: ChannelDiagnosis, business: Pick<Business, "name" | "industry">): Promise<ChannelNarrativeResult> {
  const ruleBased = buildRuleBasedNarrative(diagnosis);

  let verified: string | null = null;
  try {
    const { system, prompt } = buildNarrativePrompt(diagnosis, business);
    const raw = await generateText({ system, prompt, maxTokens: 300 });
    verified = stripUnverifiedNumbers(raw, buildAllowedSourceText(diagnosis)) || null;
  } catch {
    verified = null;
  }

  return { narrative: verified ?? ruleBased, aiUsed: verified !== null };
}
