import { describe, expect, it } from "vitest";
import {
  MASCOT_POSES,
  MAX_SHORTS_REFERENCES,
  describeReferenceForPrompt,
  parseShortsReferenceSettings,
} from "./shorts-reference";

describe("parseShortsReferenceSettings", () => {
  it("defaults to no references, skit style and an empty brief", () => {
    expect(parseShortsReferenceSettings({})).toEqual({ references: [], style: "skit", brief: "" });
    expect(parseShortsReferenceSettings(null)).toEqual({ references: [], style: "skit", brief: "" });
  });

  it("keeps valid references and drops malformed, unknown-mascot and duplicate ones", () => {
    const settings = parseShortsReferenceSettings({
      shortsStyle: "explainer",
      shortsBrief: "  신메뉴 홍보  ",
      references: [
        { id: "a", kind: "upload", source: "u/a/a.png", label: "사장님" },
        { id: "a", kind: "upload", source: "u/a/a2.png", label: "duplicate id" },
        { id: "m", kind: "mascot", source: "wave", label: "인사" },
        { id: "bad", kind: "mascot", source: "not-a-pose", label: "" },
        { id: "", kind: "upload", source: "x", label: "" },
        "junk",
      ],
    });
    expect(settings.style).toBe("explainer");
    expect(settings.brief).toBe("신메뉴 홍보");
    expect(settings.references.map((item) => item.id)).toEqual(["a", "m"]);
  });

  it("never returns more than the maximum number of references", () => {
    const references = Array.from({ length: 20 }, (_, index) => ({ id: `r${index}`, kind: "upload", source: `p/${index}.png`, label: "" }));
    expect(parseShortsReferenceSettings({ references }).references).toHaveLength(MAX_SHORTS_REFERENCES);
  });

  it("ships a pose description for every mascot image", () => {
    for (const pose of MASCOT_POSES) {
      expect(describeReferenceForPrompt({ id: pose.key, kind: "mascot", source: pose.key, label: pose.label })).toContain(pose.description);
    }
    expect(describeReferenceForPrompt({ id: "u", kind: "upload", source: "p", label: "놀란 고양이" })).toBe("놀란 고양이");
    expect(describeReferenceForPrompt({ id: "u", kind: "upload", source: "p", label: "" })).toContain("참고 이미지");
  });
});
