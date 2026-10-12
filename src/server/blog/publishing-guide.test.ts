import { describe, expect, it } from "vitest";
import type { BlogPost } from "./post";
import {
  buildImagePlacements,
  buildPublishingGuide,
  buildSeo,
  buildStyleGuide,
  contrastOnWhite,
  formatTags,
  fullPublishingGuideText,
  recommendedImageCount,
  themeFromStyle,
  type BlogGuideContext,
} from "./publishing-guide";
import { renderBlogHtml } from "./render";

const post: BlogPost = {
  title: "성수동 소금빵 맛집, 아침에 먼저 가는 이유",
  sections: [
    { blocks: [{ type: "paragraph", text: "아침 일찍 구운 **소금빵** 이야기예요." }, { type: "photo", slot: "가게 외관", caption: "" }, { type: "paragraph", text: "두 번째 문단이에요." }] },
    { heading: "🥐 겉바속촉 비결", blocks: [{ type: "paragraph", text: "버터를 아끼지 않아요." }, { type: "photo", slot: "소금빵 단면 클로즈업", caption: "갓 구운 단면" }, { type: "list", style: "check", items: ["버터", "천일염"] }] },
    { heading: "📍 오시는 길", blocks: [{ type: "list", style: "bullet", items: ["성수역 3번 출구", "도보 5분"] }, { type: "photo", slot: "가는 길 골목", caption: "" }] },
    { blocks: [{ type: "paragraph", text: "곧 만나요." }] },
  ],
  hashtags: [],
};

const store: BlogGuideContext = { platform: "naver", promotionType: "STORE", businessName: "우리동네 빵집", industry: "베이커리", location: "서울 성동구 성수동", tone: "친근한", keywords: ["소금빵", "성수동 빵집"] };

describe("style guide", () => {
  it("keeps colours readable and falls back when the model proposes an unreadable or malformed one", () => {
    const style = buildStyleGuide(store, { headingColor: "#FFFF00", bodyColor: "red", emphasisColor: "#DC2626", titleColor: "#111111" });
    expect(contrastOnWhite(style.heading.color)).toBeGreaterThanOrEqual(4.5);
    expect(style.body.color).toBe("#374151");
    expect(style.emphasis.color).toBe("#DC2626");
    expect(style.title.color).toBe("#111111");
  });

  it("only recommends sizes and fonts the Naver editor offers, and clamps a wild line height", () => {
    const style = buildStyleGuide(store, { bodySize: 17, headingSize: 22, titleSize: 29, lineHeight: 5, fontFamily: "Pretendard" });
    expect([15, 16]).toContain(style.body.sizePx);
    expect([19, 24]).toContain(style.heading.sizePx);
    expect([24, 28, 30]).toContain(style.title.sizePx);
    expect(style.body.lineHeight).toBe(2);
    expect(style.fontFamily).toBe("나눔고딕");
    expect(style.fontNote).toContain("Pretendard");
    expect(style.caption.align).toBe("center");
  });

  it("differs by promotion type and platform, so not every post gets the same look", () => {
    const product = buildStyleGuide({ ...store, promotionType: "PRODUCT" });
    const platform = buildStyleGuide({ ...store, promotionType: "PLATFORM", platform: "tistory" });
    expect(product.heading.color).not.toBe(buildStyleGuide(store).heading.color);
    expect(platform.fontFamily).toBe("스킨 기본 글꼴");
    expect(platform.platform).toBe("tistory");
  });

  it("drives a styled preview whose HTML uses the guide's colours and numbers the photo spots", () => {
    const style = buildStyleGuide(store, { headingColor: "#1D4ED8" });
    const html = renderBlogHtml(post, "naver", themeFromStyle(style));
    expect(html).toContain("#1D4ED8");
    expect(html).toContain("이미지 1 삽입 자리");
    expect(html).toContain("이미지 3 삽입 자리");
  });
});

