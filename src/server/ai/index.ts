import "server-only";
import { serverEnv } from "@/lib/env/server";
import type { AIProvider } from "./provider";
import { MockAIProvider } from "./providers/mock";
import { OpenAIProvider } from "./providers/openai";
import { GeminiProvider } from "./providers/gemini";

let cachedProvider: AIProvider | undefined;

/** Picks the active AIProvider based on AI_PROVIDER. Cached per process. */
export function getAIProvider(): AIProvider {
  if (cachedProvider) return cachedProvider;

  switch (serverEnv.AI_PROVIDER) {
    case "openai":
      cachedProvider = new OpenAIProvider();
      break;
    case "gemini":
      cachedProvider = new GeminiProvider();
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
