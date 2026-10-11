import { describe, expect, it } from "vitest";
import {
  MASCOT_POSES,
  MAX_SHORTS_REFERENCES,
  allowedShortsFormats,
  describeReferenceForPrompt,
  parseShortsReferenceSettings,
  referenceIndexes,
  type ShortsReference,
} from "./shorts-reference";

describe("parseShortsReferenceSettings", () => {
  it("defaults to no references, the automatic style and an empty brief", () => {
    expect(parseShortsReferenceSettings({})).toEqual({ references: [], style: "auto", brief: "" });
    expect(parseShortsReferenceSettings(null)).toEqual({ references: [], style: "auto", brief: "" });
  });

  it("keeps valid references and drops malformed, unknown-mascot and duplicate ones", () => {
    const settings = parseShortsReferenceSettings({
      shortsStyle: "promo",
      shortsBrief: "  신메뉴 홍보  ",
      references: [
        { id: "a", kind: "upload", source: "u/a/a.png", label: "사장님", subject: "person", summary: "웃는 사장님" },
        { id: "a", kind: "upload", source: "u/a/a2.png", label: "duplicate id" },
        { id: "m", kind: "mascot", source: "wave", label: "인사" },
        { id: "bad", kind: "mascot", source: "not-a-pose", label: "" },
        { id: "", kind: "upload", source: "x", label: "" },
        "junk",
      ],
    });
    expect(settings.style).toBe("promo");
    expect(settings.brief).toBe("신메뉴 홍보");
    expect(settings.references.map((item) => item.id)).toEqual(["a", "m"]);
    expect(settings.references[0]).toMatchObject({ subject: "person", summary: "웃는 사장님" });
  });

  it("never returns more than the maximum number of references", () => {
    const references = Array.from({ length: 20 }, (_, index) => ({ id: `r${index}`, kind: "upload", source: `p/${index}.png`, label: "" }));
    expect(parseShortsReferenceSettings({ references }).references).toHaveLength(MAX_SHORTS_REFERENCES);
  });

  it("accepts the four styles and falls back to auto for anything else", () => {
    for (const style of ["auto", "skit", "explainer", "promo"]) expect(parseShortsReferenceSettings({ shortsStyle: style }).style).toBe(style);
    expect(parseShortsReferenceSettings({ shortsStyle: "showcase" }).style).toBe("auto");
    expect(parseShortsReferenceSettings({ shortsStyle: 3 }).style).toBe("auto");
  });

  it("forces mascots to 'character' and leaves older uploads without a subject (they are detected when needed)", () => {
    const settings = parseShortsReferenceSettings({
      references: [
        { id: "old", kind: "upload", source: "u/a/old.png", label: "옛날 이미지" },
        { id: "m", kind: "mascot", source: "wave", label: "인사", subject: "product" },
      ],
    });
    expect(settings.references.map((item) => item.subject)).toEqual([undefined, "character"]);
  });
});

describe("describing images for the planner", () => {
  it("tags every image with what it shows and includes the summary and the owner's label", () => {
    for (const pose of MASCOT_POSES) {
      expect(describeReferenceForPrompt({ id: pose.key, kind: "mascot", source: pose.key, label: pose.label, subject: "character" })).toContain(pose.description);
    }
    expect(describeReferenceForPrompt({ id: "u", kind: "upload", source: "p", label: "소금빵", subject: "product", summary: "갓 구운 소금빵 클로즈업" }))
      .toBe("[product] 갓 구운 소금빵 클로즈업 (사장님 설명: 소금빵)");
    expect(describeReferenceForPrompt({ id: "u", kind: "upload", source: "p", label: "", subject: "place" })).toContain("[place]");
    expect(describeReferenceForPrompt({ id: "u", kind: "upload", source: "p", label: "" })).toContain("[other]");
    expect(describeReferenceForPrompt({ id: "u", kind: "upload", source: "p", label: "같음", subject: "other", summary: "같음" })).toBe("[other] 같음");
  });
});

describe("allowed formats", () => {
  const ref = (id: string, subject?: ShortsReference["subject"]): ShortsReference => ({ id, kind: "upload", source: id, label: "", subject });

  it("numbers the character and photo groups the way the AI sees them", () => {
    expect(referenceIndexes([ref("a", "character"), ref("b", "place"), ref("c", "character"), ref("d", "person"), ref("e")])).toEqual({ character: [1, 3], photo: [2, 4, 5] });
  });

  it("lets auto use whatever the images allow, and pinned styles only what they can satisfy", () => {
    const mixed = [ref("a", "character"), ref("b", "product")];
    expect(allowedShortsFormats(mixed, "auto")).toEqual(["character", "promo"]);
    expect(allowedShortsFormats(mixed, "skit")).toEqual(["character"]);
    expect(allowedShortsFormats(mixed, "explainer")).toEqual(["character"]);
    expect(allowedShortsFormats(mixed, "promo")).toEqual(["promo"]);
  });

  it("falls back to the available format when a pinned style has no matching image", () => {
    expect(allowedShortsFormats([ref("b", "product")], "skit")).toEqual(["promo"]);
    expect(allowedShortsFormats([ref("a", "character")], "promo")).toEqual(["character"]);
  });

  it("treats people and unknown images as photos, never as characters", () => {
    expect(allowedShortsFormats([ref("p", "person")], "auto")).toEqual(["promo"]);
    expect(allowedShortsFormats([ref("u")], "auto")).toEqual(["promo"]);
  });
});
