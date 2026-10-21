import { describe, expect, it } from "vitest";
import { uniqueTexts } from "./text";

describe("uniqueTexts", () => {
  it("keeps the first of each value, in order (the AI sometimes repeats a keyword)", () => {
    expect(uniqueTexts(["소금빵", "성수동빵집", "소금빵", "아침빵", "성수동빵집"])).toEqual(["소금빵", "성수동빵집", "아침빵"]);
  });

  it("treats case and surrounding spaces as the same value, and drops empty ones", () => {
    expect(uniqueTexts(["Bread", " bread ", "", "  ", "BREAD", "salt"])).toEqual(["Bread", "salt"]);
  });

  it("returns an empty list for an empty list and never changes the input", () => {
    const input = ["a", "a"];
    expect(uniqueTexts([])).toEqual([]);
    uniqueTexts(input);
    expect(input).toEqual(["a", "a"]);
  });
});
