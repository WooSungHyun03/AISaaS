import { describe, expect, it, vi } from "vitest";
import { classifyCheckoutStartError } from "./checkout-errors";
import { TossConfigError } from "./toss-keys";

vi.mock("@/lib/env/client", () => ({ clientEnv: {} }));
vi.mock("@/lib/env/server", () => ({ serverEnv: {} }));

describe("classifyCheckoutStartError", () => {
  it("flags a database that was not migrated (missing column/table/function)", () => {
    for (const code of ["42703", "42P01", "PGRST204", "PGRST205", "PGRST202"]) {
      expect(classifyCheckoutStartError({ code, message: 'column "product_id" does not exist' })).toEqual({
        code: "BILLING_SCHEMA_OUTDATED",
        detail: code,
      });
    }
  });

  it("flags missing or live payment keys as a configuration problem", () => {
    expect(classifyCheckoutStartError(new Error("Missing required environment variable: TOSS_SECRET_KEY.")).code).toBe("BILLING_NOT_CONFIGURED");
    expect(classifyCheckoutStartError(new Error("Toss billing currently accepts test keys only. Configure test client and secret keys.")).code).toBe("BILLING_NOT_CONFIGURED");
  });

  it("tells apart which key is missing, a live key, and a mock provider in production", () => {
    expect(classifyCheckoutStartError(new TossConfigError("CLIENT_KEY_MISSING"))).toEqual({ code: "BILLING_CLIENT_KEY_MISSING", detail: "client_key" });
    expect(classifyCheckoutStartError(new TossConfigError("SECRET_KEY_MISSING"))).toEqual({ code: "BILLING_SECRET_KEY_MISSING", detail: "secret_key" });
    expect(classifyCheckoutStartError(new TossConfigError("KEYS_NOT_TEST"))).toEqual({ code: "BILLING_KEYS_NOT_TEST", detail: "key_mode" });
    expect(classifyCheckoutStartError(new Error("모의 결제는 운영 환경에서 사용할 수 없습니다.")).code).toBe("BILLING_PROVIDER_MOCK");
  });

  it("keeps other database failures apart from configuration", () => {
    expect(classifyCheckoutStartError({ code: "23505", message: "duplicate key" })).toEqual({ code: "BILLING_DB_ERROR", detail: "23505" });
  });

  it("falls back without leaking the message", () => {
    const result = classifyCheckoutStartError(new TypeError("fetch failed https://secret.example/?key=abc"));
    expect(result).toEqual({ code: "CHECKOUT_START_FAILED", detail: "TypeError" });
    expect(JSON.stringify(result)).not.toContain("secret.example");
  });
});
