import "server-only";
import { requireEnv } from "@/lib/env/server";
import type { AIProvider, GenerateTextParams, GenerateTextResult } from "../provider";

const DEFAULT_MODEL = "gemini-1.5-flash";

/** Thin fetch-based adapter — no SDK dependency, keeps install size down. */
export class GeminiProvider implements AIProvider {
  readonly name = "gemini";

  async generateText({ system, prompt, maxTokens = 1000, temperature = 0.7 }: GenerateTextParams): Promise<GenerateTextResult> {
    const apiKey = requireEnv("GEMINI_API_KEY");

    const response = await fetch(
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
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Gemini request failed (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as {
      candidates: { content: { parts: { text: string }[] } }[];
    };

    return { text: data.candidates[0]?.content.parts.map((p) => p.text).join("") ?? "" };
  }
}
