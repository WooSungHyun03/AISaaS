import { z } from "zod";
import type { Business } from "@/types/domain";
import { MAX_SHORTS_REFERENCES, type ShortsStyle } from "@/types/shorts-reference";

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

const MAX_TOTAL_CHARS = 150;
const MAX_TOTAL_SECONDS = 32;

export const shortsPlanSchema = z
  .object({
    hook: z.string().trim().min(1).max(80),
    scenes: z.array(characterSceneSchema).min(4).max(6),
    caption: z
      .string()
      .trim()
      .min(1)
      .max(1_000)
      .refine((caption) => (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length >= 3, "caption에는 해시태그가 3개 이상 포함되어야 합니다."),
    privacy: z.enum(["private", "unlisted", "public"]),
  })
  .superRefine((plan, ctx) => {
    const totalDuration = plan.scenes.reduce((total, scene) => total + scene.durationSec, 0);
    if (totalDuration < 15 || totalDuration > MAX_TOTAL_SECONDS) {
      ctx.addIssue({ code: "custom", path: ["scenes"], message: `장면 길이의 합은 15초 이상 ${MAX_TOTAL_SECONDS}초 이하여야 합니다.` });
    }
    if (plan.scenes[0] && plan.scenes[0].durationSec > 3) {
      ctx.addIssue({ code: "custom", path: ["scenes", 0, "durationSec"], message: "첫 후킹 장면은 1~3초여야 합니다." });
    }
    const totalChars = plan.scenes.reduce((total, scene) => total + scene.text.length, 0);
    if (totalChars > MAX_TOTAL_CHARS) {
      ctx.addIssue({ code: "custom", path: ["scenes"], message: `대사 전체는 ${MAX_TOTAL_CHARS}자 이하여야 합니다.` });
    }
    if (!plan.scenes.some((scene) => scene.speaker === "main")) {
      ctx.addIssue({ code: "custom", path: ["scenes"], message: "캐릭터(main)가 말하는 장면이 한 개 이상 있어야 합니다." });
    }
  });
export type ShortsPlan = z.infer<typeof shortsPlanSchema>;

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


export interface ShortsPlanOptions {
  /** One description per character image, in `imageIndex` order (1-based). */
  references: string[];
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
  const mascotFacts = options.mascot
    ? [
      "The mascot images show the robot mascot of the service 이지 마케팅 (Easy Marketing): a friendly, cheeky helper with a blue cape who does marketing work for busy small-business owners.",
      "Facts about 이지 마케팅 you may use: it diagnoses a business's marketing, plans a content calendar, writes blog post drafts, and makes short-form videos with AI. Do not invent prices, numbers, awards, or user counts.",
    ]
    : [];
  const system = [
    buildBusinessContext(business),
    "You are now planning a character short-form video: the pictured character appears on screen, really moving, while Korean lines are spoken.",
    ...mascotFacts,
    options.style === "skit"
      ? ["This is a funny character skit: a short comedy scene, not an ad read.", ...COMEDY_RULES].join(" ")
      : "This is a friendly explainer: the character explains one useful idea step by step in a warm, lively voice.",
  ].join("\n");

  return {
    system,
    prompt: [
      "AUTOBIZ_SHORTS_PLAN_V1",
      `Plan one vertical short-form video about this fixed topic: "${topic}".`,
      options.brief ? `The owner's request (follow it): ${options.brief}` : null,
      options.calendar ? `Marketing goal for this video: ${options.calendar.goal}` : null,
      options.calendar ? `Content brief (what the video must cover): ${options.calendar.summary}` : null,
      options.calendar ? `The last scene should lead to: ${options.calendar.cta}` : null,
      "Character images (use imageIndex to choose the one on screen for each scene; match the pose to the emotion of the line and change images between scenes):",
      options.references.map((description, index) => `${index + 1}. ${description}`).join("\n"),
      "Rules:",
      "- 4 to 6 scenes. Each scene is ONE spoken line of at most 28 Korean characters (short natural 요체), and all lines together stay under 150 characters.",
      "- Scene 1 is the hook: at most 12 Korean characters, durationSec 1-3, it must stop the scroll (a question, a shout, or a funny complaint).",
      "- Order: hook -> problem -> solution -> a clear one-line call to action (last scene).",
      '- "speaker" is "main" (the pictured character) or "partner" (an unseen second voice). Use "main" for most lines and the last one.',
      '- "action" is ONE English sentence about what the pictured character does during the line (gesture, expression, small movement); keep its design unchanged, no new characters, no text, no camera cuts.',
      '- "motion" (pop, bounce, wobble, shake, slide, zoom) is only a fallback effect: pop for a surprise, bounce for joy, shake for panic, wobble for teasing, slide for an entrance, zoom for drama.',
      "- Do not state any price, statistic, or guarantee that was not given to you.",
      "- durationSec is your estimate of the spoken line (about 1 second per 5 Korean characters, minimum 1); durations add up to 15-32 seconds.",
      "- caption: a natural description followed by 3-6 relevant Korean hashtags.",
      'Use privacy "private" so a person can review the video before it is published.',
      "Return JSON with exactly these fields:",
      '{ "hook": "the first line", "scenes": [{ "text": "spoken line", "speaker": "main", "imageIndex": 1, "action": "The robot waves its arm with a cheerful wink.", "motion": "pop", "durationSec": 2 }], "caption": "description and #hashtags", "privacy": "private" }',
    ].filter(Boolean).join("\n"),
  };
}
