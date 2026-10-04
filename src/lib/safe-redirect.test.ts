import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it("keeps normal in-app paths, including query strings", () => {
    expect(safeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("/billing?plan=PRO")).toBe("/billing?plan=PRO");
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/\r\n//evil.example", "evil.example", "", "javascript:alert(1)"])(
    "rejects %j",
    (value) => {
      expect(safeRedirectPath(value)).toBe("/dashboard");
    },
  );

  it("uses the supplied fallback", () => {
    expect(safeRedirectPath("//x", "/onboarding")).toBe("/onboarding");
  });
});
