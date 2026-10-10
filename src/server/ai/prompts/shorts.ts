import { z } from "zod";
import type { Business } from "@/types/domain";
import { MAX_SHORTS_REFERENCES, type ShortsFormat, type ShortsStyle } from "@/types/shorts-reference";
import { SHOWCASE_MOTIONS } from "@/server/connectors/video/json2video-showcase";

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

const planCaptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .refine((caption) => (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length >= 3, "caption에는 해시태그가 3개 이상 포함되어야 합니다.");

const imageIndexSchema = z.number().int().min(1).max(MAX_SHORTS_REFERENCES);

/**
 * Character format: one spoken line per scene, each scene a 5 s animated clip of the
 * pictured character (or a tweened still when animation is unavailable).
 */
export const characterSceneSchema = z.object({
  text: z.string().trim().min(1).max(28),
  speaker: z.enum(["main", "partner"]),
  /** 1-based index into the reference images the prompt listed. */
  imageIndex: imageIndexSchema,
  /** English description of what the character does during the line; read by the image-to-video model. */
  action: z.string().trim().min(1).max(300).default("The character moves expressively while talking, subtle camera push-in."),
  motion: z.enum(TWEEN_MOTIONS),
  durationSec: z.number().finite().min(1).max(6),
  visualPrompt: z.string().trim().min(1).max(500).default("참고 이미지 캐릭터 장면"),
});
export type CharacterScene = z.infer<typeof characterSceneSchema>;

/** Showcase format: the owner's photos with a slow pan/zoom, a caption and one narrator. */
export const showcaseSceneSchema = z.object({
  text: z.string().trim().min(1).max(60),
  caption: z.string().trim().min(1).max(26),
  imageIndex: imageIndexSchema,
  motion: z.enum(SHOWCASE_MOTIONS),
  durationSec: z.number().finite().min(2).max(9),
  visualPrompt: z.string().trim().min(1).max(500).default("참고 사진 장면"),
});
export type ShowcaseScenePlan = z.infer<typeof showcaseSceneSchema>;

const planBase = {
  hook: z.string().trim().min(1).max(80),
  caption: planCaptionSchema,
  privacy: z.enum(["private", "unlisted", "public"]),
};

export const characterPlanSchema = z.object({
  format: z.literal("character"),
  ...planBase,
  scenes: z.array(characterSceneSchema).min(4).max(6),
});
export const showcasePlanSchema = z.object({
  format: z.literal("showcase"),
  ...planBase,
  scenes: z.array(showcaseSceneSchema).min(4).max(8),
});
export type CharacterPlan = z.infer<typeof characterPlanSchema>;
export type ShowcasePlan = z.infer<typeof showcasePlanSchema>;
export type ShortsPlan = CharacterPlan | ShowcasePlan;

const CHARACTER_MAX_TOTAL_CHARS = 150;
const SHOWCASE_MAX_TOTAL_CHARS = 260;

/** The plan schema for one run: the AI may only pick a format the owner's images and style allow. */
export function makeShortsPlanSchema(allowed: ShortsFormat[]) {
  return z.discriminatedUnion("format", [characterPlanSchema, showcasePlanSchema]).superRefine((plan, ctx) => {
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
    const maxChars = plan.format === "character" ? CHARACTER_MAX_TOTAL_CHARS : SHOWCASE_MAX_TOTAL_CHARS;
    if (totalChars > maxChars) {
      ctx.addIssue({ code: "custom", path: ["scenes"], message: `대사 전체는 ${maxChars}자 이하여야 합니다.` });
    }
    if (plan.format === "character" && !plan.scenes.some((scene) => scene.speaker === "main")) {
      ctx.addIssue({ code: "custom", path: ["scenes"], message: "캐릭터(main)가 말하는 장면이 한 개 이상 있어야 합니다." });
    }
  });
}

function buildBusinessContext(business: Business): string {
  return [
    "You are a Korean short-form video strategist for a small business.",
    `Business name: ${business.name}`,
    business.industry ? `Industry: ${business.industry}` : null,
    business.location ? `Location: ${business.location}` : null,
    business.description ? `Description: ${business.description}` : null,
    business.target_customer ? `Target customer: ${business.target_customer}` : null,
    business.brand_tone ? `Brand tone: ${business.brand_tone}` : null,
    business.keywords.length ? `Business keywords: ${business.keywords.join(", ")}` : null,
    [
      "Adapt the story and visual language to the business industry and target customer.",
      "Food/retail should show the product, texture, use, or visit moment; beauty/fitness should show a relatable concern and visible process;",
      "professional services should make an abstract problem concrete with a quick example; education should teach one immediately useful insight.",
      "For any other industry, choose equally specific proof and visuals rather than generic stock footage.",
    ].join(" "),
    [
      "Every video must follow this order: Hook -> Problem -> Solution -> CTA.",
      "Hook: stop scrolling in 1-3 seconds with one concrete promise, question, or surprising fact.",
      "Problem: name one situation the target customer immediately recognizes.",
      "Solution: show how this business resolves it with a specific benefit or proof.",
      "CTA: end with one natural next action that matches the business and topic.",
    ].join(" "),
    "Write spoken text in short, natural Korean sentences. Do not make unverifiable guarantees or fabricate prices, reviews, awards, or statistics.",
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

export function buildShortsContentPrompt(business: Business, topic: string, brief?: ShortsCalendarBrief) {
  return {
    system: buildBusinessContext(business),
    prompt: [
      "AUTOBIZ_SHORTS_CONTENT_V1",
      `Create one vertical short-form video plan about this fixed topic: "${topic}".`,
      brief ? `Marketing goal for this video: ${brief.goal}` : null,
      brief ? `Content brief (what the video must cover): ${brief.summary}` : null,
      brief ? `The final CTA scene should lead to: ${brief.cta}` : null,
      "The spoken script and scenes together must follow Hook -> Problem -> Solution -> CTA.",
      "The first scene is the hook and must last 1-3 seconds. The sum of all scene durations must be 15-45 seconds.",
      "Use 4-10 scenes. Each scene text must be a short spoken or on-screen Korean line.",
      "Each visualPrompt must describe a concrete vertical 9:16 shot, including subject, setting, action, framing, and lighting where useful.",
      "caption must contain a natural platform description followed by 3-6 relevant Korean hashtags.",
      'Use privacy "private" so a person can review the generated asset before any future upload flow publishes it.',
      "Return JSON with exactly these fields:",
      '{ "hook": "1-3 second Korean hook", "script": "complete natural Korean spoken script", "scenes": [{ "text": "scene line", "visualPrompt": "specific 9:16 visual direction", "durationSec": 3 }], "caption": "platform description and #hashtags", "privacy": "private" }',
    ].filter(Boolean).join("\n"),
  };
}


export interface ShortsPlanOptions {
  /** One description per reference image, in `imageIndex` order (1-based), already tagged with its subject. */
  references: string[];
  allowedFormats: ShortsFormat[];
  style: ShortsStyle;
  /** The owner's free-text request, if any. */
  brief?: string;
  /** True when the reference images include the 이지 마케팅 mascot. */
  mascot: boolean;
  calendar?: ShortsCalendarBrief;
}

const COMEDY_RULES = [
  "Comedy techniques to use (pick two or three, do not explain the joke): an exaggerated reaction, a wordplay or pun on the topic, a relatable complaint turned upside down, a twist in the last-but-one line, a deadpan understatement.",
  'The partner is never shown: it is the other voice the character talks with (a busy owner, a customer, a friend). Use partner lines to set up a problem; use main lines for the funny answer and the solution.',
  "Never make the character mock the viewer or any real person, brand, or group. Keep it friendly and family-safe.",
];

export function buildShortsPlanPrompt(business: Business, topic: string, options: ShortsPlanOptions) {
  const canCharacter = options.allowedFormats.includes("character");
  const canShowcase = options.allowedFormats.includes("showcase");
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
      : options.style === "showcase"
        ? "The owner chose a photo showcase of their own pictures."
        : "The owner did not pin a style: decide the format from the owner's request and the kind of each image.";

  const system = [
    buildBusinessContext(business),
    "You are now planning a short-form video built from the owner's reference images. Each image is tagged with what it shows: [character], [product], [place], [person] or [other].",
    ...mascotFacts,
    styleHint,
  ].join("\n");

  const formatRules: string[] = [];
  if (canCharacter && canShowcase) {
    formatRules.push(
      'Choose "format" yourself from the owner\'s request: use "character" when a [character] image should act out the promotion (funny skit, mascot introduction, story), and "showcase" when the video should simply show and describe the owner\'s real shop, product, menu, or office photos. If the request does not say, prefer "character" when the request mentions a character/mascot, otherwise "showcase".',
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
  if (canShowcase) {
    formatRules.push(
      'format "showcase": 4 to 8 scenes, each shows one photo. "text" is the narration (at most 60 Korean characters, friendly 요체, 260 characters in total), "caption" is a short on-screen phrase (at most 26 characters). Only use non-[character] images and say only what the label, the business information, or the owner\'s request supports: never invent prices, ingredients, years, awards, or reviews. Do not guess anything about people in [person] photos. "motion" is one of zoom-in, zoom-out, pan-left, pan-right, pan-up, pan-down.',
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
      "- durationSec is your estimate of the spoken line (about 1 second per 5 Korean characters, minimum 1); durations add up to 15-32 seconds for character and 15-40 for showcase.",
      "- caption: a natural description followed by 3-6 relevant Korean hashtags.",
      'Use privacy "private" so a person can review the video before it is published.',
      "Return JSON with exactly these fields (scene fields depend on the format):",
      '{ "format": "character", "hook": "the first line", "scenes": [{ "text": "spoken line", "speaker": "main", "imageIndex": 1, "action": "The robot waves its arm with a cheerful wink.", "motion": "pop", "durationSec": 2 }], "caption": "description and #hashtags", "privacy": "private" }',
      '{ "format": "showcase", "hook": "the first line", "scenes": [{ "text": "narration", "caption": "short caption", "imageIndex": 2, "motion": "zoom-in", "durationSec": 4 }], "caption": "description and #hashtags", "privacy": "private" }',
    ].filter(Boolean).join("\n"),
  };
}
