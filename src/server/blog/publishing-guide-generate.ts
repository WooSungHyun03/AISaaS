import "server-only";
import { generateStructured } from "@/server/ai/generate";
import { aiGuideDraftSchema, buildBlogGuidePrompt } from "@/server/ai/prompts/blog-guide";
import { buildPublishingGuide, type BlogGuideContext, type BlogPublishingGuide } from "./publishing-guide";
import type { BlogPost } from "./post";

/**
 * The reviewer model (Sonnet) writes style, photo notes and SEO for the finished post. The answer is checked field by
 * field (publishing-guide.ts); if the call fails — or the spend budget has no room for it — the guide is built from
 * rules, so a finished post never fails because of its publishing notes.
 */
export async function generatePublishingGuide(args: { post: BlogPost; context: BlogGuideContext; facts: string[]; searchIntentHint?: string }): Promise<{ guide: BlogPublishingGuide; aiCalls: number }> {
  try {
    const draft = await generateStructured({ ...buildBlogGuidePrompt(args), schema: aiGuideDraftSchema, maxTokens: 6_000, role: "reviewer", effort: "low", purpose: "blog.guide" });
    return { guide: buildPublishingGuide(args.post, args.context, draft), aiCalls: 1 };
  } catch {
    return { guide: buildPublishingGuide(args.post, args.context), aiCalls: 0 };
  }
}