describe("image placements", () => {
  it("reads each position from the post itself, in order", () => {
    const placements = buildImagePlacements(post, undefined, store);
    expect(placements.map((item) => item.number)).toEqual([1, 2, 3]);
    expect(placements[0]).toMatchObject({ sectionLabel: "도입부", afterLabel: "첫 번째 문단 다음", description: "가게 외관" });
    expect(placements[1]).toMatchObject({ sectionLabel: "소제목 “🥐 겉바속촉 비결”", afterLabel: "첫 번째 문단 다음", caption: "갓 구운 단면" });
    expect(placements[2].afterLabel).toBe("목록 다음");
    expect(placements[0].afterExcerpt).toContain("소금빵");
  });

  it("follows the owner's edits: removing a photo spot renumbers the rest", () => {
    const edited: BlogPost = { ...post, sections: post.sections.map((section) => ({ ...section, blocks: section.blocks.filter((block) => !(block.type === "photo" && block.slot === "가게 외관")) })) };
    const placements = buildImagePlacements(edited, undefined, store);
    expect(placements).toHaveLength(2);
    expect(placements[0].number).toBe(1);
    expect(placements[0].description).toBe("소금빵 단면 클로즈업");
  });

  it("uses the image kinds of the promotion type and prefers images the owner already uploaded", () => {
    const owned = [{ label: "매장 전경", subject: "place" }, { label: "소금빵 사진", subject: "product" }];
    const store1 = buildImagePlacements(post, undefined, { ...store, ownedImages: owned });
    expect(store1[0].type).toBe("매장 외관");
    expect(store1[0].ownedImage).toBe("매장 전경");
    expect(store1[1].ownedImage).toBe("소금빵 사진");
    expect(store1[2].ownedImage).toBeNull();

    const product = buildImagePlacements(post, undefined, { ...store, promotionType: "PRODUCT" });
    expect(product[0].type).toBe("제품 전체 사진");
    const platform = buildImagePlacements(post, undefined, { ...store, promotionType: "PLATFORM" });
    expect(platform[0].type).toBe("서비스 첫 화면");
  });

  it("does not make up pictures: an alt text is a description, and a claim or keyword list is replaced", () => {
    const guide = buildPublishingGuide(post, store, { images: [{ index: 1, altText: "최고의 소금빵, 맛집, 빵집, 성수" }, { index: 2, altText: "소금빵 단면 사진", ratio: "21:9" }] });
    expect(guide.images[0].altText).toBe("우리동네 빵집 가게 외관");
    expect(guide.images[1].altText).toBe("소금빵 단면 사진");
    expect(guide.images[1].ratio).toBe("4:3");
  });

  it("recommends picture counts by length", () => {
    expect(recommendedImageCount(1_500)).toEqual({ min: 3, max: 5 });
    expect(recommendedImageCount(4_000).max).toBeLessThanOrEqual(10);
  });
});

describe("SEO", () => {
  it("keeps only tags and keywords that the owner chose or that are in the post, and drops claims from titles", () => {
    const seo = buildSeo(post, store, {
      primaryKeyword: "소금빵",
      secondaryKeywords: ["크루아상", "버터", "서울 최저가"],
      tags: ["소금빵", "천일염", "강남맛집", "#성수동빵집", "최고의빵"],
      titleCandidates: ["성수동 빵집 소금빵, 아침에 가야 하는 이유", "최고의 소금빵 1등 가게"],
      metaDescription: "짧음",
    });
    expect(seo.tags).toContain("소금빵");
    expect(seo.tags).toContain("천일염");
    expect(seo.tags).not.toContain("강남맛집");
    expect(seo.tags).not.toContain("최고의빵");
    expect(seo.secondaryKeywords).not.toContain("크루아상");
    expect(seo.secondaryKeywords).toContain("버터");
    expect(seo.titleCandidates).toEqual([post.title, "성수동 빵집 소금빵, 아침에 가야 하는 이유"]);
    expect(seo.metaDescription.length).toBeGreaterThan(20);
  });

  it("gives region keywords only to a store with a location", () => {
    expect(buildSeo(post, store).regionKeywords.length).toBeGreaterThan(0);
    expect(buildSeo(post, { ...store, promotionType: "PRODUCT" }).regionKeywords).toEqual([]);
    expect(buildSeo(post, { ...store, location: null }).regionKeywords).toEqual([]);
  });

  it("states a search intent that fits the promotion type", () => {
    expect(buildSeo(post, store).searchIntent).toBe("방문·위치 확인");
    expect(buildSeo(post, { ...store, promotionType: "PRODUCT" }).searchIntent).toBe("비교·구매");
    expect(buildSeo(post, { ...store, promotionType: "PLATFORM" }).searchIntent).toBe("가입·사용 방법");
  });

  it("formats tags the way each blog takes them", () => {
    expect(formatTags(["소금빵", "성수"], "naver")).toBe("#소금빵 #성수");
    expect(formatTags(["소금빵", "성수"], "tistory")).toBe("소금빵,성수");
  });
});

describe("whole guide", () => {
  it("builds a complete guide from rules alone (older posts, or when the AI part failed)", () => {
    const guide = buildPublishingGuide(post, store);
    expect(guide.source).toBe("rules");
    expect(guide.images).toHaveLength(3);
    expect(guide.seo.tags.length).toBeGreaterThan(0);
  });

  it("copies everything in one text: body with numbered picture marks, style, pictures and SEO", () => {
    const guide = buildPublishingGuide(post, store);
    const text = fullPublishingGuideText({ title: post.title, post, guide, placements: buildImagePlacements(post, guide.images, store) });
    expect(text).toContain("[이미지 1 삽입] 가게 외관");
    expect(text).toContain("■ 글자 스타일 가이드");
    expect(text).toContain("메인 제목");
    expect(text).toContain("[이미지 3 삽입]");
    expect(text).toContain("■ SEO·태그");
    expect(text).toContain("#소금빵");
    expect(text).toContain("AI가 이미지를 만들지 않았어요");
  });
});
