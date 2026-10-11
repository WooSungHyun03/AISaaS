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

const promoPlan = {
  format: "promo",
  hook: "아직도 모르세요?",
  scenes: [
    { text: "아직도 모르세요?", imageIndex: 1, camera: "push-in", animate: true, motionPrompt: "Slow push-in; steam rises.", durationSec: 3 },
    { text: "직접 구운 소금빵을 만나보세요", imageIndex: 2, camera: "pan-left", animate: false, durationSec: 5 },
    { text: "겉은 바삭 속은 촉촉해요", imageIndex: 1, camera: "pull-out", animate: true, motionPrompt: "Gentle pull-back; light glints.", durationSec: 5 },
    { text: "오늘 바로 들러 보세요", imageIndex: 3, camera: "tilt-up", animate: false, durationSec: 5 },
  ],
  caption: "동네 빵집 소개 #동네빵집 #소금빵 #숏폼",
  privacy: "private",
};

const both = makeShortsPlanSchema(["character", "promo"]);

describe("makeShortsPlanSchema", () => {
  it("accepts a character plan and fills in defaults for a missing action and visual note", () => {
    const plan = both.parse(characterPlan);
    expect(plan.format).toBe("character");
    if (plan.format !== "character") return;
    expect(plan.scenes[2].action).toBeTruthy();
    expect(plan.scenes[0].visualPrompt).toBeTruthy();
  });

  it("accepts a promo plan with defaults for the animation fields", () => {
    const plan = both.parse(promoPlan);
    expect(plan.format).toBe("promo");
    if (plan.format !== "promo") return;
    expect(plan.scenes[1].motionPrompt).toBe("");
    expect(plan.scenes[1].animate).toBe(false);
  });

  it("refuses a format the images or style do not allow", () => {
    expect(makeShortsPlanSchema(["promo"]).safeParse(characterPlan).success).toBe(false);
    expect(makeShortsPlanSchema(["character"]).safeParse(promoPlan).success).toBe(false);
  });

  it("keeps character lines short enough for one 5 second clip", () => {
    const long = { ...characterPlan, scenes: characterPlan.scenes.map((scene, index) => (index === 3 ? { ...scene, text: "가".repeat(29) } : scene)) };
    expect(both.safeParse(long).success).toBe(false);
    const wordy = { ...characterPlan, scenes: [...characterPlan.scenes, characterPlan.scenes[3]].map((scene) => ({ ...scene, text: "가".repeat(28) })) };
    expect(both.safeParse(wordy).success).toBe(false); // > 150 characters in total
  });

  it("rejects a slow hook, no main speaker, too many scenes, unknown motions and a hashtag-less caption", () => {
    const slowHook = { ...characterPlan, scenes: characterPlan.scenes.map((scene, index) => (index === 0 ? { ...scene, durationSec: 5 } : scene)) };
    expect(both.safeParse(slowHook).success).toBe(false);
    const noMain = { ...characterPlan, scenes: characterPlan.scenes.map((scene) => ({ ...scene, speaker: "partner" })) };
    expect(both.safeParse(noMain).success).toBe(false);
    const tooMany = { ...characterPlan, scenes: [...characterPlan.scenes, ...characterPlan.scenes.slice(0, 2)] };
    expect(both.safeParse(tooMany).success).toBe(false);
    const badMotion = { ...characterPlan, scenes: characterPlan.scenes.map((scene) => ({ ...scene, motion: "spin" })) };
    expect(both.safeParse(badMotion).success).toBe(false);
    expect(both.safeParse({ ...characterPlan, caption: "해시태그 없음" }).success).toBe(false);
  });

  it("limits promo narration and animated scenes and requires a motion direction for them", () => {
    const longNarration = { ...promoPlan, scenes: promoPlan.scenes.map((scene) => ({ ...scene, text: "가".repeat(43) })) };
    expect(both.safeParse(longNarration).success).toBe(false);
    const noDirection = { ...promoPlan, scenes: promoPlan.scenes.map((scene) => (scene.animate ? { ...scene, motionPrompt: "" } : scene)) };
    expect(both.safeParse(noDirection).success).toBe(false);
    const fiveAnimated = {
      ...promoPlan,
      scenes: [...promoPlan.scenes, { ...promoPlan.scenes[0], durationSec: 4 }].map((scene) => ({ ...scene, animate: true, motionPrompt: "Slow push-in." })),
    };
    expect(both.safeParse(fiveAnimated).success).toBe(false);
    expect(both.safeParse({ ...promoPlan, scenes: promoPlan.scenes.map((scene) => ({ ...scene, camera: "orbit" })) }).success).toBe(false);
  });

  it("carries a music direction, with a sensible default when the AI omits it", () => {
    expect(both.parse(promoPlan).music).toContain("instrumental");
    expect(both.parse({ ...characterPlan, music: "Playful ukulele." }).music).toBe("Playful ukulele.");
    expect(both.safeParse({ ...promoPlan, music: "가".repeat(301) }).success).toBe(false);
  });

  it("is also a valid classic content shape once the script is added (publishing re-reads it)", () => {
    const plan = both.parse(promoPlan);
    const content = { hook: plan.hook, script: plan.scenes.map((scene) => scene.text).join(" "), scenes: plan.scenes, caption: plan.caption, privacy: plan.privacy };
    expect(shortsContentSchema.safeParse(content).success).toBe(true);
  });
});

