import { describe, expect, it } from "vitest";
import {
  buildRuleBasedRecommendations,
  collectPresentChannels,
  describeFreshness,
  describeSnsActivity,
  scoreMarketingSignals,
  type PageSignals,
} from "./scoring";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const DAY = 86_400_000;

const EMPTY: PageSignals = {
  isHttps: false,
  title: null,
  metaDescription: null,
  hasViewport: false,
  hasLang: false,
  hasOpenGraph: false,
  h1Count: 0,
  subheadingCount: 0,
  textLength: 0,
  hasContactInfo: false,
  hasCtaWording: false,
  latestDateMs: null,
  hasPostSignal: false,
  snsLinks: {},
};

const COMPLETE: PageSignals = {
  isHttps: true,
  title: "해온 카페 | 성수동 핸드드립 커피",
  metaDescription: "성수동에서 직접 로스팅한 원두로 내린 핸드드립 커피와 수제 디저트를 만나보세요.",
  hasViewport: true,
  hasLang: true,
  hasOpenGraph: true,
  h1Count: 1,
  subheadingCount: 3,
  textLength: 2400,
  hasContactInfo: true,
  hasCtaWording: true,
  latestDateMs: NOW.getTime() - 5 * DAY,
  hasPostSignal: true,
  snsLinks: { instagram: "https://instagram.com/a", naver_blog: "https://blog.naver.com/a", naver_place: "https://map.naver.com/p/1" },
};

describe("scoreMarketingSignals", () => {
  it("scores an empty page 0 and a complete page 100, with maxes that add up to 100", () => {
    const empty = scoreMarketingSignals(EMPTY, { now: NOW });
    const complete = scoreMarketingSignals(COMPLETE, { now: NOW });
    expect(empty.score).toBe(0);
    expect(complete.score).toBe(100);
    expect(complete.items.reduce((total, entry) => total + entry.max, 0)).toBe(100);
  });

  it("is deterministic and explains every item", () => {
    const a = scoreMarketingSignals(COMPLETE, { now: NOW });
    const b = scoreMarketingSignals(COMPLETE, { now: NOW });
    expect(a).toEqual(b);
    for (const entry of a.items) expect(entry.detail).toMatch(/\S/);
  });

  it("gives partial credit only where the rubric defines it", () => {
    const result = scoreMarketingSignals({ ...COMPLETE, h1Count: 2, textLength: 500 }, { now: NOW });
    const byKey = Object.fromEntries(result.items.map((entry) => [entry.key, entry.points]));
    expect(byKey.h1).toBe(2);
    expect(byKey["content-length"]).toBe(4);
  });

  it("decays freshness by age and treats a dateless post area as weak evidence", () => {
    const points = (latestDateMs: number | null, hasPostSignal = false) =>
      scoreMarketingSignals({ ...COMPLETE, latestDateMs, hasPostSignal }, { now: NOW }).items.find((entry) => entry.key === "freshness")!.points;
    expect(points(NOW.getTime() - 10 * DAY)).toBe(20);
    expect(points(NOW.getTime() - 60 * DAY)).toBe(12);
    expect(points(NOW.getTime() - 200 * DAY)).toBe(5);
    expect(points(NOW.getTime() - 800 * DAY)).toBe(0);
    expect(points(null, true)).toBe(6);
    expect(points(null, false)).toBe(0);
  });

  it("counts channels from the site, the saved profile and connected accounts, without double counting", () => {
    const present = collectPresentChannels({ instagram: "x" }, { instagram: "y", youtube: "z", blog: "legacy" }, ["instagram", "youtube", "email"]);
    expect(present.sort()).toEqual(["instagram", "naver_blog", "youtube"]);
  });

  it("reports missing core channels (facebook is not a core channel)", () => {
    const result = scoreMarketingSignals({ ...COMPLETE, snsLinks: { instagram: "x", facebook: "y" } }, { now: NOW });
    expect(result.missingChannels).toEqual(["naver_blog", "naver_place", "youtube", "kakao_channel"]);
  });
});

describe("buildRuleBasedRecommendations", () => {
  it("returns nothing for a perfect page", () => {
    expect(buildRuleBasedRecommendations(scoreMarketingSignals(COMPLETE, { now: NOW }))).toEqual([]);
  });

  it("orders suggestions by points lost and caps the list", () => {
    const result = scoreMarketingSignals(EMPTY, { now: NOW });
    const recommendations = buildRuleBasedRecommendations(result, 3);
    expect(recommendations).toHaveLength(3);
    // channels (20) and freshness (20) are the biggest losses; contact/CTA (10 each) follow.
    expect(recommendations.some((text) => text.includes("채널"))).toBe(true);
  });
});

describe("honest descriptions", () => {
  it("never claims SNS activity numbers it cannot know", () => {
    expect(describeSnsActivity([])).toContain("찾지 못했어요");
    const text = describeSnsActivity(["instagram"], ["instagram"]);
    expect(text).toContain("인스타그램");
    expect(text).toContain("확인할 수 없어서 점수에 넣지 않았어요");
    expect(text).not.toMatch(/\d+\s*(%|건|개의 게시물)/);
  });

  it("describes freshness from the measured date only", () => {
    expect(describeFreshness({ latestDateMs: NOW.getTime() - 3 * DAY, hasPostSignal: true }, NOW)).toContain("3일 전");
    expect(describeFreshness({ latestDateMs: null, hasPostSignal: false }, NOW)).toContain("찾지 못했어요");
  });
});
