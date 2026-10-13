/**
 * Why a checkout could not even be started, reduced to a short, secret-free
 * code. Support gets a code that points at the real cause (a missing key, a
 * database that was not migrated, ...) instead of one catch-all, and the
 * owner gets a sentence they can act on. Never put an error message from a
 * provider or the database into a URL or a response — only these codes.
 */
import { isMissingSchemaError } from "@/server/shared/db-errors";

export type CheckoutStartFailureCode =
  | "BILLING_NOT_CONFIGURED"
  | "BILLING_CLIENT_KEY_MISSING"
  | "BILLING_SECRET_KEY_MISSING"
  | "BILLING_KEYS_NOT_TEST"
  | "BILLING_PROVIDER_MOCK"
  | "BILLING_SCHEMA_OUTDATED"
  | "BILLING_DB_ERROR"
  | "CHECKOUT_START_FAILED";

export interface CheckoutStartFailure {
  code: CheckoutStartFailureCode;
  /** Safe to log: a Postgres/PostgREST code or the error class, never a key or a token. */
  detail: string;
}

const CONFIGURATION_MESSAGE =
  /Missing required environment variable|accepts test keys only|모의 결제는 운영 환경|BILLING_PROVIDER|TOSS_SECRET_KEY/;

export function classifyCheckoutStartError(error: unknown): CheckoutStartFailure {
  const dbCode = typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : null;
  const message = error instanceof Error ? error.message : typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : "";

  if (isMissingSchemaError(error)) return { code: "BILLING_SCHEMA_OUTDATED", detail: dbCode ?? "schema" };
  // Each missing or wrong key has its own code, so support is told which one to fix instead of "not configured".
  const problem = typeof error === "object" && error !== null ? (error as { problem?: unknown }).problem : undefined;
  if (problem === "CLIENT_KEY_MISSING") return { code: "BILLING_CLIENT_KEY_MISSING", detail: "client_key" };
  if (problem === "SECRET_KEY_MISSING") return { code: "BILLING_SECRET_KEY_MISSING", detail: "secret_key" };
  if (problem === "KEYS_NOT_TEST") return { code: "BILLING_KEYS_NOT_TEST", detail: "key_mode" };
  if (/모의 결제는 운영 환경/.test(message)) return { code: "BILLING_PROVIDER_MOCK", detail: "mock_in_production" };
  if (CONFIGURATION_MESSAGE.test(message)) return { code: "BILLING_NOT_CONFIGURED", detail: error instanceof Error ? error.name : "ConfigError" };
  if (dbCode) return { code: "BILLING_DB_ERROR", detail: dbCode };
  return { code: "CHECKOUT_START_FAILED", detail: error instanceof Error ? error.name : "UnknownError" };
}
