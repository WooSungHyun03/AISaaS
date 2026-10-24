import { describe, expect, it } from "vitest";
import type { Business } from "@/types/domain";
import {
  REQUIRED_PROHIBITIONS,
  WAN_PROMPT_MAX_CHARS,
  buildAdPlanPrompt,
  buildWanPrompt,
  makeAdPlanDraftSchema,
  makeAdPlanSchema,
  missingProhibitions,
  normalizeAdPlan,
  prohibitionsFor,
  type AdPlan,
} from "./ad-plan";
import { mockAdPlan } from "@/server/ai/providers/mock-ad";

const business = { id: "b", name: "우리동네 빵집", industry: "베이커리", description: null, location: "서울 마포구", brand_tone: "따뜻한", keywords: ["소금빵"], promotion_type: "STORE", promotion_details: {}, main_offering: "소금빵" } as unknown as Business;
const bounds = (durationSec = 25) => ({ durationSec, imageCount: 2, videoCount: 1, audioCount: 0, exactImages: [2] });
const planFor = (durationSec = 25, extra = ""): AdPlan => makeAdPlanSchema(bounds(durationSec)).parse(JSON.parse(mockAdPlan(`AUTOBIZ_AD_PLAN_V1\nDURATION=${durationSec}\nIMAGE_COUNT=2\nVIDEO_COUNT=1\nAUDIO_COUNT=0\nImages 2 are 'exact' images (a real label).\n${extra}`, "상호: 우리동네 빵집")));

