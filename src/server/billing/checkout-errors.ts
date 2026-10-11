/**
 * Why a checkout could not even be started, reduced to a short, secret-free
 * code. Support gets a code that points at the real cause (a missing key, a
 * database that was not migrated, ...) instead of one catch-all, and the
 * owner gets a sentence they can act on. Never put an error message from a
 * provider or the database into a URL or a response — only these codes.
 */
export type CheckoutStartFailureCode =
  | "BILLING_NOT_CONFIGURED"
  | "BILLING_SCHEMA_OUTDATED"
  | "BILLING_DB_ERROR"
  | "CHECKOUT_START_FAILED";

export interface CheckoutStartFailure {
  code: CheckoutStartFailureCode;
  /** Safe to log: a Postgres/PostgREST code or the error class, never a key or a token. */
  detail: string;
}

/** Postgres "undefined column/table/function" and PostgREST schema-cache misses: the code expects a newer database. */
const SCHEMA_ERROR_CODES = new Set(["42703", "42P01", "42883", "PGRST200", "PGRST202", "PGRST204", "PGRST205"]);

const CONFIGURATION_MESSAGE =
  /Missing required environment variable|accepts test keys only|모의 결제는 운영 환경|BILLING_PROVIDER|TOSS_SECRET_KEY/;

export function classifyCheckoutStartError(error: unknown): CheckoutStartFailure {
  const dbCode = typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : null;
  const message = error instanceof Error ? error.message : typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : "";

  if (dbCode && SCHEMA_ERROR_CODES.has(dbCode)) return { code: "BILLING_SCHEMA_OUTDATED", detail: dbCode };
  if (CONFIGURATION_MESSAGE.test(message)) return { code: "BILLING_NOT_CONFIGURED", detail: error instanceof Error ? error.name : "ConfigError" };
  if (dbCode) return { code: "BILLING_DB_ERROR", detail: dbCode };
  return { code: "CHECKOUT_START_FAILED", detail: error instanceof Error ? error.name : "UnknownError" };
}
