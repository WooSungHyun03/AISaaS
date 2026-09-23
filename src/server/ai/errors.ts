import { AppError } from "@/server/shared/errors";

/**
 * Standard error taxonomy for AI provider calls. Automation handlers only
 * ever need to branch on `code` — they never need to know whether the
 * underlying failure came from OpenAI, Gemini, or a network layer.
 */
export type AIErrorCode =
  | "MISSING_API_KEY"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_STRUCTURED_RESPONSE"
  | "NETWORK_FAILURE";

const RETRYABLE_CODES: ReadonlySet<AIErrorCode> = new Set([
  "TIMEOUT",
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "NETWORK_FAILURE",
]);

/** AI-domain specialization of the shared `AppError` (src/server/shared/errors.ts). */
export class AIProviderError extends AppError {
  declare readonly code: AIErrorCode;
  readonly provider: string;

  constructor(code: AIErrorCode, provider: string, message: string, options?: { cause?: unknown }) {
    super(provider, code, `[${provider}] ${message}`, { cause: options?.cause, retryable: RETRYABLE_CODES.has(code) });
    this.name = "AIProviderError";
    this.provider = provider;
  }
}

export function isAIProviderError(error: unknown): error is AIProviderError {
  return error instanceof AIProviderError;
}
