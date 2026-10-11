import type { AIProvider, GenerateTextParams, GenerateTextResult } from "../provider";
import { mockBlogOutline, mockBlogSection } from "./mock-blog";

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
    if (prompt.includes("AUTOBIZ_SHORTS_TOPIC_V1")) {
      return { text: JSON.stringify({ topic: "고객의 시간을 아껴주는 우리 서비스 활용법" }) };
    }

    if (prompt.includes("AUTOBIZ_SHORTS_PLAN_V1")) {
      // Image lines look like "2. 설명"; cycle through them so every index is valid.
      const imageCount = Math.max(1, (prompt.match(/^\d+\. /gm) ?? []).length);
      const image = (turn: number) => (turn % imageCount) + 1;
      return {
        text: JSON.stringify({
          hook: "사장님, 큰일 났어요!",
          scenes: [
            { text: "사장님, 큰일 났어요!", speaker: "partner", imageIndex: image(0), action: "The character looks panicked and shakes slightly.", motion: "shake", durationSec: 2 },
            { text: "무슨 일이에요? 말해 보세요!", speaker: "main", imageIndex: image(1), action: "The character tilts its head curiously and waves.", motion: "pop", durationSec: 3 },
            { text: "마케팅할 시간이 하나도 없어요", speaker: "partner", imageIndex: image(2), action: "The character listens with a worried expression.", motion: "wobble", durationSec: 5 },
            { text: "걱정 마세요, 제가 뚝딱 만들어 드려요!", speaker: "main", imageIndex: image(3), action: "The character cheerfully gives a thumbs up and bounces.", motion: "bounce", durationSec: 6 },
            { text: "글도 영상도 한 번에 끝이에요", speaker: "main", imageIndex: image(4), action: "The character spreads its arms proudly.", motion: "zoom", durationSec: 5 },
            { text: "지금 바로 시작해 보세요!", speaker: "main", imageIndex: image(5), action: "The character points forward and winks.", motion: "pop", durationSec: 4 },
          ],
          caption: "마케팅이 어려운 사장님을 위한 캐릭터 콩트 #소상공인마케팅 #숏폼 #마케팅자동화",
          privacy: "private",
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

    // Blog pipeline (local dev / CI): stage 1 picks a topic, stage 2 writes the post.
    if (prompt.includes("Pick one specific blog topic") || prompt.includes("Use exactly this planned topic")) {
      const planned = prompt.match(/Use exactly this planned topic without replacing it: "([^"]+)"/)?.[1];
      const topic = planned ?? "단골 손님이 가장 자주 묻는 질문 정리";
      return { text: JSON.stringify({ topic, title: `${topic}, 한 번에 정리했어요` }) };
    }
    if (prompt.includes("AUTOBIZ_BLOG_OUTLINE_V1")) return { text: mockBlogOutline(prompt, system) };
    if (prompt.includes("AUTOBIZ_BLOG_SECTION_V1")) return { text: mockBlogSection(prompt, system) };

    return {
      text: `[MOCK AI RESPONSE]\n\n다음 요청에 대한 예시 결과입니다:\n"${prompt.slice(0, 200)}"\n\n실제 서비스에서는 AI_PROVIDER 환경변수를 openai 또는 gemini로 설정하면 이 자리에 실제 생성 콘텐츠가 표시됩니다.`,
    };
  }
}