describe("ad plan schema", () => {
  it("accepts a plan that fits the length and the references", () => {
    const plan = planFor(30);
    expect(plan.storyboard.at(-1)?.endSec).toBe(30);
    expect(plan.hook.text).toBeTruthy();
    expect(plan.narration.length).toBeGreaterThan(10);
  });

  const mutate = (change: (plan: Record<string, any>) => void, durationSec = 25) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const raw = JSON.parse(mockAdPlan(`DURATION=${durationSec}\nIMAGE_COUNT=2\nVIDEO_COUNT=1\nAUDIO_COUNT=0\nImages 2 are 'exact' images`, "상호: 빵집"));
    change(raw);
    return makeAdPlanSchema(bounds(durationSec)).safeParse(raw);
  };

  it("rejects a storyboard that does not start at 0, leaves gaps, or ends far from the requested length", () => {
    expect(mutate((plan) => { plan.storyboard[0].startSec = 3; }).success).toBe(false);
    expect(mutate((plan) => { plan.storyboard[2].startSec += 4; }).success).toBe(false);
    expect(mutate((plan) => { plan.storyboard.at(-1).endSec = 15; }).success).toBe(false);
    expect(mutate((plan) => { plan.storyboard[0].endSec = 6; }).success).toBe(false);
    expect(mutate((plan) => { plan.storyboard = plan.storyboard.slice(0, 2); }).success).toBe(false);
  });

  it("rejects references and inserts the owner does not have, and a narration that is too long to speak", () => {
    expect(mutate((plan) => { plan.references.push({ type: "image", index: 5, role: "x" }); }).success).toBe(false);
    expect(mutate((plan) => { plan.references.push({ type: "audio", index: 1, role: "x" }); }).success).toBe(false);
    expect(mutate((plan) => { plan.inserts = [{ imageIndex: 1, startSec: 20, endSec: 23 }]; }).success).toBe(false);
    expect(mutate((plan) => { plan.inserts = [{ imageIndex: 2, startSec: 23, endSec: 22 }]; }).success).toBe(false);
    expect(mutate((plan) => { plan.narration = "가".repeat(400); }).success).toBe(false);
    expect(mutate((plan) => { plan.cta.startSec = 24.5; }).success).toBe(false);
  });

  it("draft schema: drops an insert or reference the owner cannot have instead of failing the whole plan", () => {
    const noExact = { durationSec: 25, imageCount: 1, videoCount: 0, audioCount: 0, exactImages: [] as number[] };
    // The planner prompt's own JSON example shows an insert for image 2; a model that copies it for a plan with no
    // 'exact' image, or names a video/audio/image that does not exist, used to be rejected twice (a failed run).
    const raw = JSON.parse(mockAdPlan("DURATION=25\nIMAGE_COUNT=1\nVIDEO_COUNT=0\nAUDIO_COUNT=0", "상호: 빵집"));
    raw.inserts = [{ imageIndex: 2, startSec: 21, endSec: 24 }];
    raw.references = [{ type: "image", index: 1, role: "the product" }, { type: "video", index: 1, role: "none exists" }, { type: "image", index: 4, role: "none exists" }];
    expect(makeAdPlanSchema(noExact).safeParse(raw).success).toBe(false);
    const draft = makeAdPlanDraftSchema(noExact).safeParse(raw);
    expect(draft.success).toBe(true);
    if (draft.success) {
      expect(draft.data.inserts).toEqual([]);
      expect(draft.data.references).toEqual([{ type: "image", index: 1, role: "the product" }]);
    }
  });

  it("draft schema: keeps a valid insert, and still rejects what is not optional", () => {
    const withExact = bounds(25);
    const raw = JSON.parse(mockAdPlan("DURATION=25\nIMAGE_COUNT=2\nVIDEO_COUNT=1\nAUDIO_COUNT=0\nImages 2 are 'exact' images", "상호: 빵집"));
    raw.inserts = [{ imageIndex: 2, startSec: 21, endSec: 24 }, { imageIndex: 1, startSec: 5, endSec: 8 }];
    const kept = makeAdPlanDraftSchema(withExact).parse(raw);
    expect(kept.inserts).toEqual([{ imageIndex: 2, startSec: 21, endSec: 24 }]);
    raw.storyboard = raw.storyboard.slice(0, 2);
    expect(makeAdPlanDraftSchema(withExact).safeParse(raw).success).toBe(false);
    raw.storyboard = undefined;
    expect(makeAdPlanDraftSchema(withExact).safeParse(raw).success).toBe(false);
    expect(makeAdPlanDraftSchema(withExact).safeParse("not an object").success).toBe(false);
  });

  it("snaps the storyboard to exact, contiguous seconds", () => {
    const raw = JSON.parse(mockAdPlan("DURATION=25\nIMAGE_COUNT=2\nVIDEO_COUNT=0\nAUDIO_COUNT=0", "상호: 빵집")) as AdPlan;
    raw.storyboard[1].startSec = 2.4;
    raw.storyboard.at(-1)!.endSec = 24.2;
    const plan = normalizeAdPlan(raw, 25);
    expect(plan.storyboard[0].startSec).toBe(0);
    for (let index = 1; index < plan.storyboard.length; index++) expect(plan.storyboard[index].startSec).toBe(plan.storyboard[index - 1].endSec);
    expect(plan.storyboard.at(-1)?.endSec).toBe(25);
    expect(plan.cta.startSec).toBeLessThanOrEqual(23);
  });
});

describe("planner prompt", () => {
  it("tells the planner the length, the references and the owner's request, and bans invented claims", () => {
    const { system, prompt } = buildAdPlanPrompt({
      business, brief: "신메뉴 위주로", recentTopics: ["겨울 한정 메뉴"], bounds: bounds(28), voiceMode: "native",
      images: ["[product] 소금빵", "[product] 포장 라벨"], videos: [{ label: "굽는 장면", durationSec: 6 }], audios: [], hasLogo: true,
    });
    expect(prompt).toContain("DURATION=28");
    expect(prompt).toContain("IMAGE_COUNT=2");
    expect(prompt).toContain("1. [product] 소금빵");
    expect(prompt).toContain("Images 2 are 'exact' images");
    expect(prompt).toContain("신메뉴 위주로");
    expect(prompt).toContain("겨울 한정 메뉴");
    expect(prompt).toContain("The model speaks it");
    expect(system).toContain("never invent prices");
    expect(system).toContain("상호: 우리동네 빵집");
    expect(system).toContain("최고의");
  });

  it("asks for a silent video when the narration is recorded separately", () => {
    const { prompt } = buildAdPlanPrompt({ business, recentTopics: [], bounds: bounds(), voiceMode: "tts", images: [], videos: [], audios: [], hasLogo: false });
    expect(prompt).toContain("recorded separately");
    expect(prompt).toContain("There is no logo");
  });
});

