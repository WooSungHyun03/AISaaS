/**
 * The mock AI provider answers a prompt it has no canned reply for with a placeholder that starts with this
 * marker. Nothing a customer reads may ever contain it: code that shows free-form AI text checks it and falls back
 * to a summary built from real data instead.
 */
export const MOCK_AI_MARKER = "[MOCK AI RESPONSE]";

export function isMockAiText(text: string | null | undefined): boolean {
  return typeof text === "string" && text.includes(MOCK_AI_MARKER);
}
