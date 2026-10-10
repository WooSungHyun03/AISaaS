import { z } from "zod";
import type { Business } from "@/types/domain";
import { MAX_SHORTS_REFERENCES, type ShortsStyle } from "@/types/shorts-reference";

const SKIT_MOTIONS = ["pop", "bounce", "wobble", "shake", "slide", "zoom"] as const;

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

/** One line of a character skit: who says it, which reference image is on screen, and how it moves. */
export const shortsSkitSceneSchema = z.object({
  text: z.string().trim().min(1).max(45),
  speaker: z.enum(["main", "partner"]),
  /** 1-based index into the reference images the prompt listed. */
  imageIndex: z.number().int().min(1).max(MAX_SHORTS_REFERENCES),
  motion: z.enum(SKIT_MOTIONS),
  durationSec: z.number().finite().min(1).max(12),
  visualPrompt: z.string().trim().min(1).max(500).default("참고 이미지 캐릭터 장면"),
});
export type ShortsSkitScene = z.infer<typeof shortsSkitSceneSchema>;

/** Spoken characters across a whole skit; keeps the video near 20-35 s so it renders inside one request. */
const SKIT_MAX_TOTAL_CHARS = 190;

export const shortsSkitContentSchema = z
  .object({
    hook: z.string().trim().min(1).max(80),
    scenes: z.array(shortsSkitSceneSchema).min(4).max(8),
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
    if (totalDuration < 15 || totalDuration > 40) {
      ctx.addIssue({ code: "custom", path: ["scenes"], message: "장면 길이의 합은 15초 이상 40초 이하여야 합니다." });
    }
    if (content.scenes[0] && content.scenes[0].durationSec > 3) {
      ctx.addIssue({ code: "custom", path: ["scenes", 0, "durationSec"], message: "첫 후킹 장면은 1~3초여야 합니다." });
    }
    const totalChars = content.scenes.reduce((total, scene) => total + scene.text.length, 0);
    if (totalChars > SKIT_MAX_TOTAL_CHARS) {
      ctx.addIssue({ code: "custom", path: ["scenes"], message: `대사 전체는 ${SKIT_MAX_TOTAL_CHARS}자 이하여야 합니다.` });
    }
    if (!content.scenes.some((scene) => scene.speaker === "main")) {
      ctx.addIssue({ code: "custom", path: ["scenes"], message: "캐릭터(main)가 말하는 장면이 한 개 이상 있어야 합니다." });
    }
  });
export type ShortsSkitContent = z.infer<typeof shortsSkitContentSchema>;

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

export interface ShortsSkitOptions {
  /** One description per reference image, in `imageIndex` order (1-based). */
  references: string[];
  style: ShortsStyle;
  /** The owner's free-text direction, if any. */
  brief?: string;
  /** True when the reference images are the 이지 마케팅 mascot. */
  mascot: boolean;
  calendar?: ShortsCalendarBrief;
}

const SKIT_COMEDY_RULES = [
  "Comedy techniques to use (pick two or three, do not explain the joke): an exaggerated reaction, a wordplay or pun on the topic, a relatable complaint turned upside down, a twist in the last-but-one line, a deadpan understatement.",
  "The partner is never shown: it is the other voice the character talks with (a busy owner, a customer, a friend). Use partner lines to set up a problem; use main lines for the funny answer and the solution.",
  "Never make the character mock the viewer or any real person, brand, or group. Keep it friendly and family-safe.",
];

export function buildShortsSkitPrompt(business: Business, topic: string, options: ShortsSkitOptions) {
  const isSkit = options.style === "skit";
  const mascotFacts = options.mascot
    ? [
      "The pictured character is the robot mascot of the service 이지 마케팅 (Easy Marketing): a friendly, cheeky helper with a blue cape who does marketing work for busy small-business owners.",
      "Facts about 이지 마케팅 you may use: it diagnoses a business's marketing, plans a content calendar, writes blog post drafts, and makes short-form videos with AI. Do not invent prices, numbers, awards, or user counts.",
    ]
    : [];
  const system = [
    buildBusinessContext(business),
    "You are now writing a character short-form video: one or more reference images (a character) appear on screen while Korean lines are spoken.",
    ...mascotFacts,
    isSkit
      ? ["This is a funny character skit: a short comedy scene, not an ad read.", ...SKIT_COMEDY_RULES].join(" ")
      : "This is a friendly explainer: the character explains one useful idea step by step in a warm, lively voice.",
  ].join("\n");

  const imageList = options.references.map((description, index) => `${index + 1}. ${description}`).join("\n");
  return {
    system,
    prompt: [
      "AUTOBIZ_SHORTS_SKIT_V1",
      `Write one vertical short-form video about this fixed topic: "${topic}".`,
      options.brief ? `The owner's direction (follow it): ${options.brief}` : null,
      options.calendar ? `Marketing goal for this video: ${options.calendar.goal}` : null,
      options.calendar ? `Content brief (what the video must cover): ${options.calendar.summary}` : null,
      options.calendar ? `The last line should lead to: ${options.calendar.cta}` : null,
      "Reference images (use imageIndex to choose the one on screen for each line; match the pose to the emotion of the line, and change images between lines):",
      imageList,
      "Rules:",
      "- 4 to 7 scenes. Each scene is ONE spoken line of at most 30 Korean characters, in a short natural spoken style (요체).",
      "- All lines together must stay under 170 Korean characters.",
      "- Scene 1 is the hook: at most 12 characters, durationSec 1-3, it must stop the scroll (a question, a shout, or a funny complaint).",
      "- Order: hook -> problem -> solution -> a funny twist -> a clear one-line call to action (last scene).",
      '- "speaker" is "main" (the pictured character) or "partner" (the unseen other voice). Use "main" for most lines and the final call to action.',
      '- "motion" is one of pop, bounce, wobble, shake, slide, zoom: pop for a surprise entrance, bounce for joy, shake for panic or anger, wobble for a thinking or teasing moment, slide for the first appearance, zoom for a dramatic line.',
      "- durationSec is your estimate of the spoken line (about 1 second per 5 characters, minimum 1); durations must add up to 15-40 seconds.",
      "- Do not state any price, statistic, or guarantee that was not given to you.",
      "- caption: a natural description followed by 3-6 relevant Korean hashtags.",
      'Use privacy "private" so a person can review the video before it is published.',
      "Return JSON with exactly these fields:",
      '{ "hook": "the first line", "scenes": [{ "text": "spoken line", "speaker": "main", "imageIndex": 1, "motion": "pop", "durationSec": 2 }], "caption": "description and #hashtags", "privacy": "private" }',
    ].filter(Boolean).join("\n"),
  };
}
