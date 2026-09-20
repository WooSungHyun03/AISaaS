import "server-only";
import { requireEnv } from "@/lib/env/server";
import type { AIProvider, GenerateTextParams, GenerateTextResult } from "../provider";

const DEFAULT_MODEL = "gpt-4o-mini";

/** Thin fetch-based adapter — no SDK dependency, keeps install size down. */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai";

  async generateText({ system, prompt, maxTokens = 1000, temperature = 0.7 }: GenerateTextParams): Promise<GenerateTextResult> {
    const apiKey = requireEnv("OPENAI_API_KEY");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI request failed (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
    };

    return { text: data.choices[0]?.message.content ?? "" };
  }
}
