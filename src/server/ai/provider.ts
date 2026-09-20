export interface GenerateTextParams {
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateTextResult {
  text: string;
}

/**
 * Minimal vendor-neutral interface. Automation handlers and prompt code
 * (src/server/ai/generate.ts, prompts/) only ever depend on this — never on
 * an OpenAI/Gemini SDK type — so swapping the active provider is an env var
 * change (AI_PROVIDER), not a code change.
 */
export interface AIProvider {
  readonly name: string;
  generateText(params: GenerateTextParams): Promise<GenerateTextResult>;
}
