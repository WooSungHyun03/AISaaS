import type { AIProvider, GenerateTextParams, GenerateTextResult } from "../provider";

/**
 * Deterministic, no-network provider used for local development, CI, and
 * whenever no real API key is configured. Lets the full automation ->
 * generation -> run-history flow be exercised without any cost or key.
 */
export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async generateText({ prompt }: GenerateTextParams): Promise<GenerateTextResult> {
    if (prompt.includes("AUTOBIZ_SHORTS_TOPIC_V1")) {
      return { text: JSON.stringify({ topic: "고객의 시간을 아껴주는 우리 서비스 활용법" }) };
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
              topic: `${businessName} 고객이 자주 묻는 질문 ${week + 1}`,
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
      const hasRecentPost = /최근 게시물\/업데이트 신호: 있음/.test(prompt);
      return {
        text: JSON.stringify({
          score: hasRecentPost ? 68 : 42,
          missingChannels: ["instagram", "newsletter"],
          contentStatus: hasRecentPost ? "최근 콘텐츠가 꾸준히 올라오고 있습니다." : "최근 업데이트된 콘텐츠를 찾기 어렵습니다.",
          snsActivity: "SNS 연동 여부를 홈페이지에서 확인하지 못했습니다.",
          recommendations: ["인스타그램 계정을 연결해 주기적으로 소식을 올려보세요.", "블로그에 고객 후기나 사례를 정기적으로 추가해보세요."],
        }),
      };
    }

    return {
      text: `[MOCK AI RESPONSE]\n\n다음 요청에 대한 예시 결과입니다:\n"${prompt.slice(0, 200)}"\n\n실제 서비스에서는 AI_PROVIDER 환경변수를 openai 또는 gemini로 설정하면 이 자리에 실제 생성 콘텐츠가 표시됩니다.`,
    };
  }
}
