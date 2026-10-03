import { describe, expect, it } from "vitest";
import { mergeBusinessDefault, mergeSnsLinks } from "./prefill";

describe("mergeBusinessDefault", () => {
  it("keeps the business's own saved value, ignoring the AI suggestion entirely", () => {
    expect(mergeBusinessDefault("기존 강점", "AI가 제안한 강점")).toBe("기존 강점");
  });

  it("falls back to the AI suggestion only when there is no saved value", () => {
    expect(mergeBusinessDefault(null, "AI가 제안한 강점")).toBe("AI가 제안한 강점");
    expect(mergeBusinessDefault(undefined, "AI가 제안한 강점")).toBe("AI가 제안한 강점");
    expect(mergeBusinessDefault("", "AI가 제안한 강점")).toBe("AI가 제안한 강점");
    expect(mergeBusinessDefault("   ", "AI가 제안한 강점")).toBe("AI가 제안한 강점");
  });

  it("returns an empty string when neither a saved value nor a suggestion exists — never undefined/null, so it's a safe <input defaultValue>", () => {
    expect(mergeBusinessDefault(null, null)).toBe("");
    expect(mergeBusinessDefault(undefined, undefined)).toBe("");
  });
});

describe("mergeSnsLinks", () => {
  it("keeps each saved link independently and only fills the ones missing", () => {
    const current = { instagram: "https://instagram.com/saved" };
    const suggestion = { instagram: "https://instagram.com/suggested", blog: "https://blog.naver.com/suggested" };

    expect(mergeSnsLinks(current, suggestion)).toEqual({
      instagram: "https://instagram.com/saved",
      blog: "https://blog.naver.com/suggested",
      facebook: undefined,
      youtube: undefined,
    });
  });

  it("handles no saved links and no suggestions at all", () => {
    expect(mergeSnsLinks(null, null)).toEqual({
      instagram: undefined,
      facebook: undefined,
      youtube: undefined,
      blog: undefined,
    });
  });
});
