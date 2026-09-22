import { describe, expect, it } from "vitest";
import { describeAutomationRunError } from "./automation-run-error";

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
