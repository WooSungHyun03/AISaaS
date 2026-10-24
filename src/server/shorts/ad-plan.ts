import { z } from "zod";
import type { Business } from "@/types/domain";
import { PROMOTION_LABEL } from "@/types/promotion";
import { promotionFactLines, promotionGuidance, resolvePromotionType } from "@/server/promotion/strategy";
import { UNPROVABLE_CLAIMS } from "@/server/ai/blog-quality";
import type { VoiceMode } from "@/types/shorts-reference";

/** The least a Short is told to do for a viewer in its first seconds: the model must hook inside this window. */
export const HOOK_SECONDS = 2;
/** Korean narration speed used to size the script (syllables a second, with pauses). */
const NARRATION_CHARS_PER_SECOND = 5.5;
/** The longest prompt sent to the video model. */
export const WAN_PROMPT_MAX_CHARS = 2_000;

const english = (max: number) => z.string().trim().min(1).max(max);

export const adPlanSceneSchema = z.object({
  startSec: z.number().finite().min(0).max(30),
  endSec: z.number().finite().min(0.5).max(30),
  /** What is seen, in English (the video model follows English best). */
  visual: english(320),
  camera: english(140),
  /** The Korean line spoken during this scene, if any. */
  narration: z.string().trim().max(120).default(""),
});

export const adPlanSchema = z.object({
  topic: z.string().trim().min(2).max(120),
  concept: z.string().trim().min(1).max(240),
  message: z.string().trim().min(1).max(160),
  audience: z.string().trim().min(1).max(160),
  hook: z.object({ text: z.string().trim().min(1).max(100), visual: english(240) }),
  storyboard: z.array(adPlanSceneSchema).min(4).max(8),
  /** What each reference file is for. `index` counts from 1 within its own kind (image 1, video 1, audio 1). */
  references: z
    .array(z.object({ type: z.enum(["image", "video", "audio"]), index: z.number().int().min(1).max(10), role: english(200) }))
    .max(20)
    .default([]),
  look: z.object({ camera: english(200), lighting: english(200), color: english(200) }),
  audio: z.object({ music: english(200), sfx: z.array(english(80)).max(5).default([]) }),
  /** The whole narration in Korean, as it should be spoken. */
  narration: z.string().trim().min(1).max(600),
  cta: z.object({ text: z.string().trim().min(1).max(26), startSec: z.number().finite().min(0).max(30) }),
  logo: z.object({ show: z.boolean().default(true), position: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).default("top-right") }).default({ show: true, position: "top-right" }),
  /** Where an "exact" image (a real label or screen) is laid over the video, untouched by the model. */
  inserts: z.array(z.object({ imageIndex: z.number().int().min(1).max(10), startSec: z.number().finite().min(0).max(30), endSec: z.number().finite().min(0.5).max(30) })).max(3).default([]),
  /** Things about the references that must not change, beyond the standing rules. */
  preservation: z.array(english(200)).max(8).default([]),
});
export type AdPlan = z.infer<typeof adPlanSchema>;

export interface AdPlanBounds {
  durationSec: number;
  imageCount: number;
  videoCount: number;
  audioCount: number;
  /** 1-based image numbers the owner marked as "exact". */
  exactImages: number[];
}

