import "server-only";
import { serverEnv } from "@/lib/env/server";
import { AIProviderError } from "../errors";
import { fetchWithRetry } from "../http";
import type { AIProvider, GenerateTextParams, GenerateTextResult } from "../provider";

const DEFAULT_MODEL = "gemini-1.5-flash";
const PROVIDER_NAME = "gemini";

/** Thin fetch-based adapter — no SDK dependency, keeps install size down. */
export class GeminiProvider implements AIProvider {
  readonly name = PROVIDER_NAME;

  async generateText({ system, prompt, maxTokens = 1000, temperature = 0.7 }: GenerateTextParams): Promise<GenerateTextResult> {
    const apiKey = serverEnv.GEMINI_API_KEY;
    if (!apiKey) {
      throw new AIProviderError("MISSING_API_KEY", PROVIDER_NAME, "GEMINI_API_KEY is not set (see .env.example).");
    }

    const response = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
      },
      { provider: PROVIDER_NAME },
    );

    const data = (await response.json()) as {
      candidates?: { content: { parts: { text: string }[] } }[];
    };

    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw new AIProviderError("PROVIDER_UNAVAILABLE", PROVIDER_NAME, "Response did not contain any candidates.");
    }

    return { text: candidate.content.parts.map((p) => p.text).join("") };
  }
}
