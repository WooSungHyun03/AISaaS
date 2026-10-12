/** An image the model should look at (vision). Only the Anthropic adapter supports it today. */
export interface AIImageInput {
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  /** Base64 without the data: prefix. */
  base64: string;
}

import type { AiRole, ClaudeEffort, ClaudeUsage } from "./models";

export interface GenerateTextParams {
  system?: string;
  prompt: string;
  /** Hard limit on the reply. For models that always think (Opus 5.5, Fable 5.1) it covers thinking plus text. */
  maxTokens?: number;
  /** Ignored by models that reject sampling parameters (the 5.x Claude family). */
  temperature?: number;
  /** Picks the model for this step of a pipeline (planner / writer / reviewer / vision). Wins over `tier`. */
  role?: AiRole;
  /** `output_config.effort` for models that support it. Unset = the role's default effort. */
  effort?: ClaudeEffort;
  /** Name of the pipeline step (e.g. "blog.draft"): used for the spend ledger and logs. */
  purpose?: string;
  /**
   * `quality` asks for the stronger (slower, pricier) model — long-form writing such as blog
   * posts. Providers map it to AI_QUALITY_MODEL and fall back to their normal model.
   */
  tier?: "fast" | "quality";
  images?: AIImageInput[];
}

export interface GenerateTextResult {
  text: string;
  /** Model that answered and what the call really used. Absent for providers that do not report it. */
  model?: string;
  usage?: ClaudeUsage;
}

/** What a call would cost at most, known before it is made (the spend ledger reserves this). */
export interface AICallEstimate {
  model: string;
  worstCaseUsd: number;
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
  /** The model and the worst-case price of a call, or undefined when the provider cannot price it (not budgetable). */
  estimateCall?(params: GenerateTextParams): AICallEstimate | undefined;
}
