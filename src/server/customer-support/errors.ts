import { AppError } from "@/server/shared/errors";

/**
 * Error codes for the customer-support domain (business_faqs CRUD today;
 * the #9/#10 answer engine and chat API will reuse this too).
 */
export type CustomerSupportErrorCode = "NOT_FOUND" | "UNKNOWN";

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