/** The plan schema for one run: the plan must fit the length, the references that exist and the exact images. */
export function makeAdPlanSchema(bounds: AdPlanBounds) {
  return adPlanSchema.superRefine((plan, ctx) => {
    const last = plan.storyboard[plan.storyboard.length - 1];
    const first = plan.storyboard[0];
    if (first.startSec > 0.3) ctx.addIssue({ code: "custom", path: ["storyboard", 0, "startSec"], message: "첫 장면은 0초에서 시작해야 합니다." });
    if (first.endSec > HOOK_SECONDS + 1.5) ctx.addIssue({ code: "custom", path: ["storyboard", 0, "endSec"], message: `첫 후킹 장면은 ${HOOK_SECONDS}초 안팎이어야 합니다.` });
    if (Math.abs(last.endSec - bounds.durationSec) > 2) ctx.addIssue({ code: "custom", path: ["storyboard"], message: `스토리보드는 ${bounds.durationSec}초에 맞게 끝나야 합니다.` });
    plan.storyboard.forEach((scene, index) => {
      if (scene.endSec <= scene.startSec) ctx.addIssue({ code: "custom", path: ["storyboard", index], message: "장면의 끝이 시작보다 늦어야 합니다." });
      const previous = plan.storyboard[index - 1];
      if (previous && Math.abs(scene.startSec - previous.endSec) > 1) ctx.addIssue({ code: "custom", path: ["storyboard", index, "startSec"], message: "장면은 서로 이어져야 합니다." });
    });
    const max = { image: bounds.imageCount, video: bounds.videoCount, audio: bounds.audioCount } as const;
    plan.references.forEach((reference, index) => {
      if (reference.index > max[reference.type]) ctx.addIssue({ code: "custom", path: ["references", index, "index"], message: `${reference.type} ${reference.index}번 참고 파일은 없습니다.` });
    });
    plan.inserts.forEach((insert, index) => {
      if (!bounds.exactImages.includes(insert.imageIndex)) ctx.addIssue({ code: "custom", path: ["inserts", index, "imageIndex"], message: "정확히 보여줄 이미지로 표시된 사진만 쓸 수 있습니다." });
      if (insert.endSec <= insert.startSec || insert.endSec > bounds.durationSec + 0.5) ctx.addIssue({ code: "custom", path: ["inserts", index], message: "삽입 시간이 올바르지 않습니다." });
    });
    const maxChars = Math.round(bounds.durationSec * NARRATION_CHARS_PER_SECOND * 1.25);
    if (plan.narration.replace(/\s+/g, "").length > maxChars) ctx.addIssue({ code: "custom", path: ["narration"], message: `나레이션은 공백 제외 ${maxChars}자 이하여야 합니다.` });
    if (plan.cta.startSec > bounds.durationSec - 1.5) ctx.addIssue({ code: "custom", path: ["cta", "startSec"], message: "행동 유도 문구는 영상이 끝나기 1.5초 전에는 나와야 합니다." });
  });
}

/**
 * What the planner's answer is checked with. `references` and `inserts` are optional extras, and the prompt's own JSON
 * example shows an insert, so a model often copies one for a photo that is not 'exact' or names a file the owner does not
 * have. Those entries are dropped (the plan is still complete without them) instead of failing the whole plan, which
 * cost a second paid planner call and then a failed run. Everything else is still checked by `makeAdPlanSchema`.
 */
export function makeAdPlanDraftSchema(bounds: AdPlanBounds) {
  const max = { image: bounds.imageCount, video: bounds.videoCount, audio: bounds.audioCount } as const;
  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
  const keepReference = (item: unknown) => !isRecord(item) || !(typeof item.type === "string" && item.type in max) || typeof item.index !== "number" || (item.index >= 1 && item.index <= max[item.type as keyof typeof max]);
  const keepInsert = (item: unknown) => !isRecord(item) || (typeof item.imageIndex === "number" && bounds.exactImages.includes(item.imageIndex) && typeof item.startSec === "number" && typeof item.endSec === "number" && item.endSec > item.startSec && item.endSec <= bounds.durationSec + 0.5);
  return z.preprocess((raw) => {
    if (!isRecord(raw)) return raw;
    return {
      ...raw,
      ...(Array.isArray(raw.references) ? { references: raw.references.filter(keepReference) } : {}),
      ...(Array.isArray(raw.inserts) ? { inserts: raw.inserts.filter(keepInsert) } : {}),
    };
  }, makeAdPlanSchema(bounds));
}

/** Makes the storyboard exactly contiguous from 0 to the requested length (the AI's timings are close, not exact). */
export function normalizeAdPlan(plan: AdPlan, durationSec: number): AdPlan {
  const scenes = plan.storyboard.map((scene) => ({ ...scene }));
  scenes[0].startSec = 0;
  for (let index = 1; index < scenes.length; index++) scenes[index].startSec = scenes[index - 1].endSec;
  scenes[scenes.length - 1].endSec = durationSec;
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    ...plan,
    storyboard: scenes.map((scene) => ({ ...scene, startSec: round(scene.startSec), endSec: round(scene.endSec) })),
    cta: { ...plan.cta, startSec: round(Math.min(plan.cta.startSec, durationSec - 2)) },
    inserts: plan.inserts.map((insert) => ({ ...insert, endSec: round(Math.min(insert.endSec, durationSec)) })),
  };
}

