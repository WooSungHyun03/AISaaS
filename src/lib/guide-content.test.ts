import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDES, GUIDE_SLUGS, getGuide, guideShotSrc } from "./guide-content";

describe("guide content", () => {
  it("covers the eight features in the agreed order", () => {
    expect(GUIDES.map((guide) => guide.slug)).toEqual([...GUIDE_SLUGS]);
    expect(GUIDES.map((guide) => guide.title)).toEqual(["마케팅 진단", "마케팅 캘린더", "블로그 제작", "광고 숏폼 제작", "성장 리포트", "내 마케팅 홈", "채널 연결", "결제 · 이용권 · 설정"]);
  });

  it("fills every section of every guide", () => {
    for (const guide of GUIDES) {
      for (const list of [guide.whoFor, guide.prepare, guide.steps, guide.inputs, guide.examples, guide.buttons, guide.results, guide.problems, guide.tips, guide.shots]) expect(list.length, guide.slug).toBeGreaterThan(0);
      expect(guide.what.length, guide.slug).toBeGreaterThan(20);
      expect(guide.enter.how.length, guide.slug).toBeGreaterThan(10);
    }
  });

  it("links every call to action and entry point to a real app page", () => {
    for (const guide of GUIDES) {
      for (const href of [guide.cta.href, guide.enter.href]) {
        expect(existsSync(path.join(process.cwd(), "src/app/(app)", href, "page.tsx")), `${guide.slug} → ${href}`).toBe(true);
      }
    }
  });

  it("only refers to screens and related guides that exist", () => {
    for (const guide of GUIDES) {
      const ids = guide.shots.map((shot) => shot.id);
      expect(new Set(ids).size, guide.slug).toBe(ids.length);
      for (const step of guide.steps) if (step.shot) expect(ids, `${guide.slug}: ${step.title}`).toContain(step.shot);
      // every screen is used by a step, so nothing is captured for nothing
      for (const id of ids) expect(guide.steps.some((step) => step.shot === id), `${guide.slug}/${id}`).toBe(true);
      for (const slug of guide.related) expect(getGuide(slug), `${guide.slug} → ${slug}`).toBeDefined();
      expect(guide.related).not.toContain(guide.slug);
    }
  });

  it("gives every screen alt text and a numbered caption", () => {
    for (const guide of GUIDES) {
      for (const shot of guide.shots) {
        expect(shot.alt.length, `${guide.slug}/${shot.id}`).toBeGreaterThan(15);
        expect(shot.caption, `${guide.slug}/${shot.id}`).toMatch(/①/);
      }
    }
  });

  it("ships a desktop and a phone capture for every screen under one path convention", () => {
    expect(guideShotSrc("blog", "photos")).toBe("/guide/blog/photos.png");
    expect(guideShotSrc("blog", "photos", "mobile")).toBe("/guide/blog/photos-m.png");
    for (const guide of GUIDES) {
      for (const shot of guide.shots) {
        for (const device of ["desktop", "mobile"] as const) {
          expect(existsSync(path.join(process.cwd(), "public", guideShotSrc(guide.slug, shot.id, device))), `${guide.slug}/${shot.id} ${device}`).toBe(true);
        }
      }
    }
  });

  it("returns undefined for an unknown slug", () => {
    expect(getGuide("nope")).toBeUndefined();
  });
});
