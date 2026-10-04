import { describe, expect, it } from "vitest";
import { safeEqual } from "./secret";

describe("safeEqual", () => {
  it("matches equal strings only", () => {
    expect(safeEqual("secret-value", "secret-value")).toBe(true);
    expect(safeEqual("secret-value", "secret-valuf")).toBe(false);
    expect(safeEqual("short", "a-much-longer-value")).toBe(false);
  });

  it("never matches a missing value, even against an empty string", () => {
    expect(safeEqual(null, "x")).toBe(false);
    expect(safeEqual(undefined, undefined)).toBe(false);
    expect(safeEqual("", null)).toBe(false);
  });
});
