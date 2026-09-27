import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Business, BusinessFaq } from "@/types/domain";

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn(),
}));

vi.mock("@/server/ai/generate", () => ({
  generateStructured: generateStructuredMock,
}));

const { answerSupportQuestion, selectRelevantFaqs, FALLBACK_ANSWER } = await import("./answer");

function makeFaq(overrides: Partial<BusinessFaq> = {}): BusinessFaq {
  return {
    id: "faq-1",
    business_id: "biz-1",
    question: "영업시간이 어떻게 되나요?",
    answer: "평일 오전 9시부터 오후 6시까지입니다.",
    is_enabled: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const BUSINESS: Pick<Business, "name" | "industry"> = { name: "테스트 카페", industry: "카페" };

beforeEach(() => {
  generateStructuredMock.mockReset();
});

describe("answerSupportQuestion", () => {
  it("returns a grounded answer when the question is within FAQ scope", async () => {
    const faqs = [makeFaq({ id: "faq-1" }), makeFaq({ id: "faq-2", question: "주차 되나요?", answer: "2시간 무료입니다." })];
    generateStructuredMock.mockResolvedValue({
      answer: "평일 오전 9시부터 오후 6시까지 영업합니다.",
      usedFaqNumbers: [1],
      isAnswerable: true,
    });

    const result = await answerSupportQuestion(BUSINESS, faqs, "몇 시에 여나요?");

    expect(result).toEqual({
      answer: "평일 오전 9시부터 오후 6시까지 영업합니다.",
      isFallback: false,
      usedFaqIds: ["faq-1"],
    });
  });

  it("returns the fixed fallback when the model says the question is out of FAQ scope", async () => {
    const faqs = [makeFaq()];
    generateStructuredMock.mockResolvedValue({ answer: "아마 없을 것 같습니다", usedFaqNumbers: [], isAnswerable: false });

    const result = await answerSupportQuestion(BUSINESS, faqs, "사우나 있나요?");

    // The model's own wording ("아마...") must never leak through — only the fixed constant.
    expect(result).toEqual({ answer: FALLBACK_ANSWER, isFallback: true, usedFaqIds: [] });
  });

  it("does not call the AI at all when the business has no FAQs", async () => {
    const result = await answerSupportQuestion(BUSINESS, [], "영업시간이 어떻게 되나요?");

    expect(result).toEqual({ answer: FALLBACK_ANSWER, isFallback: true, usedFaqIds: [] });
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it("does not call the AI when every FAQ is disabled", async () => {
    const faqs = [makeFaq({ is_enabled: false }), makeFaq({ id: "faq-2", is_enabled: false })];

    const result = await answerSupportQuestion(BUSINESS, faqs, "영업시간이 어떻게 되나요?");

    expect(result).toEqual({ answer: FALLBACK_ANSWER, isFallback: true, usedFaqIds: [] });
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it("falls back when isAnswerable is true but usedFaqNumbers is empty (no grounding cited)", async () => {
    const faqs = [makeFaq()];
    generateStructuredMock.mockResolvedValue({ answer: "그럴듯한 대답", usedFaqNumbers: [], isAnswerable: true });

    const result = await answerSupportQuestion(BUSINESS, faqs, "질문");

    expect(result).toEqual({ answer: FALLBACK_ANSWER, isFallback: true, usedFaqIds: [] });
  });

  it("falls back when every cited FAQ number is out of range (hallucinated citation)", async () => {
    const faqs = [makeFaq()];
    generateStructuredMock.mockResolvedValue({ answer: "그럴듯한 대답", usedFaqNumbers: [99, -1], isAnswerable: true });

    const result = await answerSupportQuestion(BUSINESS, faqs, "질문");

    expect(result).toEqual({ answer: FALLBACK_ANSWER, isFallback: true, usedFaqIds: [] });
  });

  it("keeps only the valid citations when some cited numbers are in range and some aren't", async () => {
    const faqs = [makeFaq({ id: "faq-1" }), makeFaq({ id: "faq-2" })];
    generateStructuredMock.mockResolvedValue({ answer: "답변", usedFaqNumbers: [1, 99], isAnswerable: true });

    const result = await answerSupportQuestion(BUSINESS, faqs, "질문");

    expect(result).toEqual({ answer: "답변", isFallback: false, usedFaqIds: ["faq-1"] });
  });

  it("ignores disabled FAQs even if the caller forgot to filter them out", async () => {
    const faqs = [
      makeFaq({ id: "faq-1", is_enabled: true }),
      makeFaq({
        id: "faq-2",
        is_enabled: false,
        question: "반려동물 동반 가능한가요?",
        answer: "소형견에 한해 동반 가능합니다.",
      }),
    ];
    generateStructuredMock.mockResolvedValue({ answer: "답변", usedFaqNumbers: [1], isAnswerable: true });

    await answerSupportQuestion(BUSINESS, faqs, "질문");

    // Only the enabled FAQ should have been shown to the model — the prompt
    // sent to generateStructured must not mention the disabled one's answer.
    const promptArg = generateStructuredMock.mock.calls[0][0].prompt as string;
    expect(promptArg).toContain(faqs[0].answer);
    expect(promptArg).not.toContain(faqs[1].answer);
  });

  it("rejects a question over the length limit before calling the AI", async () => {
    const faqs = [makeFaq()];

    const error = await answerSupportQuestion(BUSINESS, faqs, "a".repeat(1000)).catch((e) => e);

    expect(error.name).toBe("ZodError");
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it("lets a generateStructured failure propagate instead of masking it as a fallback", async () => {
    const faqs = [makeFaq()];
    generateStructuredMock.mockRejectedValue(new Error("rate limited"));

    await expect(answerSupportQuestion(BUSINESS, faqs, "질문")).rejects.toThrow("rate limited");
  });
});

describe("selectRelevantFaqs", () => {
  it("returns every FAQ unranked when the list is at or under topN", () => {
    const faqs = [makeFaq({ id: "a" }), makeFaq({ id: "b" })];

    expect(selectRelevantFaqs(faqs, "아무 질문", 5)).toEqual(faqs);
  });

  it("ranks by keyword overlap and keeps only topN once the list exceeds it", () => {
    // Note: the tokenizer is a naive whitespace/punctuation split — it does
    // not strip Korean particles (조사), so e.g. "영업시간" and "영업시간이"
    // are different tokens to it. This example deliberately uses a keyword
    // ("주차") that appears as its own token in both the question and the
    // target FAQ, so the ranking signal is unambiguous.
    const faqs = [
      makeFaq({ id: "hours", question: "영업시간이 어떻게 되나요?", answer: "평일 9시부터 6시까지입니다." }),
      makeFaq({ id: "parking", question: "주차 가능한가요?", answer: "네, 2시간 무료 주차 가능합니다." }),
      makeFaq({ id: "wifi", question: "와이파이 되나요?", answer: "네, 무료 와이파이 제공합니다." }),
    ];

    const result = selectRelevantFaqs(faqs, "주차 문의드립니다", 1);

    expect(result).toEqual([faqs[1]]);
  });
});
