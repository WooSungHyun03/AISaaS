import { describe, expect, it } from "vitest";
import {
  buildShortsPublishing,
  instagramCaption,
  normalizeShortsPublishing,
  relatesToVideo,
  shortsPublishingText,
  youtubeMetadata,
  type ShortsMetaContext,
} from "./publishing-metadata";

const store: ShortsMetaContext = {
  promotionType: "STORE",
  businessName: "우리동네 빵집",
  industry: "베이커리",
  location: "서울 성수동",
  keywords: ["소금빵", "아침빵"],
  topic: "출근길 소금빵 예약 팁",
  hook: "출근길에 소금빵 놓치셨나요?",
  sceneTexts: ["출근길에 소금빵 놓치셨나요?", "전날 밤 예약하면 아침에 바로 받아가요", "갓 구운 소금빵이 기다려요", "지금 예약해 보세요"],
  link: null,
};

describe("relatesToVideo", () => {
  it("accepts wording taken from the video and rejects an unrelated title", () => {
    const source = store.sceneTexts.join(" ");
    expect(relatesToVideo("소금빵 예약하면 아침에 바로 받아가요", source)).toBe(true);
    expect(relatesToVideo("충격 실화 다이어트 비법 공개", source)).toBe(false);
  });
});

describe("buildShortsPublishing", () => {
  it("falls back to the video's own hook and script when there is no AI answer", () => {
    const meta = buildShortsPublishing(store);
    expect(meta.source).toBe("rules");
    expect(meta.title).toBe(store.hook);
    expect(meta.alternativeTitles.length).toBeGreaterThanOrEqual(1);
    expect(meta.keywords).toContain("소금빵");
    expect(meta.hashtags).toEqual(expect.arrayContaining(["소금빵"]));
    expect(meta.callToAction).toContain("댓글");
  });

  it("drops clickbait that has nothing to do with the video, and unprovable claims", () => {
    const meta = buildShortsPublishing(store, {
      title: "다이어트에 충격적인 효과! 100% 성공",
      alternativeTitles: ["소금빵 예약하면 아침에 바로 받아가요", "무조건 살 빠지는 운동 비법", "최고의 소금빵 1등 가게"],
      description: "운동 초보를 위한 헬스 루틴을 소개합니다. 꾸준히 해 보세요.",
      youtubeTitle: "헬스 초보 필수 시청",
    });
    expect(meta.title).toBe(store.hook);
    expect(meta.alternativeTitles).toContain("소금빵 예약하면 아침에 바로 받아가요");
    expect(meta.alternativeTitles.join(" ")).not.toContain("운동");
    expect(meta.alternativeTitles.join(" ")).not.toContain("1등");
    expect(meta.description).not.toContain("헬스");
    expect(meta.youtubeTitle).toBe(store.hook);
  });

  it("keeps a good AI answer and only grounded keywords and hashtags", () => {
    const meta = buildShortsPublishing(store, {
      title: "출근길 소금빵, 전날 밤 예약하면 끝",
      alternativeTitles: ["소금빵 예약하면 아침이 편해져요", "갓 구운 소금빵을 아침에 받는 법"],
      description: "출근길에 소금빵을 놓친 적 있다면 예약이 답이에요. 전날 밤에 예약하면 아침에 바로 받아갈 수 있어요. #소금빵",
      keywords: ["소금빵", "예약", "다이어트", "성수동"],
      hashtags: ["#소금빵", "#예약팁", "#다이어트", "#아침빵"],
      callToAction: "프로필의 예약 안내를 확인해 주세요.",
      summary: "전날 밤 예약으로 아침에 소금빵을 받는 방법을 알려주는 영상",
    });
    expect(meta.source).toBe("ai");
    expect(meta.title).toBe("출근길 소금빵, 전날 밤 예약하면 끝");
    expect(meta.description).not.toContain("#");
    expect(meta.keywords).toEqual(expect.arrayContaining(["소금빵", "예약"]));
    expect(meta.keywords).not.toContain("다이어트");
    expect(meta.hashtags).not.toContain("다이어트");
    expect(meta.hashtags).toEqual(expect.arrayContaining(["소금빵", "아침빵"]));
  });

  it("differs by promotion type in its call to action fallback", () => {
    expect(buildShortsPublishing({ ...store, promotionType: "STORE" }).callToAction).toContain("방문");
    expect(buildShortsPublishing({ ...store, promotionType: "PLATFORM" }).callToAction).toContain("써보고");
  });

  it("only adds a region hashtag for a store", () => {
    const withRegion = buildShortsPublishing(store).hashtags;
    expect(withRegion).toContain("서울소금빵");
    expect(buildShortsPublishing({ ...store, promotionType: "PRODUCT" }).hashtags).not.toContain("서울소금빵");
  });
});

