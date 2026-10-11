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

    if (prompt.includes("AUTOBIZ_REFERENCE_ANALYSIS_V1")) {
      // Decide from the owner's label, the way a person would: enough for local development and CI.
      const label = prompt.match(/for this image \(may be empty\): "([^"]*)"/)?.[1] ?? "";
      const subject = /캐릭터|마스코트|로봇|고양이|강아지|곰|토끼|character|mascot/i.test(label)
        ? "character"
        : /사람|사장|직원|손님|얼굴|모델|person/i.test(label)
          ? "person"
          : /매장|가게|내부|외관|사무실|공간|인테리어|카페 전경|place|shop/i.test(label)
            ? "place"
            : /상품|메뉴|제품|음식|빵|커피|케이크|product|item/i.test(label) || label === ""
              ? "product"
              : "other";
      return { text: JSON.stringify({ subject, summary: label || "상품이 보이는 사진", visibleText: [] }) };
    }

    if (prompt.includes("AUTOBIZ_SHORTS_PLAN_V1")) {
      // Reference lines look like "2. [product] 설명"; pick images from the group the format may use.
      const tagged = [...prompt.matchAll(/^(\d+)\. \[(\w+)\]/gm)].map((match) => ({ index: Number(match[1]), subject: match[2] }));
      const characters = tagged.filter((item) => item.subject === "character").map((item) => item.index);
      const photos = tagged.filter((item) => item.subject !== "character").map((item) => item.index);
      const request = prompt.match(/^The owner's request \(follow it\): (.+)$/m)?.[1] ?? "";
      const onlyPromo = prompt.includes('Use format "promo"');
      const onlyCharacter = prompt.includes('Use format "character"');
      const promo = onlyPromo || (!onlyCharacter && photos.length > 0 && !/마스코트|캐릭터/.test(request));
      if (promo && photos.length > 0) {
        const photo = (turn: number) => photos[turn % photos.length];
        const people = new Set(tagged.filter((item) => item.subject === "person").map((item) => item.index));
        return {
          text: JSON.stringify({
            format: "promo",
            hook: "아직도 모르세요?",
            scenes: [
              { text: "아직도 모르세요?", imageIndex: photo(0), camera: "push-in", animate: !people.has(photo(0)), motionPrompt: "Slow push-in; soft light shimmers across the surface.", durationSec: 3 },
              { text: "정성껏 준비한 대표 메뉴를 만나보세요", imageIndex: photo(1), camera: "pan-left", animate: false, motionPrompt: "", durationSec: 5 },
              { text: "한 입 먹으면 이유를 알게 돼요", imageIndex: photo(2), camera: "pull-out", animate: !people.has(photo(2)), motionPrompt: "Gentle camera pull-back; a little steam rises.", durationSec: 5 },
              { text: "매장 분위기도 편안해요", imageIndex: photo(3), camera: "pan-right", animate: false, motionPrompt: "", durationSec: 5 },
              { text: "지금 바로 들러 보세요", imageIndex: photo(4), camera: "tilt-up", animate: false, motionPrompt: "", durationSec: 4 },
            ],
            caption: "우리 동네 가게 소개 #동네맛집 #소상공인 #숏폼",
            privacy: "private",
          }),
        };
      }
      const character = (turn: number) => (characters.length > 0 ? characters[turn % characters.length] : 1);
      return {
        text: JSON.stringify({
          format: "character",
          hook: "사장님, 큰일 났어요!",
          scenes: [
            { text: "사장님, 큰일 났어요!", speaker: "partner", imageIndex: character(0), action: "The character looks panicked and shakes slightly.", motion: "shake", durationSec: 2 },
            { text: "무슨 일이에요? 말해 보세요!", speaker: "main", imageIndex: character(1), action: "The character tilts its head curiously and waves.", motion: "pop", durationSec: 3 },
            { text: "마케팅할 시간이 하나도 없어요", speaker: "partner", imageIndex: character(2), action: "The character listens with a worried expression.", motion: "wobble", durationSec: 5 },
            { text: "걱정 마세요, 제가 뚝딱 만들어 드려요!", speaker: "main", imageIndex: character(3), action: "The character cheerfully gives a thumbs up and bounces.", motion: "bounce", durationSec: 6 },
            { text: "글도 영상도 한 번에 끝이에요", speaker: "main", imageIndex: character(4), action: "The character spreads its arms proudly.", motion: "zoom", durationSec: 5 },
            { text: "지금 바로 시작해 보세요!", speaker: "main", imageIndex: character(5), action: "The character points forward and winks.", motion: "pop", durationSec: 4 },
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
