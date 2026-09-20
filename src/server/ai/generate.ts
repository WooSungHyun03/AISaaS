import "server-only";
import type { ZodType } from "zod";
import { getAIProvider } from "./index";
import type { GenerateTextParams } from "./provider";

export async function generateText(params: GenerateTextParams): Promise<string> {
  const { text } = await getAIProvider().generateText(params);
  return text;
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

export interface GenerateStructuredParams<T> {
  system?: string;
  prompt: string;
  schema: ZodType<T>;
  maxTokens?: number;
}

/**
 * Generates text and parses/validates it as JSON against `schema`. Built on
 * top of generateText() so every provider gets structured output for free
 * without implementing its own JSON mode. Retries once (never more — Rule:
 * no infinite retries) if the first response fails to parse or validate.
 */
export async function generateStructured<T>({
  system,
  prompt,
  schema,
  maxTokens,
}: GenerateStructuredParams<T>): Promise<T> {
  const jsonInstruction =
    "Respond with ONLY valid JSON matching the requested shape. No markdown fences, no commentary.";

  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await generateText({
      system: system ? `${system}\n\n${jsonInstruction}` : jsonInstruction,
      prompt: attempt === 0 ? prompt : `${prompt}\n\nYour previous response was not valid JSON. Try again.`,
      maxTokens,
    });

    try {
      const parsed = JSON.parse(extractJson(text));
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // fall through to retry / final error below
    }

    if (attempt === 1) {
      throw new Error(`AI response did not match the expected structure after 2 attempts. Raw: ${text.slice(0, 300)}`);
    }
  }

  // Unreachable, satisfies TypeScript's control-flow analysis.
  throw new Error("generateStructured: unreachable");
}