const business = {
  id: "biz-1", owner_id: "u", name: "이지 마케팅", industry: "마케팅 SaaS", description: null, location: null,
  target_customer: "소상공인", brand_tone: null, keywords: [],
} as unknown as Business;

describe("buildShortsPlanPrompt", () => {
  it("lists the tagged images, the request and both formats when both are allowed", () => {
    const { prompt, system } = buildShortsPlanPrompt(business, "인스타 글 대신 써주는 로봇", {
      references: ["[character] 손을 흔드는 마스코트", "[product] 소금빵 클로즈업"],
      allowedFormats: ["character", "promo"],
      style: "auto",
      mascot: true,
      brief: "마스코트가 나와서 웃기게",
    });
    expect(prompt).toContain("1. [character] 손을 흔드는 마스코트");
    expect(prompt).toContain("2. [product] 소금빵 클로즈업");
    expect(prompt).toContain("마스코트가 나와서 웃기게");
    expect(prompt).toContain('format "character"');
    expect(prompt).toContain('format "promo"');
    expect(prompt).toContain("Choose \"format\" yourself");
    expect(prompt).toMatch(/pop, bounce, wobble, shake, slide, zoom/);
    expect(prompt).toMatch(/push-in, pull-out, pan-left, pan-right, tilt-up, tilt-down/);
    expect(system).toContain("이지 마케팅");
    expect(system).toContain("stop the scroll");
    expect(system).toContain("there are no captions");
    expect(prompt).toContain('"music"');
  });

  it("pins the format and drops the other format's rules when only one is allowed", () => {
    const character = buildShortsPlanPrompt(business, "주제", { references: ["[character] 우리 고양이"], allowedFormats: ["character"], style: "skit", mascot: false });
    expect(character.prompt).toContain('Use format "character".');
    expect(character.prompt).not.toContain('format "promo":');
    expect(character.system).not.toContain("blue cape");
    expect(character.prompt).toContain("Comedy techniques");

    const promo = buildShortsPlanPrompt(business, "주제", { references: ["[product] 소금빵", "[person] 사장님"], allowedFormats: ["promo"], style: "promo", mascot: false });
    expect(promo.prompt).toContain('Use format "promo".');
    expect(promo.prompt).not.toContain('format "character":');
    expect(promo.prompt).toContain("NEVER for a [person] photo");
    expect(promo.prompt).toContain("never use unprovable claims");
    expect(promo.prompt).toContain("Never ask the animator to change");
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
