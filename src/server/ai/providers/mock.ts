import type { AIProvider, GenerateTextParams, GenerateTextResult } from "../provider";

/**
 * Deterministic, no-network provider used for local development, CI, and
 * whenever no real API key is configured. Lets the full automation ->
 * generation -> run-history flow be exercised without any cost or key.
 */
export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async generateText({ prompt }: GenerateTextParams): Promise<GenerateTextResult> {
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

    return {
      text: `[MOCK AI RESPONSE]\n\n다음 요청에 대한 예시 결과입니다:\n"${prompt.slice(0, 200)}"\n\n실제 서비스에서는 AI_PROVIDER 환경변수를 openai 또는 gemini로 설정하면 이 자리에 실제 생성 콘텐츠가 표시됩니다.`,
    };
  }
}
