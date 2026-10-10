import { describe, expect, it } from "vitest";
import {
  allowedShortsFormats,
  referenceIndexes,
  MASCOT_POSES,
  MAX_SHORTS_REFERENCES,
  describeReferenceForPrompt,
  parseShortsReferenceSettings,
} from "./shorts-reference";

describe("parseShortsReferenceSettings", () => {
  it("defaults to no references, skit style and an empty brief", () => {
    expect(parseShortsReferenceSettings({})).toEqual({ references: [], style: "auto", brief: "" });
    expect(parseShortsReferenceSettings(null)).toEqual({ references: [], style: "auto", brief: "" });
  });

  it("keeps valid references and drops malformed, unknown-mascot and duplicate ones", () => {
    const settings = parseShortsReferenceSettings({
      shortsStyle: "explainer",
      shortsBrief: "  신메뉴 홍보  ",
      references: [
        { id: "a", kind: "upload", source: "u/a/a.png", label: "사장님", subject: "other" },
        { id: "a", kind: "upload", source: "u/a/a2.png", label: "duplicate id", subject: "other" },
        { id: "m", kind: "mascot", source: "wave", label: "인사", subject: "character" },
        { id: "bad", kind: "mascot", source: "not-a-pose", label: "", subject: "character" },
        { id: "", kind: "upload", source: "x", label: "", subject: "other" },
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
      expect(describeReferenceForPrompt({ id: pose.key, kind: "mascot", source: pose.key, label: pose.label, subject: "character" })).toContain(pose.description);
    }
    expect(describeReferenceForPrompt({ id: "u", kind: "upload", source: "p", label: "놀란 고양이", subject: "character" })).toBe("[character] 놀란 고양이");
    expect(describeReferenceForPrompt({ id: "u", kind: "upload", source: "p", label: "", subject: "place" })).toContain("[place]");
  });
});

describe("reference subjects and allowed formats", () => {
  const ref = (id: string, subject: "character" | "product" | "place" | "person" | "other") => ({ id, kind: "upload" as const, source: id, label: "", subject });

  it("treats older uploads without a subject as 'other' and forces mascots to 'character'", () => {
    const settings = parseShortsReferenceSettings({
      references: [
        { id: "old", kind: "upload", source: "u/a/old.png", label: "옛날 이미지" },
        { id: "m", kind: "mascot", source: "wave", label: "인사", subject: "product" },
      ],
    });
    expect(settings.references.map((item) => item.subject)).toEqual(["other", "character"]);
  });

  it("numbers the character and photo groups the way the AI sees them", () => {
    expect(referenceIndexes([ref("a", "character"), ref("b", "place"), ref("c", "character"), ref("d", "person")])).toEqual({ character: [1, 3], photo: [2, 4] });
  });

  it("lets auto use whatever the images allow, and pinned styles only what they can satisfy", () => {
    const both = [ref("a", "character"), ref("b", "place")];
    expect(allowedShortsFormats(both, "auto")).toEqual(["character", "showcase"]);
    expect(allowedShortsFormats(both, "skit")).toEqual(["character"]);
    expect(allowedShortsFormats(both, "explainer")).toEqual(["character"]);
    expect(allowedShortsFormats(both, "showcase")).toEqual(["showcase"]);
  });

  it("falls back to the available format when a pinned style has no matching image", () => {
    expect(allowedShortsFormats([ref("b", "product")], "skit")).toEqual(["showcase"]);
    expect(allowedShortsFormats([ref("a", "character")], "showcase")).toEqual(["character"]);
    expect(allowedShortsFormats([ref("a", "character"), ref("p", "person")], "auto")).toEqual(["character", "showcase"]);
  });

  it("never offers character animation for person photos", () => {
    expect(allowedShortsFormats([ref("p", "person")], "auto")).toEqual(["showcase"]);
  });
});
