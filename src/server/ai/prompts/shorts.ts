import { z } from "zod";
import type { Business } from "@/types/domain";
import { MAX_SHORTS_REFERENCES, type ShortsFormat, type ShortsStyle } from "@/types/shorts-reference";
import { promotionFactLines, promotionGuidance, resolvePromotionType } from "@/server/promotion/strategy";
import { PROMOTION_LABEL } from "@/types/promotion";

/** Fallback movements when the image is only tweened (no animation service); see json2video-skit.ts. */
const TWEEN_MOTIONS = ["pop", "bounce", "wobble", "shake", "slide", "zoom"] as const;

export const shortsTopicSchema = z.object({
  topic: z.string().trim().min(1).max(120),
});
export type ShortsTopic = z.infer<typeof shortsTopicSchema>;

export const shortsSceneSchema = z.object({
  text: z.string().trim().min(1).max(180),
  visualPrompt: z.string().trim().min(1).max(500),
  durationSec: z.number().finite().min(1).max(15),
});

export const shortsContentSchema = z
  .object({
    hook: z.string().trim().min(1).max(80),
    script: z.string().trim().min(1).max(1_200),
    scenes: z.array(shortsSceneSchema).min(4).max(10),
    caption: z
      .string()
      .trim()
      .min(1)
      .max(1_000)
      .refine(
        (caption) => (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length >= 3,
        "caption에는 해시태그가 3개 이상 포함되어야 합니다.",
      ),
    privacy: z.enum(["private", "unlisted", "public"]),
  })
  .superRefine((content, ctx) => {
    const totalDuration = content.scenes.reduce((total, scene) => total + scene.durationSec, 0);
    if (totalDuration < 15 || totalDuration > 45) {
      ctx.addIssue({
        code: "custom",
        path: ["scenes"],
        message: "장면 길이의 합은 15초 이상 45초 이하여야 합니다.",
      });
    }
    if (content.scenes[0] && content.scenes[0].durationSec > 3) {
      ctx.addIssue({
        code: "custom",
        path: ["scenes", 0, "durationSec"],
        message: "첫 후킹 장면은 1~3초여야 합니다.",
      });
    }
  });
export type ShortsContent = z.infer<typeof shortsContentSchema>;

/**
 * One spoken line per scene, each scene a 5 s animated clip of the pictured
 * character (or a tweened still when animation is unavailable).
 */
export const characterSceneSchema = z.object({
  text: z.string().trim().min(1).max(28),
  speaker: z.enum(["main", "partner"]),
  /** 1-based index into the character images the prompt listed. */
  imageIndex: z.number().int().min(1).max(MAX_SHORTS_REFERENCES),
  /** English description of what the character does during the line; read by the image-to-video model. */
  action: z.string().trim().min(1).max(300).default("The character moves expressively while talking, subtle camera push-in."),
  motion: z.enum(TWEEN_MOTIONS),
  durationSec: z.number().finite().min(1).max(6),
  visualPrompt: z.string().trim().min(1).max(500).default("참고 이미지 캐릭터 장면"),
});
export type CharacterScene = z.infer<typeof characterSceneSchema>;

export const PROMO_CAMERAS = ["push-in", "pull-out", "pan-left", "pan-right", "tilt-up", "tilt-down"] as const;
export type PromoCamera = (typeof PROMO_CAMERAS)[number];

/** Promo format: one of the owner's photos per scene, narrated, optionally really animated. There are no on-screen captions. */
export const promoSceneSchema = z.object({
  /** Narration for this scene (spoken). */
  text: z.string().trim().min(1).max(42),
  imageIndex: z.number().int().min(1).max(MAX_SHORTS_REFERENCES),
  /** Slow camera move used when the photo is only panned/zoomed (and as direction for the animator). */
  camera: z.enum(PROMO_CAMERAS),
  /** True when image-to-video should bring this photo to life (steam, pouring, light, a slow push-in …). */
  animate: z.boolean().default(false),
  /** English direction for the animator: camera move first, then subtle ambient motion. Only read when `animate`. */
  motionPrompt: z.string().trim().max(240).default(""),
  durationSec: z.number().finite().min(2).max(7),
  visualPrompt: z.string().trim().min(1).max(500).default("참고 이미지 홍보 장면"),
});
export type PromoScene = z.infer<typeof promoSceneSchema>;

/** What to play under the voice when no music was chosen. */
export const DEFAULT_MUSIC_PROMPT = "Warm, upbeat instrumental pop with a light beat, friendly and modern, no vocals.";

const planBase = {
  hook: z.string().trim().min(1).max(80),
  /** English direction for an instrumental background track that fits the video's mood. */
  music: z.string().trim().min(1).max(300).default(DEFAULT_MUSIC_PROMPT),
  caption: z
    .string()
    .trim()
    .min(1)
    .max(1_000)
    .refine((caption) => (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length >= 3, "caption에는 해시태그가 3개 이상 포함되어야 합니다."),
  privacy: z.enum(["private", "unlisted", "public"]),
};

export const characterPlanSchema = z.object({ format: z.literal("character"), ...planBase, scenes: z.array(characterSceneSchema).min(4).max(6) });
export const promoPlanSchema = z.object({ format: z.literal("promo"), ...planBase, scenes: z.array(promoSceneSchema).min(4).max(7) });
export type CharacterPlan = z.infer<typeof characterPlanSchema>;
export type PromoPlan = z.infer<typeof promoPlanSchema>;
export type ShortsPlan = CharacterPlan | PromoPlan;

const CHARACTER_MAX_TOTAL_CHARS = 150;
const PROMO_MAX_TOTAL_CHARS = 260;
export const MAX_ANIMATED_PROMO_SCENES = 4;

/** The plan schema for one run: the AI may only pick a format the owner's images and style allow. */
export function makeShortsPlanSchema(allowed: ShortsFormat[]) {
  return z.discriminatedUnion("format", [characterPlanSchema, promoPlanSchema]).superRefine((plan, ctx) => {
    if (!allowed.includes(plan.format)) {
      ctx.addIssue({ code: "custom", path: ["format"], message: `format은 ${allowed.join(" 또는 ")} 중 하나여야 합니다.` });
    }
    const totalDuration = plan.scenes.reduce((total, scene) => total + scene.durationSec, 0);
    const maxDuration = plan.format === "character" ? 32 : 40;
    if (totalDuration < 15 || totalDuration > maxDuration) {
      ctx.addIssue({ code: "custom", path: ["scenes"], message: `장면 길이의 합은 15초 이상 ${maxDuration}초 이하여야 합니다.` });
    }
    if (plan.scenes[0] && plan.scenes[0].durationSec > 3) {
      ctx.addIssue({ code: "custom", path: ["scenes", 0, "durationSec"], message: "첫 후킹 장면은 1~3초여야 합니다." });
    }
    const totalChars = plan.scenes.reduce((total, scene) => total + scene.text.length, 0);
    const maxChars = plan.format === "character" ? CHARACTER_MAX_TOTAL_CHARS : PROMO_MAX_TOTAL_CHARS;
    if (totalChars > maxChars) {
      ctx.addIssue({ code: "custom", path: ["scenes"], message: `대사 전체는 ${maxChars}자 이하여야 합니다.` });
    }
    if (plan.format === "character" && !plan.scenes.some((scene) => scene.speaker === "main")) {
      ctx.addIssue({ code: "custom", path: ["scenes"], message: "캐릭터(main)가 말하는 장면이 한 개 이상 있어야 합니다." });
    }
    if (plan.format === "promo") {
      const animated = plan.scenes.filter((scene) => scene.animate).length;
      if (animated > MAX_ANIMATED_PROMO_SCENES) {
        ctx.addIssue({ code: "custom", path: ["scenes"], message: `움직이게 만드는 장면(animate)은 ${MAX_ANIMATED_PROMO_SCENES}개 이하여야 합니다.` });
      }
      if (plan.scenes.some((scene) => scene.animate && !scene.motionPrompt)) {
        ctx.addIssue({ code: "custom", path: ["scenes"], message: "animate 장면에는 motionPrompt가 필요합니다." });
      }
    }
  });
}

function buildBusinessContext(business: Business): string {
  const type = resolvePromotionType(business);
  return [
    `You are a Korean short-form video strategist. What is promoted: a ${PROMOTION_LABEL[type]} (${type}).`,
    ...promotionFactLines(business, type),
    business.description ? `Description: ${business.description}` : null,
    business.brand_tone ? `Brand tone: ${business.brand_tone}` : null,
    business.keywords.length ? `Keywords: ${business.keywords.join(", ")}` : null,
    ...promotionGuidance(type, "shorts"),
    [
      "Every video follows this order: Hook -> Problem or first impression -> Solution or proof -> CTA, staged with the storyline above.",
      "Hook: stop scrolling in 1-3 seconds with one concrete promise, question, or surprising fact taken from the facts.",
      "CTA: end with one natural next action that matches the type and uses only the address/contact the facts give.",
    ].join(" "),
    "Write spoken text in short, natural Korean sentences. Do not make unverifiable guarantees or fabricate prices, reviews, awards, statistics, user counts or effects.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildShortsTopicPrompt(
  business: Business,
  recentTopics: string[],
  rejectedTopic?: string,
  direction?: string,
) {
  const avoidTopics = rejectedTopic ? [...recentTopics, rejectedTopic] : recentTopics;
  const avoid = avoidTopics.length
    ? `Do not reuse or closely resemble these recent Shorts topics: ${avoidTopics.join(", ")}. Choose a clearly different angle.`
    : "";

  return {
    system: buildBusinessContext(business),
    prompt: [
      "AUTOBIZ_SHORTS_TOPIC_V1",
      "Choose one specific marketing topic for a 15-45 second vertical short-form video.",
      direction ? `The owner's direction for the video (follow it): ${direction}` : null,
      avoid,
      "Return JSON with exactly this field:",
      '{ "topic": "short Korean topic phrase" }',
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export interface ShortsCalendarBrief {
  goal: string;
  summary: string;
  cta: string;
}


export interface ShortsPlanOptions {
  /** One description per reference image, in `imageIndex` order (1-based), tagged [character] / [product] / [place] / [person] / [other]. */
  references: string[];
  allowedFormats: ShortsFormat[];
  style: ShortsStyle;
  /** The owner's free-text request, if any. */
  brief?: string;
  /** True when the images include the 이지 마케팅 mascot. */
  mascot: boolean;
  calendar?: ShortsCalendarBrief;
}

const COMEDY_RULES = [
  "Comedy techniques to use (pick two or three, do not explain the joke): an exaggerated reaction, a wordplay or pun on the topic, a relatable complaint turned upside down, a twist in the last-but-one line, a deadpan understatement.",
  "The partner is never shown: it is the other voice the character talks with (a busy owner, a customer, a friend). Use partner lines to set up a problem; use main lines for the funny answer and the solution.",
  "Never make the character mock the viewer or any real person, brand, or group. Keep it friendly and family-safe.",
];

export function buildShortsPlanPrompt(business: Business, topic: string, options: ShortsPlanOptions) {
  const canCharacter = options.allowedFormats.includes("character");
  const canPromo = options.allowedFormats.includes("promo");
  const mascotFacts = options.mascot
    ? [
      "The mascot images show the robot mascot of the service 이지 마케팅 (Easy Marketing): a friendly, cheeky helper with a blue cape who does marketing work for busy small-business owners.",
      "Facts about 이지 마케팅 you may use: it diagnoses a business's marketing, plans a content calendar, writes blog post drafts, and makes short-form videos with AI. Do not invent prices, numbers, awards, or user counts.",
    ]
    : [];
  const styleHint = options.style === "skit"
    ? "The owner chose a funny character skit."
    : options.style === "explainer"
      ? "The owner chose a friendly step-by-step character explainer."
      : options.style === "promo"
        ? "The owner chose a product / place promo built from their own photos."
        : "The owner did not pin a style: decide the format from the owner's request and what each image shows.";

  const system = [
    buildBusinessContext(business),
    "You are now planning a short-form AD video (TikTok / Instagram Reels / YouTube Shorts) from the owner's reference images. Each image is tagged with what it shows: [character], [product], [place], [person] or [other].",
    "How good ad shorts work: the first 1-2 seconds stop the scroll with the SPOKEN hook (a question, a surprising benefit, a relatable problem, a funny line); there are no captions, so the voice and the picture carry everything; one clear message; 15-30 seconds; every scene shows something concrete; the last scene tells the viewer exactly what to do next.",
    ...mascotFacts,
    styleHint,
  ].join("\n");

  const formatRules: string[] = [];
  if (canCharacter && canPromo) {
    formatRules.push(
      'Choose "format" yourself from the owner\'s request and the images: "character" when a [character] image should act out the promotion (funny skit, mascot introduction, story); "promo" when the video should show and advertise the owner\'s real product, menu, shop or office photos. If the request does not say, use "character" when the request mentions a character or mascot, otherwise "promo".',
    );
  } else {
    formatRules.push(`Use format "${options.allowedFormats[0]}".`);
  }
  if (canCharacter) {
    formatRules.push(
      'format "character": 4 to 6 scenes. Each scene is ONE spoken line of at most 28 Korean characters (short 요체), all lines together under 150 characters. Only use [character] images. "speaker" is "main" (the pictured character) or "partner" (an unseen second voice); use "main" for most lines and the last. "action" is ONE English sentence about what the pictured character does during the line (gesture, expression, small movement; keep its design unchanged, no new characters, no text, no camera cuts). "motion" (pop, bounce, wobble, shake, slide, zoom) is only a fallback effect.',
    );
    if (options.style !== "explainer") formatRules.push(COMEDY_RULES.join(" "));
  }
  if (canPromo) {
    formatRules.push(
      [
        'format "promo": 4 to 7 scenes, each shows ONE photo (never a [character] image); one narrator.',
        'Structure: scene 1 = hook (at most 12 Korean characters, 1-3 s: a question, a desire or a problem the viewer feels, no invented numbers) -> show the product or place at its most appealing -> two or three concrete highlights taken ONLY from what the image descriptions, the business information and the owner\'s request say -> proof only if it was given to you -> last scene = call to action with the business name and how to visit or order (only given details).',
        '"text" is the narration (at most 42 Korean characters per scene, 260 in total, friendly salesperson 요체); there are no on-screen captions, so every scene must be understandable from the voice and the picture.',
        `"camera" is the slow move for the photo: ${PROMO_CAMERAS.join(", ")}; vary it. "animate" is true for at most ${MAX_ANIMATED_PROMO_SCENES} scenes where real motion adds value (steam, pouring, sizzling, light glints, a slow push-in on the hero shot) and NEVER for a [person] photo; for those scenes "motionPrompt" is English: first the camera move, then one subtle ambient motion that already belongs in the photo. Never ask the animator to change, add or remove anything in the product, packaging or text.`,
        "Never state a price, discount, opening hours, address, ingredient, award or statistic that was not given to you; never use unprovable claims such as 최고, 1등, 유일, 100%.",
      ].join(" "),
    );
  }

  return {
    system,
    prompt: [
      "AUTOBIZ_SHORTS_PLAN_V1",
      `Plan one vertical short-form video about this fixed topic: "${topic}".`,
      options.brief ? `The owner's request (follow it): ${options.brief}` : null,
      options.calendar ? `Marketing goal for this video: ${options.calendar.goal}` : null,
      options.calendar ? `Content brief (what the video must cover): ${options.calendar.summary}` : null,
      options.calendar ? `The last scene should lead to: ${options.calendar.cta}` : null,
      "Reference images (use imageIndex to choose the one on screen for each scene; match the image to the line and change images between scenes):",
      options.references.map((description, index) => `${index + 1}. ${description}`).join("\n"),
      "Rules:",
      ...formatRules.map((rule) => `- ${rule}`),
      "- Scene 1 is the hook: at most 12 Korean characters, durationSec 1-3, it must stop the scroll.",
      "- Order: hook -> problem or first impression -> solution or highlights -> a clear one-line call to action (last scene).",
      "- durationSec is your estimate of the spoken line (about 1 second per 5 Korean characters, minimum 1; promo scenes at least 2); durations add up to 15-32 seconds for character and 15-40 for promo.",
      '- "music": English direction for the instrumental background track: mood, instruments, tempo that fit this video (funny skit = playful and bouncy, cozy cafe = warm acoustic, tech = clean and modern). Always instrumental, no vocals.',
      "- caption: a natural description followed by 3-6 relevant Korean hashtags.",
      'Use privacy "private" so a person can review the video before it is published.',
      "Return JSON with exactly these fields (scene fields depend on the format):",
      '{ "format": "character", "hook": "the first line", "scenes": [{ "text": "spoken line", "speaker": "main", "imageIndex": 1, "action": "The robot waves its arm with a cheerful wink.", "motion": "pop", "durationSec": 2 }], "music": "Playful, bouncy instrumental with ukulele and light drums.", "caption": "description and #hashtags", "privacy": "private" }',
      '{ "format": "promo", "hook": "the first line", "scenes": [{ "text": "narration", "imageIndex": 2, "camera": "push-in", "animate": true, "motionPrompt": "Slow push-in; steam rises gently from the cup.", "durationSec": 4 }], "music": "Warm acoustic guitar with a soft beat.", "caption": "description and #hashtags", "privacy": "private" }',
    ].filter(Boolean).join("\n"),
  };
}
