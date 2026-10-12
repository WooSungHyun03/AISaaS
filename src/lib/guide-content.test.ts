import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDES, getGuide } from "./guide-content";

describe("guide content", () => {
  it("covers the four features in the agreed order", () => {
    expect(GUIDES.map((guide) => guide.slug)).toEqual(["diagnosis", "calendar", "blog", "shorts"]);
  });

  it("fills every section of every guide", () => {
    for (const guide of GUIDES) {
      for (const list of [guide.whoFor, guide.prepare, guide.steps, guide.inputs, guide.results, guide.tips]) expect(list.length, guide.slug).toBeGreaterThan(0);
      expect(guide.what.length, guide.slug).toBeGreaterThan(20);
    }
  });

  it("links every call to action to a real app page", () => {
    for (const guide of GUIDES) {
      const page = path.join(process.cwd(), "src/app/(app)", guide.cta.href, "page.tsx");
      expect(existsSync(page), guide.cta.href).toBe(true);
    }
  });

  it("returns undefined for an unknown slug", () => {
    expect(getGuide("nope")).toBeUndefined();
  });
});
