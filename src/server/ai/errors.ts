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

export class AIProviderError extends Error {
  readonly code: AIErrorCode;
  readonly provider: string;
  readonly retryable: boolean;

  constructor(code: AIErrorCode, provider: string, message: string, options?: { cause?: unknown }) {
    super(`[${provider}] ${message}`, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AIProviderError";
    this.code = code;
    this.provider = provider;
    this.retryable = RETRYABLE_CODES.has(code);
  }
}

export function isAIProviderError(error: unknown): error is AIProviderError {
  return error instanceof AIProviderError;
}
