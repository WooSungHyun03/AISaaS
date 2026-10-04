import "server-only";
import { serverEnv } from "@/lib/env/server";
import { AIProviderError } from "../errors";
import { fetchWithRetry } from "../http";
import type { AIProvider, GenerateTextParams, GenerateTextResult } from "../provider";

/** Claude Haiku 4.5 — fast and inexpensive; override with AI_MODEL (e.g. a Sonnet id) without a code change. */
export const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const PROVIDER_NAME = "anthropic";
const API_VERSION = "2023-06-01";

/** Thin fetch-based adapter for the Messages API — no SDK dependency, same shape as the OpenAI/Gemini adapters. */
export class AnthropicProvider implements AIProvider {
  readonly name = PROVIDER_NAME;

  async generateText({ system, prompt, maxTokens = 1000, temperature = 0.7 }: GenerateTextParams): Promise<GenerateTextResult> {
    const apiKey = serverEnv.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new AIProviderError("MISSING_API_KEY", PROVIDER_NAME, "ANTHROPIC_API_KEY is not set (see .env.example).");
    }

    const response = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify({
          model: serverEnv.AI_MODEL ?? ANTHROPIC_DEFAULT_MODEL,
          max_tokens: maxTokens,
          temperature,
          ...(system ? { system } : {}),
          messages: [{ role: "user", content: prompt }],
        }),
      },
      { provider: PROVIDER_NAME },
    );

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      stop_reason?: string;
    };

    const text = data.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
    if (!text) {
      throw new AIProviderError("PROVIDER_UNAVAILABLE", PROVIDER_NAME, "Response did not contain any text.");
    }
    // A reply cut off by max_tokens is almost always unparseable JSON; say so instead of a vague parse error later.
    if (data.stop_reason === "max_tokens") {
      throw new AIProviderError("INVALID_STRUCTURED_RESPONSE", PROVIDER_NAME, "Response was cut off at max_tokens.");
    }

    return { text };
  }
}
