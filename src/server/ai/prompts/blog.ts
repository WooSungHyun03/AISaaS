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

const WRITING_RULES = [
  "Writing rules:",
  "- Write like a real owner or staff member of this business talking to a local customer: concrete, specific, calm. No hype.",
  "- Use only facts given in the business information. Never invent prices, discounts, awards, reviews, statistics, opening hours, addresses or events. If a detail is unknown, write around it instead of guessing.",
  "- Avoid stock AI-sounding phrases and openers (e.g. \"안녕하세요, 오늘은~\", \"알아보겠습니다\", \"결론적으로\", \"~해보는 건 어떨까요?\"), superlatives like \"최고의\"/\"압도적인\", excessive exclamation marks and emoji.",
  "- Vary sentence length and sentence openings. No bullet lists or numbered lists; write flowing paragraphs.",
  "- Use the primary keyword naturally two or three times at most. Never repeat a keyword just to rank.",
  "- End with one soft, specific call to action that fits the business — not a hard sell.",
].join("\n");

function buildBusinessContext(business: Business, config?: BlogAutomationConfig): string {
  return [
    "You are a marketing content writer for a small business, writing in Korean.",
    WRITING_RULES,
    `Business name: ${business.name}`,
    business.industry ? `Industry: ${business.industry}` : null,
    business.location ? `Location: ${business.location}` : null,
    business.description ? `Description: ${business.description}` : null,
    business.main_offering ? `Main products/services: ${business.main_offering}` : null,
    business.strengths ? `Strengths: ${business.strengths}` : null,
    business.marketing_goal ? `Marketing goal: ${business.marketing_goal}` : null,
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
export function buildBlogBodyPrompt(
  business: Business,
  topic: string,
  title: string,
  config?: BlogAutomationConfig,
  /** Problems found in a previous draft (see assessBlogBody) — fix all of them in this rewrite. */
  fixes: string[] = [],
) {
  const system = buildBusinessContext(business, config);

  const prompt = [
    `Write the full marketing blog post body for the topic "${topic}" with the title "${title}".`,
    "Length: 4-5 paragraphs, roughly 700-1,200 Korean characters in total.",
    fixes.length ? `Your previous draft had these problems. Rewrite it and fix every one:\n${fixes.map((fix) => `- ${fix}`).join("\n")}` : null,
    "Return JSON with exactly these fields:",
    '{ "hook": "one opening sentence to grab attention before the body starts", "excerpt": "1-2 sentence summary for previews", "bodyHtml": "the full post body as simple HTML using only <p> paragraph tags, 4-5 paragraphs", "keywords": ["keyword1", "keyword2"], "seoKeywords": ["search-focused keyword1", "search-focused keyword2"], "callToAction": "one short closing call-to-action sentence", "imageSuggestion": "where to place one image and what it should show, in Korean" }',
  ]
    .filter(Boolean)
    .join("\n");

  return { system, prompt };
}