export interface AdPlanPromptInput {
  business: Business;
  topic?: string;
  brief?: string;
  recentTopics: string[];
  rejectedTopic?: string;
  calendar?: { goal: string; summary: string; cta: string };
  bounds: AdPlanBounds;
  voiceMode: VoiceMode;
  /** One line per image, already numbered by position: "[product] a red tin of tea …". */
  images: string[];
  videos: Array<{ label: string; durationSec: number }>;
  audios: Array<{ label: string; durationSec: number }>;
  hasLogo: boolean;
}

/** Step 1 (planner, Opus): the structured ad plan. Everything the video model is later told is derived from this. */
export function buildAdPlanPrompt(input: AdPlanPromptInput) {
  const { business, bounds } = input;
  const type = resolvePromotionType(business);
  const facts = [...promotionFactLines(business, type), business.description ? `소개: ${business.description}` : null, business.brand_tone ? `브랜드 톤: ${business.brand_tone}` : null, business.keywords.length ? `업체 키워드: ${business.keywords.join(", ")}` : null].filter(Boolean);
  const system = [
    "You are the creative director of a small-business advertising agency in Korea. You plan ONE vertical (9:16) video ad that an AI video model will generate in a single pass, with sound, from the owner's own photos, clips and music.",
    "You write a precise plan; you do not write the final prompt. The viewer is a Korean smartphone user scrolling a feed, so the first two seconds must stop the scroll with the real subject, not a logo or a title card.",
    `Ad rules: never invent prices, discounts, awards, rankings, statistics, opening hours, phone numbers, reviews, effects or features. Use only the FACTS. No unprovable superlatives (${UNPROVABLE_CLAIMS.join(", ")}). Text on screen is added by the app afterwards: never plan baked-in text, subtitles or logos inside the footage.`,
    "The model keeps people, products and packaging faithful to the reference images, so the plan must say what each reference is for and what must not change (shape, colour, label text, packaging). Never ask it to redraw a label, a screen or a logo: those are laid over the finished video by the app (an 'exact' image).",
    ...promotionGuidance(type, "shorts"),
    "FACTS (the only things you may state as true):",
    ...facts,
  ].join("\n");

  const lines = [
    "AUTOBIZ_AD_PLAN_V1",
    `DURATION=${bounds.durationSec}`,
    `IMAGE_COUNT=${bounds.imageCount}`,
    `VIDEO_COUNT=${bounds.videoCount}`,
    `AUDIO_COUNT=${bounds.audioCount}`,
    `Plan a ${bounds.durationSec}-second ${PROMOTION_LABEL[type]} ad.`,
    input.topic ? `Use exactly this planned topic without replacing it: "${input.topic}".` : "Choose one specific ad topic that fits what is promoted.",
    input.rejectedTopic ? `Do not use this topic (too close to a recent video): ${input.rejectedTopic}.` : null,
    input.recentTopics.length ? `Recent video topics (be clearly different): ${input.recentTopics.slice(0, 10).join(", ")}.` : null,
    input.brief ? `The owner's request (follow it): ${input.brief}` : null,
    input.calendar ? `Content calendar goal: ${input.calendar.goal}\nContent brief: ${input.calendar.summary}\nCall to action: ${input.calendar.cta}` : null,
    input.images.length ? `Reference images (number them as "image N"):\n${input.images.map((line, index) => `${index + 1}. ${line}`).join("\n")}` : "There are no reference images: describe the subject fully in the storyboard.",
    input.videos.length ? `Reference videos:\n${input.videos.map((video, index) => `${index + 1}. ${video.label || "참고 영상"} (${video.durationSec}s)`).join("\n")}` : null,
    input.audios.length ? `Reference audio:\n${input.audios.map((audio, index) => `${index + 1}. ${audio.label || "참고 음원"} (${audio.durationSec}s)`).join("\n")}` : null,
    bounds.exactImages.length ? `Images ${bounds.exactImages.join(", ")} are 'exact' images (a real label, package or screen). Do not ask the model to redraw them; plan an insert for each in 'inserts' (3 seconds near the end is typical).` : null,
    input.hasLogo ? "The owner's logo exists; the app overlays it. Say where it should sit (logo.position) and keep that corner free." : "There is no logo: set logo.show to false.",
    input.voiceMode === "native"
      ? `Narration: write the whole Korean voice-over in 'narration' (about ${Math.round(bounds.durationSec * NARRATION_CHARS_PER_SECOND)} characters without spaces at most), and the line spoken in each scene in storyboard[].narration. The model speaks it.`
      : `Narration: write the whole Korean voice-over in 'narration' (about ${Math.round(bounds.durationSec * NARRATION_CHARS_PER_SECOND)} characters without spaces at most). It will be recorded separately by a Korean voice, so the video itself has no speech: plan music and sound effects for it.`,
    `Storyboard: 4-8 scenes from 0 to ${bounds.durationSec} seconds with no gaps. Scene 1 is the hook and lasts about ${HOOK_SECONDS} seconds. Give the call to action (cta.text, at most 26 Korean characters) a start time in the last 5 seconds.`,
    "Return JSON with exactly these fields:",
    '{ "topic": "...", "concept": "the one idea of this ad", "message": "the single message the viewer should remember", "audience": "who this is for", "hook": { "text": "what stops the scroll", "visual": "English, what is seen in the first 2 s" }, "storyboard": [{ "startSec": 0, "endSec": 2, "visual": "English", "camera": "English camera move", "narration": "Korean line or empty" }], "references": [{ "type": "image|video|audio", "index": 1, "role": "English: what this reference is and how to use it" }], "look": { "camera": "...", "lighting": "...", "color": "..." }, "audio": { "music": "English music direction", "sfx": ["English sound effects"] }, "narration": "the whole Korean voice-over", "cta": { "text": "Korean, short", "startSec": 22 }, "logo": { "show": true, "position": "top-right" }, "inserts": [{ "imageIndex": 2, "startSec": 21, "endSec": 24 }], "preservation": ["English: specific things that must stay exactly as in the references"] }',
  ];
  return { system, prompt: lines.filter(Boolean).join("\n") };
}

