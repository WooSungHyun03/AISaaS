import type { AIProvider, GenerateTextParams, GenerateTextResult } from "../provider";

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

  async generateText({ prompt }: GenerateTextParams): Promise<GenerateTextResult> {
    if (prompt.includes("AUTOBIZ_SHORTS_TOPIC_V1")) {
      return { text: JSON.stringify({ topic: "고객의 시간을 아껴주는 우리 서비스 활용법" }) };
    }

    if (prompt.includes("AUTOBIZ_SHORTS_SKIT_V1")) {
      // One numbered line per reference image ("1. …"); cycle through them so every index is valid.
      const imageCount = Math.max(1, (prompt.match(/^\d+\. /gm) ?? []).length);
      const image = (turn: number) => (turn % imageCount) + 1;
      return {
        text: JSON.stringify({
          hook: "사장님, 큰일 났어요!",
          scenes: [
            { text: "사장님, 큰일 났어요!", speaker: "partner", imageIndex: image(0), motion: "shake", durationSec: 2 },
            { text: "무슨 일이에요? 말해 보세요!", speaker: "main", imageIndex: image(1), motion: "pop", durationSec: 3 },
            { text: "마케팅할 시간이 하나도 없어요", speaker: "partner", imageIndex: image(2), motion: "wobble", durationSec: 5 },
            { text: "걱정 마세요, 제가 뚝딱 만들어 드려요!", speaker: "main", imageIndex: image(3), motion: "bounce", durationSec: 6 },
            { text: "글도 영상도 한 번에 끝이에요", speaker: "main", imageIndex: image(4), motion: "zoom", durationSec: 5 },
            { text: "지금 바로 시작해 보세요!", speaker: "main", imageIndex: image(5), motion: "pop", durationSec: 4 },
          ],
          caption: "마케팅이 어려운 사장님을 위한 캐릭터 콩트 #소상공인마케팅 #숏폼 #마케팅자동화",
          privacy: "private",
        }),
      };
    }

    if (prompt.includes("AUTOBIZ_SHORTS_CONTENT_V1")) {
      return {
        text: JSON.stringify({
          hook: "아직도 이 일에 매일 시간을 쓰고 계신가요?",
          script: "반복 업무 때문에 중요한 고객을 놓치고 있나요? 필요한 정보를 한 번 정리하면 매일 해야 했던 일을 더 빠르게 처리할 수 있습니다. 오늘부터 반복 업무를 줄이고 고객에게 집중해보세요.",
          scenes: [
            { text: "아직도 매일 반복하세요?", visualPrompt: "바쁜 소상공인이 책상 위 할 일 목록을 보며 놀라는 모습, 세로 9:16 클로즈업, 밝은 자연광", durationSec: 3 },
            { text: "반복 업무가 고객 시간을 빼앗습니다", visualPrompt: "알림과 문서가 쌓인 화면을 빠르게 넘기는 손, 세로 9:16 오버헤드 샷", durationSec: 4 },
            { text: "정보를 한 번 정리하면 달라집니다", visualPrompt: "복잡한 메모가 깔끔한 한 장의 업무 화면으로 정리되는 장면, 세로 9:16", durationSec: 5 },
            { text: "반복은 줄이고 고객에게 집중하세요", visualPrompt: "사업자가 고객과 편안하게 대화하는 모습, 세로 9:16 미디엄 샷, 따뜻한 조명", durationSec: 5 },
          ],
          caption: "매일 반복하던 업무를 줄이고 고객에게 더 집중해보세요. #업무자동화 #소상공인마케팅 #생산성",
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
    if (prompt.includes("Write the full marketing blog post body")) {
      const topic = prompt.match(/for the topic "([^"]+)"/)?.[1] ?? "자주 묻는 질문";
      const paragraphs = [
        `${topic}에 대해 손님이 가장 많이 물어보시는 내용을 모아 정리했습니다. 매장에서 직접 대화하며 들은 질문이라 실제로 궁금해하시는 부분 위주로 적었습니다.`,
        "먼저 이용 방법입니다. 처음 방문하시는 분은 입구에서 간단한 안내를 받으실 수 있고, 미리 연락 주시면 기다리는 시간을 줄일 수 있습니다. 바쁜 시간대에는 조금 더 걸릴 수 있어 여유를 두고 오시길 권합니다.",
        "다음으로 준비하시면 좋은 것들입니다. 특별히 챙기실 물건은 없지만, 원하시는 방향이 있다면 사진이나 메모를 가져오시면 상담이 훨씬 수월합니다. 모르는 부분은 편하게 물어보셔도 됩니다.",
        "마지막으로 궁금한 점이 남으셨다면 가게로 연락 주세요. 방문 전에 필요한 내용을 미리 안내해 드리고, 처음이라 어색하실 분들께도 천천히 설명해 드리겠습니다. 가까운 시간에 편하게 들러 주세요.",
      ];
      return {
        text: JSON.stringify({
          hook: "처음 오시는 분들이 가장 먼저 묻는 이야기부터 풀어볼게요.",
          excerpt: `${topic}에 대해 자주 받는 질문을 짧게 정리했어요.`,
          bodyHtml: paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join(""),
          keywords: ["자주 묻는 질문", "이용 안내"],
          seoKeywords: ["이용 방법", "방문 전 준비"],
          callToAction: "궁금한 점은 편하게 문의해 주세요.",
          imageSuggestion: "도입부 직후: 매장 입구 전경 사진",
        }),
      };
    }

    return {
      text: `[MOCK AI RESPONSE]\n\n다음 요청에 대한 예시 결과입니다:\n"${prompt.slice(0, 200)}"\n\n실제 서비스에서는 AI_PROVIDER 환경변수를 openai 또는 gemini로 설정하면 이 자리에 실제 생성 콘텐츠가 표시됩니다.`,
    };
  }
}
