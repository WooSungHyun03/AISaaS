import { z } from "zod";
import type { Business } from "@/types/domain";

export const instagramCaptionSchema = z.object({
  topic: z.string().min(1),
  caption: z.string().min(1),
  hashtags: z.array(z.string().min(1)).min(3).max(15),
});
export type InstagramCaption = z.infer<typeof instagramCaptionSchema>;

function buildBusinessContext(business: Business): string {
  return [
    "You are a social media marketer for a small business, writing in Korean.",
    `Business name: ${business.name}`,
    business.industry ? `Industry: ${business.industry}` : null,
    business.location ? `Location: ${business.location}` : null,
    business.description ? `Description: ${business.description}` : null,
    business.target_customer ? `Target customer: ${business.target_customer}` : null,
    business.brand_tone ? `Brand tone: ${business.brand_tone}` : null,
    business.keywords.length ? `Keywords to weave in naturally: ${business.keywords.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Day 9: the post always uses the same static marketing-card image (see
 * ensureMarketingCardImageUrl()), so the caption carries the entire
 * per-post message — no image description is requested here.
 */
export function buildInstagramCaptionPrompt(business: Business, recentTopics: string[], rejectedTopic?: string) {
  const system = buildBusinessContext(business);
  const avoidTopics = rejectedTopic ? [...recentTopics, rejectedTopic] : recentTopics;
  const avoid = avoidTopics.length
    ? `Do not reuse or closely resemble these recently used topics — pick something clearly different: ${avoidTopics.join(", ")}.`
    : "";

  const prompt = [
    "Write a single Instagram post for this business. The post image is a fixed branded marketing card — it carries no text of its own, so the caption must stand entirely on its own as the message.",
    avoid,
    "Return JSON with exactly these fields:",
    '{ "topic": "short topic phrase describing this post", "caption": "an engaging Instagram caption in Korean, 2-4 short paragraphs, sparing emoji use, ending with a soft call-to-action", "hashtags": ["5 to 10 relevant hashtags, each a single word with no # symbol and no spaces"] }',
  ]
    .filter(Boolean)
    .join("\n");

  return { system, prompt };
}