/** The standing rules every prompt carries. Each has a pattern used to check that prompt expansion did not drop it. */
export interface RequiredProhibition {
  id: "no-text" | "keep-references" | "no-invention" | "no-distortion" | "no-speech";
  text: string;
  appliesTo: VoiceMode | "all";
  pattern: RegExp;
}

export const REQUIRED_PROHIBITIONS: RequiredProhibition[] = [
  { id: "no-text", appliesTo: "all", text: "Do not render any text, subtitles, captions, watermarks or logos in the video; on-screen text is added afterwards.", pattern: /(\b(no|not|without|never|avoid|omit|exclude)\b[^.]{0,80}\b(text|subtitle|caption|watermark)|\b(text|subtitle|caption|watermark)s?\b[^.]{0,60}\b(not allowed|forbidden|prohibited|banned|excluded|absent|never)\b)/i },
  { id: "keep-references", appliesTo: "all", text: "Keep every product, package and person exactly as in the reference images: same shape, colour, label and packaging text; never redraw, warp or restyle them.", pattern: /(exact|same|unchanged|faithful|preserv|keep)\b[^.]{0,100}\b(product|package|packaging|shape|label|reference)/i },
  { id: "no-invention", appliesTo: "all", text: "Do not invent screens, interfaces, prices, phone numbers or brand names that are not in the references.", pattern: /(no|not|never|avoid)\b[^.]{0,80}\b(invent|fabricat|made-up|fake|unreferenced)/i },
  { id: "no-distortion", appliesTo: "all", text: "No distorted hands, faces or objects; no flicker or morphing between shots.", pattern: /(distort|morph|flicker|warp)/i },
  { id: "no-speech", appliesTo: "tts", text: "No speech, no singing and no vocals: music and sound effects only.", pattern: /(no|without)\b[^.]{0,60}\b(speech|spoken|voice|vocal|singing|dialogue)/i },
];

