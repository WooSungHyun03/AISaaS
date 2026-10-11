/** An image the model should look at (vision). Only the Anthropic adapter supports it today. */
export interface AIImageInput {
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  /** Base64 without the data: prefix. */
  base64: string;
}

export interface GenerateTextParams {
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * `quality` asks for the stronger (slower, pricier) model — long-form writing such as blog
   * posts. Providers map it to AI_QUALITY_MODEL and fall back to their normal model.
   */
  tier?: "fast" | "quality";
  images?: AIImageInput[];
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
