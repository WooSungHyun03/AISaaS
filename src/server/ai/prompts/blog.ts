import { z } from "zod";
import type { Business } from "@/types/domain";
import type { BlogAutomationConfig } from "@/types/blog-automation";

export const blogTopicSchema = z.object({
  topic: z.string().min(1),
  title: z.string().min(1),
});
export type BlogTopic = z.infer<typeof blogTopicSchema>;

export const blogBodySchema = z.object({
  /** Opening hook sentence meant to grab attention before the body proper starts. */
  hook: z.string().min(1),
  excerpt: z.string().min(1),
  bodyHtml: z.string().min(1),
  keywords: z.array(z.string().min(1)).default([]),
  /** Separate from `keywords` (reader-facing topic tags) — terms chosen for search/SEO. */
  seoKeywords: z.array(z.string().min(1)).default([]),
  callToAction: z.string().min(1),
  /** Where to place an image and what it should show, e.g. "도입부 직후: 완성된 디저트 클로즈업 사진". */
  imageSuggestion: z.string().min(1),
});
export type BlogBody = z.infer<typeof blogBodySchema>;

/** Unified shape the pipeline produces (Day 4): stage 1 + stage 2 merged. */
export const blogContentSchema = blogTopicSchema.merge(blogBodySchema);
export type BlogContent = z.infer<typeof blogContentSchema>;

function buildBusinessContext(business: Business, config?: BlogAutomationConfig): string {
  return [
    "You are a marketing content writer for a small business, writing in Korean.",
    "Avoid writing that reads like an obvious ad — no over-the-top sales pressure. Use natural, conversational Korean, and avoid stock AI-sounding phrases/clichés (e.g. \"안녕하세요, 오늘은~\", \"~해보는 건 어떨까요?\", excessive emoji or exclamation marks).",
    `Business name: ${business.name}`,
    business.industry ? `Industry: ${business.industry}` : null,
    business.location ? `Location: ${business.location}` : null,
    business.description ? `Description: ${business.description}` : null,
    business.target_customer ? `Target customer: ${business.target_customer}` : null,
    business.brand_tone ? `Brand tone: ${business.brand_tone}` : null,
    business.keywords.length ? `Keywords to weave in naturally: ${business.keywords.join(", ")}` : null,
    config?.objective ? `This post's marketing goal: ${config.objective}` : null,
    config?.tone ? `Tone for this automation: ${config.tone}` : null,
    config?.keywords.length ? `Primary keywords for this post: ${config.keywords.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Stage 1 of the two-stage pipeline: pick a topic + title only. Kept cheap
 * (small maxTokens) so a near-duplicate topic can be regenerated once
 * without re-writing a full post first.
 */
export function buildBlogTopicPrompt(
  business: Business,
  recentTopics: string[],
  config?: BlogAutomationConfig,
  rejectedTopic?: string,
) {
  const system = buildBusinessContext(business, config);
  const avoidTopics = rejectedTopic ? [...recentTopics, rejectedTopic] : recentTopics;
  const avoid = avoidTopics.length
    ? `Do not reuse or closely resemble these recently used topics — pick something clearly different: ${avoidTopics.join(", ")}.`
    : "";

  const prompt = [
    "Pick one specific blog topic relevant to this business.",
    avoid,
    "Return JSON with exactly these fields:",
    '{ "topic": "short topic phrase", "title": "catchy blog title" }',
  ]
    .filter(Boolean)
    .join("\n");

  return { system, prompt };
}

/** Stage 2: write the full post body for an already-accepted topic/title. */
export function buildBlogBodyPrompt(business: Business, topic: string, title: string, config?: BlogAutomationConfig) {
  const system = buildBusinessContext(business, config);

  const prompt = [
    `Write the full marketing blog post body for the topic "${topic}" with the title "${title}".`,
    "Return JSON with exactly these fields:",
    '{ "hook": "one opening sentence to grab attention before the body starts", "excerpt": "1-2 sentence summary for previews", "bodyHtml": "the full post body as simple HTML using only <p> paragraph tags, 3-5 short paragraphs", "keywords": ["keyword1", "keyword2"], "seoKeywords": ["search-focused keyword1", "search-focused keyword2"], "callToAction": "one short closing call-to-action sentence", "imageSuggestion": "where to place one image and what it should show, in Korean" }',
  ].join("\n");

  return { system, prompt };
}
