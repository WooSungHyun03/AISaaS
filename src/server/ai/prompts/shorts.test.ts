import { describe, expect, it } from "vitest";
import type { Business } from "@/types/domain";
import { buildShortsPlanPrompt, buildShortsTopicPrompt, makeShortsPlanSchema, shortsContentSchema } from "./shorts";

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

const characterPlan = {
  format: "character",
  hook: "사장님, 큰일 났어요!",
  scenes: [
    { text: "사장님, 큰일 났어요!", speaker: "partner", imageIndex: 2, action: "The character panics and shakes.", motion: "shake", durationSec: 2 },
    { text: "무슨 일이에요?", speaker: "main", imageIndex: 1, action: "The character tilts its head.", motion: "pop", durationSec: 3 },
    { text: "인스타 글을 일주일째 못 올렸어요", speaker: "partner", imageIndex: 2, motion: "wobble", durationSec: 5 },
    { text: "걱정 마세요, 제가 3분 만에 써요!", speaker: "main", imageIndex: 3, action: "The character gives a thumbs up.", motion: "bounce", durationSec: 6 },
    { text: "이지 마케팅에서 바로 시작해요!", speaker: "main", imageIndex: 4, action: "The character points forward.", motion: "zoom", durationSec: 5 },
  ],
  caption: "마케팅이 어려운 사장님을 위한 이지 마케팅 #이지마케팅 #소상공인 #숏폼",
  privacy: "private",
};

const showcasePlan = {
  format: "showcase",
  hook: "여기 한번 보세요!",
  scenes: [
    { text: "여기 한번 보세요!", caption: "여기 한번 보세요!", imageIndex: 1, motion: "zoom-in", durationSec: 3 },
    { text: "정성껏 준비한 매장이에요", caption: "정성껏 준비한 매장", imageIndex: 2, motion: "pan-left", durationSec: 5 },
    { text: "직접 구운 빵을 만나보세요", caption: "직접 구운 빵", imageIndex: 3, motion: "zoom-out", durationSec: 5 },
    { text: "오늘 바로 들러 보세요", caption: "오늘 들러 보세요", imageIndex: 1, motion: "pan-right", durationSec: 5 },
  ],
  caption: "동네 빵집 소개 #동네빵집 #소금빵 #숏폼",
  privacy: "private",
};

describe("makeShortsPlanSchema", () => {
  it("accepts a character plan and fills in defaults for a missing action and visual note", () => {
    const plan = makeShortsPlanSchema(["character"]).parse(characterPlan);
    expect(plan.format).toBe("character");
    if (plan.format !== "character") return;
    expect(plan.scenes[2].action).toBeTruthy();
    expect(plan.scenes[0].visualPrompt).toBeTruthy();
  });

  it("accepts a showcase plan", () => {
    expect(makeShortsPlanSchema(["showcase"]).parse(showcasePlan).format).toBe("showcase");
  });

  it("refuses a format the images or style do not allow", () => {
    expect(makeShortsPlanSchema(["showcase"]).safeParse(characterPlan).success).toBe(false);
    expect(makeShortsPlanSchema(["character"]).safeParse(showcasePlan).success).toBe(false);
    expect(makeShortsPlanSchema(["character", "showcase"]).safeParse(showcasePlan).success).toBe(true);
  });

  it("keeps character lines short enough for one 5 second clip", () => {
    const long = { ...characterPlan, scenes: characterPlan.scenes.map((scene, index) => (index === 3 ? { ...scene, text: "가".repeat(29) } : scene)) };
    expect(makeShortsPlanSchema(["character"]).safeParse(long).success).toBe(false);
    const wordy = { ...characterPlan, scenes: [...characterPlan.scenes, characterPlan.scenes[3]].map((scene) => ({ ...scene, text: "가".repeat(28) })) };
    expect(makeShortsPlanSchema(["character"]).safeParse(wordy).success).toBe(false); // > 150 characters in total
  });

  it("rejects a slow hook, no main speaker, more than 6 character scenes, and unknown motions", () => {
    const slowHook = { ...characterPlan, scenes: characterPlan.scenes.map((scene, index) => (index === 0 ? { ...scene, durationSec: 5 } : scene)) };
    expect(makeShortsPlanSchema(["character"]).safeParse(slowHook).success).toBe(false);
    const noMain = { ...characterPlan, scenes: characterPlan.scenes.map((scene) => ({ ...scene, speaker: "partner" })) };
    expect(makeShortsPlanSchema(["character"]).safeParse(noMain).success).toBe(false);
    const tooMany = { ...characterPlan, scenes: [...characterPlan.scenes, ...characterPlan.scenes.slice(0, 2)] };
    expect(makeShortsPlanSchema(["character"]).safeParse(tooMany).success).toBe(false);
    const badMotion = { ...showcasePlan, scenes: showcasePlan.scenes.map((scene) => ({ ...scene, motion: "spin" })) };
    expect(makeShortsPlanSchema(["showcase"]).safeParse(badMotion).success).toBe(false);
  });

  it("requires a short caption on every showcase scene", () => {
    const longCaption = { ...showcasePlan, scenes: showcasePlan.scenes.map((scene) => ({ ...scene, caption: "가".repeat(27) })) };
    expect(makeShortsPlanSchema(["showcase"]).safeParse(longCaption).success).toBe(false);
  });
});

