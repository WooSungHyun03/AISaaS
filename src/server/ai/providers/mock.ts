import type { AIProvider, GenerateTextParams, GenerateTextResult } from "../provider";

/**
 * Deterministic, no-network provider used for local development, CI, and
 * whenever no real API key is configured. Lets the full automation ->
 * generation -> run-history flow be exercised without any cost or key.
 */
export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async generateText({ prompt }: GenerateTextParams): Promise<GenerateTextResult> {
    return {
      text: `[MOCK AI RESPONSE]\n\n다음 요청에 대한 예시 결과입니다:\n"${prompt.slice(0, 200)}"\n\n실제 서비스에서는 AI_PROVIDER 환경변수를 openai 또는 gemini로 설정하면 이 자리에 실제 생성 콘텐츠가 표시됩니다.`,
    };
  }
}
