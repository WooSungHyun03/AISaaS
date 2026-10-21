import "server-only";
import { serverEnv } from "@/lib/env/server";
import { AIProviderError } from "./errors";
import type { AIProvider } from "./provider";
import { MockAIProvider } from "./providers/mock";
import { OpenAIProvider } from "./providers/openai";
import { GeminiProvider } from "./providers/gemini";
import { AnthropicProvider } from "./providers/anthropic";

let cachedProvider: AIProvider | undefined;

/**
 * The mock provider is for development, tests and demo images: a production deployment must not serve its placeholders.
 * ALLOW_MOCK_AI lets a self-hosted demo image opt in, but it is ignored on Vercel's real production environment
 * (VERCEL_ENV=production): the variable exists in that project's Production scope, and a forgotten opt-in there must
 * never turn placeholder text into customers' "AI results".
 */
export function isMockAiBlocked(): boolean {
  if (serverEnv.AI_PROVIDER !== "mock" || process.env.NODE_ENV !== "production") return false;
  return process.env.VERCEL_ENV === "production" || serverEnv.ALLOW_MOCK_AI !== "true";
}

/** Stands in for the mock provider in production: every call fails with a clear, retryable-by-configuration error. */
class AiNotConnectedProvider implements AIProvider {
  readonly name = "not-connected";
  async generateText(): Promise<never> {
    throw new AIProviderError("MISSING_API_KEY", "ai", "AI service is not connected: AI_PROVIDER is still \"mock\" in production. Set AI_PROVIDER=anthropic and ANTHROPIC_API_KEY.");
  }
}

/** Picks the active AIProvider based on AI_PROVIDER. Cached per process. */
export function getAIProvider(): AIProvider {
  if (cachedProvider) return cachedProvider;
  if (isMockAiBlocked()) return new AiNotConnectedProvider();

  switch (serverEnv.AI_PROVIDER) {
    case "openai":
      cachedProvider = new OpenAIProvider();
      break;
    case "gemini":
      cachedProvider = new GeminiProvider();
      break;
    case "anthropic":
      cachedProvider = new AnthropicProvider();
      break;
    case "mock":
    default:
      cachedProvider = new MockAIProvider();
  }

  return cachedProvider;
}

export * from "./provider";
export * from "./generate";
export * from "./errors";
