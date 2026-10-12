import "server-only";
import { generateStructured } from "@/server/ai/generate";
import { aiGuideDraftSchema, buildBlogGuidePrompt } from "@/server/ai/prompts/blog-guide";
import { buildPublishingGuide, type BlogGuideContext, type BlogPublishingGuide } from "./publishing-guide";
import type { BlogPost } from "./post";

/**
 * The guide is part of the same generation as the post: one extra AI call that is checked field by field
 * (publishing-guide.ts). If that call fails the guide is still built from rules, so a finished post never
 * fails — or costs another credit — because of its publishing notes.
 */
/** A step of a blog run shares one request with writing; the guide must not be what runs it out of time. */
const GUIDE_TIMEOUT_MS = 15_000;

export async function generatePublishingGuide(args: { post: BlogPost; context: BlogGuideContext; facts: string[]; searchIntentHint?: string }): Promise<{ guide: BlogPublishingGuide; aiCalls: number }> {
  try {
    const draft = await Promise.race([
      generateStructured({ ...buildBlogGuidePrompt(args), schema: aiGuideDraftSchema, maxTokens: 1_800 }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("guide timeout")), GUIDE_TIMEOUT_MS).unref?.()),
    ]);
    return { guide: buildPublishingGuide(args.post, args.context, draft), aiCalls: 1 };
  } catch {
    return { guide: buildPublishingGuide(args.post, args.context), aiCalls: 1 };
  }
}
