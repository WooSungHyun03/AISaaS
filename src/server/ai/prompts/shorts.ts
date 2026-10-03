import { z } from "zod";
import type { Business } from "@/types/domain";

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
      avoid,
      "Return JSON with exactly this field:",
      '{ "topic": "short Korean topic phrase" }',
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function buildShortsContentPrompt(business: Business, topic: string) {
  return {
    system: buildBusinessContext(business),
    prompt: [
      "AUTOBIZ_SHORTS_CONTENT_V1",
      `Create one vertical short-form video plan about this fixed topic: "${topic}".`,
      "The spoken script and scenes together must follow Hook -> Problem -> Solution -> CTA.",
      "The first scene is the hook and must last 1-3 seconds. The sum of all scene durations must be 15-45 seconds.",
      "Use 4-10 scenes. Each scene text must be a short spoken or on-screen Korean line.",
      "Each visualPrompt must describe a concrete vertical 9:16 shot, including subject, setting, action, framing, and lighting where useful.",
      "caption must contain a natural platform description followed by 3-6 relevant Korean hashtags.",
      'Use privacy "private" so a person can review the generated asset before any future upload flow publishes it.',
      "Return JSON with exactly these fields:",
      '{ "hook": "1-3 second Korean hook", "script": "complete natural Korean spoken script", "scenes": [{ "text": "scene line", "visualPrompt": "specific 9:16 visual direction", "durationSec": 3 }], "caption": "platform description and #hashtags", "privacy": "private" }',
    ].join("\n"),
  };
}
