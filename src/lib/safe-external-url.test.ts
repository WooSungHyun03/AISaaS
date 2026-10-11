import { describe, expect, it } from "vitest";
import { safeExternalUrl } from "./safe-external-url";

describe("safeExternalUrl", () => {
  it("allows ordinary web links", () => {
    expect(safeExternalUrl("https://example.com/post")).toBe("https://example.com/post");
    expect(safeExternalUrl("http://example.com/post")).toBe("http://example.com/post");
  });

  it.each(["javascript:alert(1)", "data:text/html,test", "not a url", ""])("rejects unsafe or invalid input: %s", (value) => {
    expect(safeExternalUrl(value)).toBeNull();
  });
});
