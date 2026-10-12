import { z } from "zod";
import { PROMOTION_LABEL } from "@/types/promotion";
import { UNPROVABLE_CLAIMS } from "@/server/ai/blog-quality";
import type { ShortsMetaContext } from "@/server/shorts/publishing-metadata";

const text = z.string().optional().catch(undefined);
const list = z.array(z.string()).optional().catch(undefined);

/** A bad field falls back to undefined; the app then fills that field from the script by rules. */
export const aiShortsPublishingSchema = z.object({
  title: text,
  alternativeTitles: list,
  description: text,
  keywords: list,
  hashtags: list,
  callToAction: text,
  summary: text,
  youtubeTitle: text,
  instagramHook: text,
});

const TYPE_FOCUS = {
  STORE: "STORE: area, the shop, the customer experience, and a reason to visit or book. Mention the area only if it is in the facts.",
  PRODUCT: "PRODUCT: the product's advantage, when it is used, which problem it solves, and a reason to buy.",
  PLATFORM: "PLATFORM: the problem the service solves, the real feature shown, a usage example, and a reason to sign up.",
} as const;

export function buildShortsPublishingPrompt(context: ShortsMetaContext) {
  const system = [
    "You write the posting text (title, description, keywords, hashtags) for a finished Korean short-form video, for YouTube Shorts and Instagram Reels.",
    `What is promoted: a ${PROMOTION_LABEL[context.promotionType]} (${context.promotionType}) called ${context.businessName}${context.industry ? `, industry: ${context.industry}` : ""}${context.location ? `, location: ${context.location}` : ""}.`,
    TYPE_FOCUS[context.promotionType],
    "Base everything ONLY on the video's real script below. Never write a title or claim that the video does not show or say; no clickbait that is unrelated to the video; no invented prices, discounts, awards, statistics or effects.",
    `Never use unprovable claims (${UNPROVABLE_CLAIMS.join(", ")}) or sensational words.`,
    "YouTube: the title is clear and search-friendly with the main keyword first (at most 60 characters). Instagram: a natural caption whose first line works before 'more', and a few relevant hashtags.",
    "Hashtags and keywords must be words that appear in the script or that the owner chose; 4-8 hashtags, no spaces inside a tag.",
  ].join("\n");

  const prompt = [
    "AUTOBIZ_SHORTS_PUBLISHING_V1",
    `Topic: ${context.topic}`,
    `Spoken hook: ${context.hook}`,
    "Script, scene by scene:",
    ...context.sceneTexts.map((line, index) => `${index + 1}. ${line}`),
    `Owner keywords: ${context.keywords.join(", ") || "(none)"}`,
    "Return JSON with exactly these fields (all Korean, hashtags without #):",
    '{ "title": "main video title", "alternativeTitles": ["alt 1", "alt 2"], "description": "2-4 natural sentences about the video, no hashtags", "keywords": ["..."], "hashtags": ["..."], "callToAction": "one natural sentence", "summary": "what the video shows, one sentence", "youtubeTitle": "search-friendly title up to 60 characters", "instagramHook": "first caption line up to 80 characters" }',
  ].join("\n");
  return { system, prompt };
}
