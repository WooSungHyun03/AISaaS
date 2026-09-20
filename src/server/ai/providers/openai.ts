import "server-only";
import { serverEnv } from "@/lib/env/server";
import { AIProviderError } from "../errors";
import { fetchWithRetry } from "../http";
import type { AIProvider, GenerateTextParams, GenerateTextResult } from "../provider";

const DEFAULT_MODEL = "gpt-4o-mini";
const PROVIDER_NAME = "openai";

/** Thin fetch-based adapter — no SDK dependency, keeps install size down. */
export class OpenAIProvider implements AIProvider {
  readonly name = PROVIDER_NAME;

  async generateText({ system, prompt, maxTokens = 1000, temperature = 0.7 }: GenerateTextParams): Promise<GenerateTextResult> {
    const apiKey = serverEnv.OPENAI_API_KEY;
    if (!apiKey) {
      throw new AIProviderError("MISSING_API_KEY", PROVIDER_NAME, "OPENAI_API_KEY is not set (see .env.example).");
    }

    const response = await fetchWithRetry(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          temperature,
          max_tokens: maxTokens,
          messages: [
            ...(system ? [{ role: "system", content: system }] : []),
            { role: "user", content: prompt },
          ],
        }),
      },
      { provider: PROVIDER_NAME },
    );

    const data = (await response.json()) as {
      choices?: { message: { content: string } }[];
    };

    const text = data.choices?.[0]?.message.content;
    if (text === undefined) {
      throw new AIProviderError("PROVIDER_UNAVAILABLE", PROVIDER_NAME, "Response did not contain any choices.");
    }

    return { text };
  }
}
