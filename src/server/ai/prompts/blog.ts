import { z } from "zod";
import type { Business } from "@/types/domain";
import type { BlogAutomationConfig } from "@/types/blog-automation";

export const blogContentSchema = z.object({
  topic: z.string().min(1),
  title: z.string().min(1),
  content: z.string().min(1),
});

export type BlogContent = z.infer<typeof blogContentSchema>;

export function buildBlogPrompt(business: Business, recentTopics: string[], config?: BlogAutomationConfig) {
  const system = [
    "You are a marketing content writer for a small business, writing in Korean.",
    `Business name: ${business.name}`,
    business.industry ? `Industry: ${business.industry}` : null,
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

  const avoid = recentTopics.length
    ? `Do not repeat these recently used topics: ${recentTopics.join(", ")}.`
    : "";

  const prompt = [
    "Pick one blog topic relevant to this business and write a short marketing blog post about it.",
    avoid,
    "Return JSON with exactly these fields:",
    '{ "topic": "short topic phrase", "title": "catchy blog title", "content": "the full blog post body, 3-5 short paragraphs" }',
  ]
    .filter(Boolean)
    .join("\n");

  return { system, prompt };
}
