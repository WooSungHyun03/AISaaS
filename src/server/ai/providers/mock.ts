import type { AIProvider, GenerateTextParams, GenerateTextResult } from "../provider";
import { MOCK_AI_MARKER } from "../mock-marker";
import { mockAdPlan, mockAdQa, mockImageAnalysis } from "./mock-ad";
import { mockBlogDraft, mockBlogFix, mockBlogGuide, mockBlogPlan, mockBlogReview } from "./mock-blog";

/**
 * Deterministic, no-network provider used for local development, CI, and
 * whenever no real API key is configured. Lets the full automation ->
 * generation -> run-history flow be exercised without any cost or key.
 */
const MOCK_CALENDAR_TOPICS = [
  "처음 오시는 분을 위한 이용 안내",
  "단골 손님이 알려주는 숨은 활용법",
  "계절이 바뀔 때 챙기면 좋은 준비물",
  "자주 받는 질문 다섯 가지 정리",
  "가격과 구성, 이렇게 고르시면 됩니다",
  "하루 일과로 보는 매장의 아침",
  "초보자가 흔히 하는 실수와 해결 방법",
  "이번 달 추천 조합 소개",
  "예약 전에 알아두면 좋은 점",
  "한 번 오신 분들이 다시 찾는 이유",
  "직원이 직접 쓰는 사용 후기 정리",
  "주말 방문 전 확인할 것들",
];

export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async generateText({ prompt, system }: GenerateTextParams): Promise<GenerateTextResult> {
    if (prompt.includes("AUTOBIZ_IMAGE_ANALYSIS_V2")) return { text: mockImageAnalysis(prompt) };
    if (prompt.includes("AUTOBIZ_AD_PLAN_V1")) return { text: mockAdPlan(prompt, system) };
    if (prompt.includes("AUTOBIZ_AD_QA_V1")) return { text: mockAdQa() };

    if (prompt.includes("AUTOBIZ_SHORTS_PUBLISHING_V1")) {
      const topic = prompt.match(/^Topic: (.+)$/m)?.[1]?.trim() ?? "숏폼";
      const hook = prompt.match(/^Spoken hook: (.+)$/m)?.[1]?.trim() ?? topic;
      const keywords = (prompt.match(/^Owner keywords: (.+)$/m)?.[1] ?? "").split(",").map((item) => item.trim()).filter((item) => item && item !== "(none)");
      return {
        text: JSON.stringify({
          title: hook,
          alternativeTitles: [`${topic} 핵심만 정리`, `${topic}, 이렇게 해결해요`],
          description: `${topic}에 대한 이야기를 짧은 영상으로 담았어요. 영상 속 내용 그대로 확인해 보세요.`,
          keywords: keywords.slice(0, 5),
          hashtags: keywords.slice(0, 5),
          callToAction: "궁금한 점은 댓글로 남겨 주세요.",
          summary: `${topic}을(를) 소개하는 짧은 영상이에요.`,
          youtubeTitle: hook,
          instagramHook: hook,
        }),
      };
    }

    if (prompt.includes("AUTOBIZ_CALENDAR_PLAN_V1")) {
      const startDate = prompt.match(/^PLAN_START=(\d{4}-\d{2}-\d{2})$/m)?.[1];
      const rawWeeks = Number(prompt.match(/^WEEKS=(\d+)$/m)?.[1]);
      const businessName = prompt.match(/^BUSINESS_NAME=(.+)$/m)?.[1]?.trim() || "우리 사업";
      if (startDate && Number.isInteger(rawWeeks) && rawWeeks >= 2 && rawWeeks <= 4) {
        const platforms = ["blog", "instagram_reels", "youtube_shorts"] as const;
        const contentTypes = ["정보형 포스팅", "문제 해결 릴스", "핵심 팁 쇼츠"] as const;
        const offsets = [0, 2, 4];
        const items = Array.from({ length: rawWeeks }, (_, week) =>
          platforms.map((platform, index) => {
            const date = new Date(`${startDate}T00:00:00.000Z`);
            date.setUTCDate(date.getUTCDate() + week * 7 + offsets[index]);
            return {
              date: date.toISOString().slice(0, 10),
              platform,
              contentType: contentTypes[index],
              topic: `${businessName} ${MOCK_CALENDAR_TOPICS[(week * 3 + index) % MOCK_CALENDAR_TOPICS.length]}`,
              goal: week === 0 ? "브랜드 인지도 높이기" : "관심 고객의 상담 전환 유도",
              summary: `${businessName}의 강점과 고객이 바로 활용할 수 있는 팁을 한 가지 사례로 설명합니다.`,
              cta: "자세한 내용과 상담 방법을 확인해보세요.",
            };
          }),
        ).flat();
        return { text: JSON.stringify(items) };
      }
    }

    if (prompt.includes("===DIAGNOSIS_DATA_START===")) {
      return { text: "지금까지의 활동을 바탕으로 한 예시 설명이에요. 실제 서비스에서는 AI가 채널 상황에 맞춰 구체적으로 써드려요." };
    }

    if (prompt.includes("===WEBPAGE_DATA_START===")) {
      return {
        text: JSON.stringify({
          contentStatus: "사업 소개와 기본 안내 위주로 구성된 홈페이지예요.",
          extraRecommendations: ["고객 후기나 이용 사례를 한 편씩 정리해 추가해 보세요."],
          mainOffering: null,
          strengths: null,
          marketingGoal: null,
        }),
      };
    }

    // Blog pipeline (local dev / CI): plan, draft, targeted fix, fact check, publishing guide.
    if (prompt.includes("AUTOBIZ_BLOG_PLAN_V2")) return { text: mockBlogPlan(prompt, system) };
    if (prompt.includes("AUTOBIZ_BLOG_DRAFT_V2")) return { text: mockBlogDraft(prompt, system) };
    if (prompt.includes("AUTOBIZ_BLOG_FIX_V2")) return { text: mockBlogFix(prompt, system) };
    if (prompt.includes("AUTOBIZ_BLOG_REVIEW_V2")) return { text: mockBlogReview() };
    if (prompt.includes("AUTOBIZ_BLOG_GUIDE_V1")) return { text: mockBlogGuide(prompt) };

    return {
      text: `${MOCK_AI_MARKER}\n\n다음 요청에 대한 예시 결과입니다:\n"${prompt.slice(0, 200)}"\n\n실제 서비스에서는 AI_PROVIDER 환경변수를 openai 또는 gemini로 설정하면 이 자리에 실제 생성 콘텐츠가 표시됩니다.`,
    };
  }
}
