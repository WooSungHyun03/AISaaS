import { afterEach, describe, expect, it, vi } from "vitest";
import { logger, redact } from "./index";

afterEach(() => vi.restoreAllMocks());

describe("redact", () => {
  it("hides values under sensitive-looking keys at any depth", () => {
    expect(redact({ userId: "u1", accessToken: "abc", nested: { apiKey: "k", Authorization: "Bearer x", ok: 1 } })).toEqual({
      userId: "u1",
      accessToken: "[redacted]",
      nested: { apiKey: "[redacted]", Authorization: "[redacted]", ok: 1 },
    });
  });

  it("keeps ids, codes and durations that production debugging needs", () => {
    const context = { runId: "r1", businessId: "b1", feature: "blog-marketing", errorCode: "TIMEOUT", durationMs: 1234 };
    expect(redact(context)).toEqual(context);
  });

  it("truncates long strings and deep nesting, and flattens errors to name+message", () => {
    expect(String(redact("x".repeat(5000))).length).toBeLessThan(2100);
    expect(redact({ a: { b: { c: { d: { e: 1 } } } } })).toEqual({ a: { b: { c: { d: "[truncated]" } } } });
    expect(redact(new Error("boom"))).toEqual({ name: "Error", message: "boom" });
  });
});

describe("logger", () => {
  it("writes one JSON line with level, message, time and the redacted context", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("automation_run_failed", { runId: "r1", providerToken: "secret-value" });
    const line = JSON.parse(String(spy.mock.calls[0][0]));
    expect(line).toMatchObject({ level: "error", message: "automation_run_failed", runId: "r1", providerToken: "[redacted]" });
    expect(JSON.stringify(line)).not.toContain("secret-value");
  });
});