const business = {
  id: "biz-1", owner_id: "u", name: "이지 마케팅", industry: "마케팅 SaaS", description: null, location: null,
  target_customer: "소상공인", brand_tone: null, keywords: [],
} as unknown as Business;

describe("buildShortsPlanPrompt", () => {
  it("lists the tagged reference images, the request and both formats when both are allowed", () => {
    const { prompt, system } = buildShortsPlanPrompt(business, "인스타 글 대신 써주는 로봇", {
      references: ["[character] 손을 흔드는 마스코트", "[place] 매장 전경"],
      allowedFormats: ["character", "showcase"],
      style: "auto",
      mascot: true,
      brief: "마스코트가 나와서 웃기게",
    });
    expect(prompt).toContain("1. [character] 손을 흔드는 마스코트");
    expect(prompt).toContain("2. [place] 매장 전경");
    expect(prompt).toContain("마스코트가 나와서 웃기게");
    expect(prompt).toContain('format "character"');
    expect(prompt).toContain('format "showcase"');
    expect(prompt).toContain("Choose \"format\" yourself");
    expect(system).toContain("이지 마케팅");
    expect(system).toContain("decide the format");
  });

  it("pins the format and drops the other format's rules when only one is allowed", () => {
    const character = buildShortsPlanPrompt(business, "주제", { references: ["[character] 우리 고양이"], allowedFormats: ["character"], style: "skit", mascot: false });
    expect(character.prompt).toContain('Use format "character".');
    expect(character.prompt).not.toContain('format "showcase":');
    expect(character.system).not.toContain("blue cape");
    expect(character.prompt).toContain("funny");

    const showcase = buildShortsPlanPrompt(business, "주제", { references: ["[product] 소금빵"], allowedFormats: ["showcase"], style: "showcase", mascot: false });
    expect(showcase.prompt).toContain('Use format "showcase".');
    expect(showcase.prompt).not.toContain('format "character":');
    expect(showcase.prompt).toContain("never invent prices");
  });

  it("does not add comedy rules for the explainer style", () => {
    const { prompt } = buildShortsPlanPrompt(business, "주제", { references: ["[character] 로봇"], allowedFormats: ["character"], style: "explainer", mascot: false });
    expect(prompt).not.toContain("Comedy techniques");
  });

  it("passes the owner's direction into topic selection", () => {
    expect(buildShortsTopicPrompt(business, [], undefined, "신메뉴 홍보").prompt).toContain("신메뉴 홍보");
    expect(buildShortsTopicPrompt(business, []).prompt).not.toContain("direction");
  });
});
