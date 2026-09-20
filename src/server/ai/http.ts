import "server-only";
import { serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/logger";
import { AIProviderError } from "./errors";

export interface ProviderFetchOptions {
  /** Provider name used in error messages/logs, e.g. "openai" | "gemini". */
  provider: string;
  timeoutMs?: number;
  maxRetries?: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyResponseError(provider: string, response: Response, body: string): AIProviderError {
  if (response.status === 401 || response.status === 403) {
    return new AIProviderError(
      "MISSING_API_KEY",
      provider,
      `Authentication rejected (${response.status}) — check the configured API key.`,
    );
  }
  if (response.status === 429) {
    return new AIProviderError("RATE_LIMITED", provider, `Rate limited (429): ${body.slice(0, 300)}`);
  }
  if (response.status >= 500) {
    return new AIProviderError(
      "PROVIDER_UNAVAILABLE",
      provider,
      `Upstream error (${response.status}): ${body.slice(0, 300)}`,
    );
  }
  return new AIProviderError(
    "PROVIDER_UNAVAILABLE",
    provider,
    `Request failed (${response.status}): ${body.slice(0, 300)}`,
  );
}

/**
 * Shared fetch wrapper for AI providers: enforces a request timeout,
 * classifies failures into the standard AIErrorCode taxonomy, and applies a
 * small, bounded number of retries for transient failures only (never for
 * auth/validation errors). This is the one place both real providers
 * (openai.ts, gemini.ts) go through — Rule 10 (two real call sites justify
 * the shared abstraction).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  { provider, timeoutMs = serverEnv.AI_REQUEST_TIMEOUT_MS, maxRetries = serverEnv.AI_MAX_RETRIES }: ProviderFetchOptions,
): Promise<Response> {
  let lastError: AIProviderError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);

      if (response.ok) return response;

      const body = await response.text();
      const error = classifyResponseError(provider, response, body);
      if (!error.retryable || attempt === maxRetries) throw error;
      lastError = error;
    } catch (cause) {
      clearTimeout(timeout);

      if (cause instanceof AIProviderError) {
        if (!cause.retryable || attempt === maxRetries) throw cause;
        lastError = cause;
      } else if (cause instanceof Error && cause.name === "AbortError") {
        const error = new AIProviderError("TIMEOUT", provider, `Request timed out after ${timeoutMs}ms`, { cause });
        if (attempt === maxRetries) throw error;
        lastError = error;
      } else {
        const error = new AIProviderError("NETWORK_FAILURE", provider, "Network request failed", { cause });
        if (attempt === maxRetries) throw error;
        lastError = error;
      }
    }

    const backoffMs = 300 * 2 ** attempt;
    logger.warn("ai_provider_retry", {
      provider,
      attempt: attempt + 1,
      maxRetries,
      code: lastError?.code,
      backoffMs,
    });
    await sleep(backoffMs);
  }

  // Unreachable: the loop above always throws on its final attempt.
  throw lastError ?? new AIProviderError("PROVIDER_UNAVAILABLE", provider, "Request failed with no captured error");
}