describe("platform fields", () => {
  const meta = buildShortsPublishing(store, { title: "출근길 소금빵, 전날 밤 예약하면 끝", description: "출근길에 소금빵을 놓친 적 있다면 예약이 답이에요. 전날 밤에 예약하면 아침에 바로 받아가요." });

  it("composes YouTube title, description with #Shorts and tags within the API limits", () => {
    const yt = youtubeMetadata({ ...meta, keywords: Array.from({ length: 10 }, (_, i) => `키워드${"가".repeat(60)}${i}`.slice(0, 30)) }, "https://shop.example.com");
    expect(yt.title.length).toBeLessThanOrEqual(100);
    expect(yt.description).toContain("#Shorts");
    expect(yt.description).toContain("https://shop.example.com");
    expect(yt.tags.join("").length).toBeLessThanOrEqual(500);
    expect((yt.description.match(/#/g) ?? []).length).toBeLessThanOrEqual(15);
  });

  it("composes one Instagram caption: hook first, hashtags last, at most 2,200 characters", () => {
    const caption = instagramCaption(meta);
    expect(caption.startsWith(meta.instagramHook)).toBe(true);
    expect(caption.trimEnd().split("\n").pop()).toMatch(/^#/);
    expect(instagramCaption({ ...meta, description: "가".repeat(1_500), callToAction: "나".repeat(100) }).length).toBeLessThanOrEqual(2_200);
  });

  it("gives a copyable plain-text summary", () => {
    const text = shortsPublishingText(meta);
    expect(text).toContain("영상 제목:");
    expect(text).toContain("해시태그: #");
  });
});

describe("normalizeShortsPublishing (the owner's edit)", () => {
  const base = buildShortsPublishing(store);

  it("keeps the owner's wording, cleans hashtags and de-duplicates", () => {
    const result = normalizeShortsPublishing({ ...base, title: "  내가 고친 제목  ", hashtags: ["#소금빵", "소금빵", "# 아침 빵 ", "a"], keywords: ["소금빵", "소금빵", "예약"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("내가 고친 제목");
      expect(result.value.hashtags).toEqual(["소금빵", "아침빵"]);
      expect(result.value.keywords).toEqual(["소금빵", "예약"]);
    }
  });

  it("refuses an empty title or description with a clear message", () => {
    expect(normalizeShortsPublishing({ ...base, title: "  " })).toEqual({ ok: false, error: "제목을 확인해주세요." });
    expect(normalizeShortsPublishing({ ...base, description: "" })).toEqual({ ok: false, error: "영상 설명을 확인해주세요." });
    expect(normalizeShortsPublishing(null).ok).toBe(false);
  });
});

describe("each promotion type gets its own posting text", () => {
  const cases: Array<[ShortsMetaContext["promotionType"], string, string[]]> = [
    ["STORE", "빵집 아침 예약", ["소금빵 예약하셨나요?", "매장에 들러 갓 구운 빵을 받아가세요"]],
    ["PRODUCT", "휴대용 선풍기 사용법", ["더운 날 휴대용 선풍기 챙기셨나요?", "한 번 충전으로 하루 종일 써요"]],
    ["PLATFORM", "일정 공유 서비스", ["일정 공유가 번거로우셨나요?", "링크 하나로 팀 일정이 모여요"]],
  ];
  for (const [type, topic, scenes] of cases) {
    it(`${type}: valid, grounded in its script, with a type-appropriate call to action`, () => {
      const meta = buildShortsPublishing({ promotionType: type, businessName: "테스트", industry: null, location: type === "STORE" ? "성수동" : null, keywords: [topic.split(" ")[0]], topic, hook: scenes[0], sceneTexts: scenes, link: null });
      expect(meta.title).toBe(scenes[0]);
      expect(meta.alternativeTitles.every((title) => title !== meta.title)).toBe(true);
      expect(meta.hashtags.some((tag) => tag.includes("성수동"))).toBe(type === "STORE");
      expect(meta.callToAction.length).toBeGreaterThan(5);
      expect(instagramCaption(meta).length).toBeLessThanOrEqual(2_200);
    });
  }
});
