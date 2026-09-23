import { describe, expect, it } from "vitest";
import { AppError, ConnectorError, describeAutomationRunError, isAppError, isConnectorError } from "./errors";

describe("AppError / ConnectorError", () => {
  it("marks connector errors retryable only for transient codes", () => {
    expect(new ConnectorError("wordpress", "TIMEOUT", "x").retryable).toBe(true);
    expect(new ConnectorError("wordpress", "UPSTREAM_SERVER_ERROR", "x").retryable).toBe(true);
    expect(new ConnectorError("wordpress", "NETWORK_FAILURE", "x").retryable).toBe(true);
    expect(new ConnectorError("wordpress", "NOT_CONFIGURED", "x").retryable).toBe(false);
    expect(new ConnectorError("wordpress", "AUTH_FAILED", "x").retryable).toBe(false);
  });

  it("is identifiable via isAppError/isConnectorError but not confused with a plain Error", () => {
    const connectorError = new ConnectorError("wordpress", "NOT_CONFIGURED", "not set up");
    expect(isAppError(connectorError)).toBe(true);
    expect(isConnectorError(connectorError)).toBe(true);
    expect(isConnectorError(new Error("plain"))).toBe(false);
    expect(isAppError(new Error("plain"))).toBe(false);
  });

  it("carries domain/code for structured logging", () => {
    const error = new ConnectorError("wordpress", "AUTH_FAILED", "bad credentials");
    expect(error).toBeInstanceOf(AppError);
    expect(error.domain).toBe("wordpress");
    expect(error.code).toBe("AUTH_FAILED");
  });
});

describe("describeAutomationRunError", () => {
  it("explains WordPress authentication failures without exposing the raw error", () => {
    const raw = "WordPress publish failed (HTTP 401): secret=abc";
    const result = describeAutomationRunError(raw);
    expect(result).toContain("WordPress 인증");
    expect(result).not.toContain("secret=abc");
  });

  it("gives actionable messages for AI rate limits and unknown failures", () => {
    expect(describeAutomationRunError("[openai] Rate limited (429)")).toContain("잠시 후");
    expect(describeAutomationRunError("sensitive stack trace")).not.toContain("stack trace");
  });
});
