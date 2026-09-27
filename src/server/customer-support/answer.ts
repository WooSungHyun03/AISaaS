import "server-only";
import { z } from "zod";
import type { Business, BusinessFaq } from "@/types/domain";
import { generateStructured } from "@/server/ai/generate";
import { buildSupportAnswerPrompt } from "./prompts";

/** Exported so callers (e.g. widget.ts's request-body schema) validate against the same bound, not a copy of the number. */
export const QUESTION_MAX_LENGTH = 500;
const DEFAULT_TOP_N_FAQS = 20;

/** Single place this wording lives — #11's conversation log and any other caller read it from here. */
export const FALLBACK_ANSWER = "현재 등록된 정보만으로는 답변드리기 어렵습니다. 담당자가 확인 후 다시 안내드리겠습니다.";

const supportAnswerSchema = z.object({
  answer: z.string(),
  // FAQ *numbers* (1-based position in the prompt's list), not raw ids —
  // an LLM reliably copying an exact UUID back is not something to trust;
  // small integers it can echo correctly, and answer.ts maps them back to
  // real ids itself.
  usedFaqNumbers: z.array(z.number().int()),
  isAnswerable: z.boolean(),
});

export interface SupportAnswer {
  answer: string;
  /** True whenever `answer` is the fixed FALLBACK_ANSWER rather than a grounded reply. */
  isFallback: boolean;
  usedFaqIds: string[];
}

function fallback(): SupportAnswer {
  return { answer: FALLBACK_ANSWER, isFallback: true, usedFaqIds: [] };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Ranks FAQs by simple token overlap with the question and keeps only the
 * top N — but only once there are MORE than topN to begin with. Most
 * businesses (per AGENTS.md's own "FAQ 규모가 작다면 충분" assumption) have
 * few enough FAQs that this never engages, which matters because keyword
 * overlap is a weak signal (a rephrased question, e.g. "몇 시에 여나요" vs
 * "영업시간이 어떻게 되나요", can share zero tokens with the FAQ that
 * actually answers it) — better to show the model everything it has than
 * to silently drop the one relevant entry before the model ever sees it.
 */
export function selectRelevantFaqs(faqs: BusinessFaq[], question: string, topN = DEFAULT_TOP_N_FAQS): BusinessFaq[] {
  if (faqs.length <= topN) return faqs;

  const questionTokens = new Set(tokenize(question));
  const scored = faqs.map((faq) => ({
    faq,
    score: tokenize(`${faq.question} ${faq.answer}`).filter((token) => questionTokens.has(token)).length,
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN).map((entry) => entry.faq);
}

/**
 * Answers a customer question using only this business's enabled FAQs.
 * Never invents facts outside them — any case where grounding can't be
 * proven (no enabled FAQs, the model says it can't answer, or it claims it
 * can but cites nothing real) returns the same fixed FALLBACK_ANSWER
 * instead of the model's own wording.
 *
 * A `generateStructured` failure (AIProviderError — rate limit, timeout,
 * ...) is deliberately NOT caught here and propagates to the caller: that's
 * "the system is broken right now", a different situation from "this isn't
 * in the FAQ", and the caller (the future Chat API, #10) may want to show
 * or log those differently.
 */
export async function answerSupportQuestion(
  business: Pick<Business, "name" | "industry">,
  faqs: BusinessFaq[],
  rawQuestion: string,
): Promise<SupportAnswer> {
  const question = z.string().trim().min(1).max(QUESTION_MAX_LENGTH).parse(rawQuestion);

  // Re-filter even though callers are expected to already pass only enabled
  // FAQs — defense in depth against a caller forgetting that filter.
  const enabledFaqs = faqs.filter((faq) => faq.is_enabled);
  if (enabledFaqs.length === 0) return fallback();

  const candidates = selectRelevantFaqs(enabledFaqs, question);
  const { system, prompt } = buildSupportAnswerPrompt(business, candidates, question);

  const result = await generateStructured({ system, prompt, schema: supportAnswerSchema });

  if (!result.isAnswerable) return fallback();

  const usedFaqIds = result.usedFaqNumbers
    .map((number) => candidates[number - 1]?.id)
    .filter((id): id is string => id !== undefined);

  // Claiming isAnswerable but citing nothing real (empty, or every number
  // hallucinated/out of range) is treated the same as "not answerable" — an
  // answer with zero grounded FAQ backing it is exactly what this function
  // exists to prevent.
  if (usedFaqIds.length === 0) return fallback();

  return { answer: result.answer, isFallback: false, usedFaqIds };
}
