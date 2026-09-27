import { AppError } from "@/server/shared/errors";

/**
 * Error codes for the customer-support domain (business_faqs CRUD,
 * the #9/#10 answer engine/chat API, and #13's setup request workflow).
 *
 * INVALID_TRANSITION covers both "that status change isn't allowed by the
 * state machine" and "the row's status changed between when we read it and
 * when we tried to update it" (see setup-requests.ts's compare-and-swap) —
 * from a caller's point of view both mean the same thing: the transition
 * you asked for didn't happen.
 */
export type CustomerSupportErrorCode = "NOT_FOUND" | "INVALID_TRANSITION" | "UNKNOWN";

export class CustomerSupportError extends AppError {
  declare readonly code: CustomerSupportErrorCode;

  constructor(code: CustomerSupportErrorCode, message: string, options?: { cause?: unknown }) {
    // Neither code is transient (a missing row or an unexpected DB error
    // won't resolve itself on retry), so nothing here is retryable.
    super("customer-support", code, message, { cause: options?.cause, retryable: false });
    this.name = "CustomerSupportError";
  }
}

export function isCustomerSupportError(error: unknown): error is CustomerSupportError {
  return error instanceof CustomerSupportError;
}