describe("the video prompt", () => {
  const plan = planFor(25);

  it("is built from the plan by rules: the same plan always gives the same prompt", () => {
    expect(buildWanPrompt({ plan, durationSec: 25, voiceMode: "native" })).toBe(buildWanPrompt({ plan, durationSec: 25, voiceMode: "native" }));
  });

  it("states the format, the references by position, the timeline, the look, the sound and the Korean voice-over", () => {
    const prompt = buildWanPrompt({ plan, durationSec: 25, voiceMode: "native" });
    expect(prompt).toContain("Vertical 9:16 Korean advertisement, 25 seconds");
    expect(prompt).toContain("Image 1:");
    expect(prompt).toContain("Image 2:");
    expect(prompt).toContain("Video 1:");
    expect(prompt).toContain("0-2s (hook):");
    expect(prompt).toContain("Look:");
    expect(prompt).toContain("Korean voice-over");
    expect(prompt).toContain(plan.narration);
    expect(prompt).toContain("Must stay unchanged:");
  });

  it("carries every standing prohibition, and 'no speech' only when the voice is recorded separately", () => {
    for (const mode of ["native", "tts"] as const) {
      const prompt = buildWanPrompt({ plan, durationSec: 25, voiceMode: mode });
      for (const rule of prohibitionsFor(mode)) expect(prompt, rule.id).toContain(rule.text);
      expect(missingProhibitions(prompt, mode)).toEqual([]);
    }
    expect(buildWanPrompt({ plan, durationSec: 25, voiceMode: "native" })).not.toContain("No speech");
    const silent = buildWanPrompt({ plan, durationSec: 25, voiceMode: "tts" });
    expect(silent).toContain("No speech, no singing and no vocals");
    expect(silent).not.toContain("Korean voice-over");
  });

  it("adds the correction for a second attempt", () => {
    expect(buildWanPrompt({ plan, durationSec: 25, voiceMode: "native", retryNote: "keep the label sharp" })).toContain("Correction for this attempt: keep the label sharp");
  });

  it("stays within the prompt limit by shrinking scenes, never the rules", () => {
    const long: AdPlan = { ...plan, concept: "c".repeat(230), narration: "나".repeat(500), storyboard: plan.storyboard.map((scene) => ({ ...scene, visual: "v".repeat(320), camera: "c".repeat(130), narration: "나".repeat(110) })), preservation: Array.from({ length: 8 }, () => "p".repeat(190)) };
    const prompt = buildWanPrompt({ plan: long, durationSec: 25, voiceMode: "native" });
    expect(prompt.length).toBeLessThanOrEqual(WAN_PROMPT_MAX_CHARS);
    expect(missingProhibitions(prompt, "native")).toEqual([]);
    expect(prompt.endsWith(prohibitionsFor("native").at(-1)!.text)).toBe(true);
  });
});

describe("checking what the video service really used", () => {
  it("passes a prompt that kept the rules, in the model's own words", () => {
    expect(missingProhibitions("Do not add any text or subtitles. Keep the product exactly the same shape and label. Never invent screens or prices. No flickering or warping.", "native")).toEqual([]);
  });

  it("lists the rules a rewritten prompt dropped, and says nothing when the service reported no prompt", () => {
    expect(missingProhibitions("A cinematic ad about bread, warm light.", "native")).toEqual(["no-text", "keep-references", "no-invention", "no-distortion"]);
    expect(missingProhibitions("Subtitles are not allowed in the frame. The product stays unchanged and faithful to the reference. Never fabricate screens. No flicker.", "native")).toEqual([]);
    expect(missingProhibitions("No text. Keep the product exactly the same. Do not invent anything. No flicker.", "tts")).toEqual(["no-speech"]);
    expect(missingProhibitions(undefined, "native")).toBeNull();
    expect(missingProhibitions("   ", "native")).toBeNull();
    expect(REQUIRED_PROHIBITIONS.length).toBe(5);
  });
});