export function prohibitionsFor(voiceMode: VoiceMode): RequiredProhibition[] {
  return REQUIRED_PROHIBITIONS.filter((item) => item.appliesTo === "all" || item.appliesTo === voiceMode);
}

/**
 * Checks the prompt the model actually used (`actual_prompt`, after its own prompt expansion) for the standing rules.
 * Returns the ids that no longer appear, or null when the model did not report its prompt.
 */
export function missingProhibitions(actualPrompt: string | undefined | null, voiceMode: VoiceMode): RequiredProhibition["id"][] | null {
  if (!actualPrompt || !actualPrompt.trim()) return null;
  return prohibitionsFor(voiceMode).filter((item) => !item.pattern.test(actualPrompt)).map((item) => item.id);
}

export interface WanPromptInput {
  plan: AdPlan;
  durationSec: number;
  voiceMode: VoiceMode;
  /** Extra instruction for a second attempt, from what the first one got wrong. */
  retryNote?: string;
}

function times(scene: { startSec: number; endSec: number }): string {
  const format = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
  return `${format(scene.startSec)}-${format(scene.endSec)}s`;
}

/**
 * The prompt for the video model, built from the plan by rules (no AI): the same plan always gives the same prompt, and
 * the standing rules can never be dropped by a creative rewrite. If it is too long, the scene descriptions shrink; the
 * rules do not.
 */
export function buildWanPrompt({ plan, durationSec, voiceMode, retryNote }: WanPromptInput): string {
  const rules = prohibitionsFor(voiceMode).map((item) => item.text).join(" ");
  const references = plan.references
    .slice()
    .sort((a, b) => (a.type === b.type ? a.index - b.index : a.type.localeCompare(b.type)))
    .map((reference) => `${reference.type === "image" ? "Image" : reference.type === "video" ? "Video" : "Audio"} ${reference.index}: ${reference.role}.`);
  const sound = voiceMode === "native"
    ? [`Sound: ${plan.audio.music}.`, plan.audio.sfx.length ? `Sound effects: ${plan.audio.sfx.join(", ")}.` : "", `Korean voice-over (clear, natural, friendly): "${plan.narration}"`]
    : [`Sound: ${plan.audio.music}.`, plan.audio.sfx.length ? `Sound effects: ${plan.audio.sfx.join(", ")}.` : ""];
  const preserve = plan.preservation.length ? `Must stay unchanged: ${plan.preservation.join("; ")}.` : "";

  const build = (sceneChars: number) => {
    const scenes = plan.storyboard.map((scene, index) => {
      const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trim()}…` : value);
      const line = `${times(scene)}${index === 0 ? " (hook)" : ""}: ${clip(scene.visual, sceneChars)} Camera: ${clip(scene.camera, Math.round(sceneChars / 2))}.`;
      return voiceMode === "native" && scene.narration ? `${line} Spoken: "${scene.narration}"` : line;
    });
    return [
      `Vertical 9:16 Korean advertisement, ${durationSec} seconds, one continuous video with natural cuts between the scenes below.`,
      references.length ? `References: ${references.join(" ")}` : "",
      `Concept: ${plan.concept}`,
      `Timeline:\n${scenes.join("\n")}`,
      `Look: ${plan.look.camera}. ${plan.look.lighting}. ${plan.look.color}.`,
      ...sound,
      preserve,
      retryNote ? `Correction for this attempt: ${retryNote}` : "",
    ].filter(Boolean).join("\n");
  };
  const tail = `Rules: ${rules}`;

  for (const sceneChars of [320, 240, 180, 130, 90, 60]) {
    const head = build(sceneChars);
    if (head.length + 1 + tail.length <= WAN_PROMPT_MAX_CHARS) return `${head}\n${tail}`;
  }
  // Last resort: cut the creative part, never the rules.
  return `${build(40).slice(0, WAN_PROMPT_MAX_CHARS - tail.length - 1)}\n${tail}`;
}
