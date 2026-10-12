import "server-only";
import { generateStructured } from "@/server/ai/generate";
import { aiShortsPublishingSchema, buildShortsPublishingPrompt } from "@/server/ai/prompts/shorts-publishing";
import { buildShortsPublishing, type ShortsMetaContext, type ShortsPublishing } from "./publishing-metadata";

/**
 * Posting text for the video that was just planned, made in the same run (no extra credit; paid from the video budget). It is written from the
 * real script and checked in publishing-metadata.ts; if the AI step fails the text is built from the script by rules.
 */
export async function generateShortsPublishing(context: ShortsMetaContext): Promise<{ metadata: ShortsPublishing; aiCalls: number }> {
  try {
    const draft = await generateStructured({ ...buildShortsPublishingPrompt(context), schema: aiShortsPublishingSchema, maxTokens: 3_000, role: "reviewer", effort: "low", purpose: "video.publishing" });
    return { metadata: buildShortsPublishing(context, draft), aiCalls: 1 };
  } catch {
    return { metadata: buildShortsPublishing(context), aiCalls: 1 };
  }
}
