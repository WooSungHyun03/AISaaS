import { describe, expect, it } from "vitest";
import type { Business } from "@/types/domain";
import { buildShortsSkitPrompt, buildShortsTopicPrompt, shortsContentSchema, shortsSkitContentSchema } from "./shorts";

const validContent = {
  hook: "아침마다 빵을 기다리고 계신가요?",
  script: "바쁜 출근길에는 기다릴 시간이 부족합니다. 빵을 미리 예약하면 갓 구운 메뉴를 바로 받을 수 있어요. 오늘 아침 메뉴를 예약해보세요.",
  scenes: [
    { text: "아침마다 기다리세요?", visualPrompt: "출근 시계를 보는 고객, 세로 9:16 클로즈업", durationSec: 3 },
    { text: "바쁜 아침엔 시간이 부족하죠", visualPrompt: "빵집 앞에서 시계를 보는 직장인, 세로 9:16", durationSec: 4 },
    { text: "미리 예약하면 바로 픽업", visualPrompt: "포장된 빵을 건네는 장면, 세로 9:16", durationSec: 5 },
    { text: "오늘 메뉴를 예약하세요", visualPrompt: "빵 봉투를 들고 웃는 고객, 세로 9:16", durationSec: 5 },
  ],
  caption: "출근길 빵을 빠르게 픽업하세요. #아침빵 #빵예약 #동네빵집",
  privacy: "private",
};

describe("shortsContentSchema", () => {
  it("accepts a 15-45 second scene plan with a platform caption", () => {
    expect(shortsContentSchema.parse(validContent)).toEqual(validContent);
  });

  it("rejects a first hook scene longer than 3 seconds", () => {
    const result = shortsContentSchema.safeParse({
      ...validContent,
      scenes: [{ ...validContent.scenes[0], durationSec: 4 }, ...validContent.scenes.slice(1)],
    });

    expect(result.success).toBe(false);
  });

  it("rejects plans outside the 15-45 second range or without enough hashtags", () => {
    const result = shortsContentSchema.safeParse({
      ...validContent,
      scenes: validContent.scenes.map((scene) => ({ ...scene, durationSec: 2 })),
      caption: "출근길 빵을 빠르게 픽업하세요. #아침빵",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual(expect.arrayContaining(["scenes", "caption"]));
    }
  });
});

const skitContent = {
  hook: "사장님, 큰일 났어요!",
  scenes: [
    { text: "사장님, 큰일 났어요!", speaker: "partner", imageIndex: 2, motion: "shake", durationSec: 2 },
    { text: "무슨 일이에요?", speaker: "main", imageIndex: 1, motion: "pop", durationSec: 3 },
    { text: "인스타 글을 일주일째 못 올렸어요", speaker: "partner", imageIndex: 2, motion: "wobble", durationSec: 5 },
    { text: "걱정 마세요, 제가 3분 만에 만들어요!", speaker: "main", imageIndex: 3, motion: "bounce", durationSec: 6 },
    { text: "이지 마케팅에서 바로 시작해요!", speaker: "main", imageIndex: 4, motion: "zoom", durationSec: 5 },
  ],
  caption: "마케팅이 어려운 사장님을 위한 이지 마케팅 #이지마케팅 #소상공인 #숏폼",
  privacy: "private",
};

describe("shortsSkitContentSchema", () => {
  it("accepts a short skit and fills in a default visual note", () => {
    const parsed = shortsSkitContentSchema.parse(skitContent);
    expect(parsed.scenes[0].visualPrompt).toBeTruthy();
    expect(parsed.scenes).toHaveLength(5);
  });

  it("rejects lines that are too long, a long hook scene, and skits with no character line", () => {
    const longLine = { ...skitContent, scenes: skitContent.scenes.map((scene, index) => (index === 3 ? { ...scene, text: "가".repeat(46) } : scene)) };
    expect(shortsSkitContentSchema.safeParse(longLine).success).toBe(false);

    const slowHook = { ...skitContent, scenes: skitContent.scenes.map((scene, index) => (index === 0 ? { ...scene, durationSec: 5 } : scene)) };
    expect(shortsSkitContentSchema.safeParse(slowHook).success).toBe(false);

    const noMain = { ...skitContent, scenes: skitContent.scenes.map((scene) => ({ ...scene, speaker: "partner" })) };
    expect(shortsSkitContentSchema.safeParse(noMain).success).toBe(false);
  });

  it("rejects a skit that would run too long to render inside one request", () => {
    const wordy = { ...skitContent, scenes: skitContent.scenes.map((scene) => ({ ...scene, text: "가".repeat(40) })) };
    expect(shortsSkitContentSchema.safeParse(wordy).success).toBe(false);
  });

  it("rejects an unknown motion or speaker", () => {
    expect(shortsSkitContentSchema.safeParse({ ...skitContent, scenes: skitContent.scenes.map((scene) => ({ ...scene, motion: "spin" })) }).success).toBe(false);
    expect(shortsSkitContentSchema.safeParse({ ...skitContent, scenes: skitContent.scenes.map((scene) => ({ ...scene, speaker: "narrator" })) }).success).toBe(false);
  });
});

const business = {
  id: "biz-1", owner_id: "u", name: "이지 마케팅", industry: "마케팅 SaaS", description: null, location: null,
  target_customer: "소상공인", brand_tone: null, keywords: [],
} as unknown as Business;

describe("buildShortsSkitPrompt", () => {
  it("lists the reference images by number and the allowed motions", () => {
    const { prompt, system } = buildShortsSkitPrompt(business, "인스타 글 대신 써주는 로봇", {
      references: ["손을 흔드는 마스코트", "놀란 마스코트"],
      style: "skit",
      mascot: true,
      brief: "웃기게",
    });
    expect(prompt).toContain("1. 손을 흔드는 마스코트");
    expect(prompt).toContain("2. 놀란 마스코트");
    expect(prompt).toContain("웃기게");
    expect(prompt).toMatch(/pop, bounce, wobble, shake, slide, zoom/);
    expect(system).toContain("funny character skit");
    expect(system).toContain("이지 마케팅");
  });

  it("only mentions the service mascot facts when the mascot is the reference", () => {
    const user = buildShortsSkitPrompt(business, "주제", { references: ["우리 고양이"], style: "explainer", mascot: false });
    expect(user.system).not.toContain("blue cape");
    expect(user.system).toContain("friendly explainer");
  });

  it("passes the owner's direction into topic selection", () => {
    expect(buildShortsTopicPrompt(business, [], undefined, "신메뉴 홍보").prompt).toContain("신메뉴 홍보");
    expect(buildShortsTopicPrompt(business, []).prompt).not.toContain("direction");
  });
});
