import "server-only";
import { generateStructured } from "@/server/ai/generate";
import {
  buildShortsContentPrompt,
  buildShortsTopicPrompt,
  shortsContentSchema,
  shortsTopicSchema,
  type ShortsTopic,
} from "@/server/ai/prompts/shorts";
import { isNearDuplicateTopic } from "@/server/ai/similarity";
import { renderShortVideo } from "@/server/connectors/video";
import type { AutomationHandler, AutomationHandlerResult, AutomationRunContext } from "@/types/automation";

/**
 * Selects a topic before writing the full video so a near-duplicate only
 * costs one small regeneration. The second result is accepted regardless of
 * similarity, matching the bounded retry pattern used by the Blog pipeline.
 */
async function generateTopic(ctx: AutomationRunContext): Promise<ShortsTopic> {
  const first = await generateStructured({
    ...buildShortsTopicPrompt(ctx.business, ctx.recentTopics),
    schema: shortsTopicSchema,
    maxTokens: 120,
  });
  if (!isNearDuplicateTopic(first.topic, ctx.recentTopics)) return first;

  return generateStructured({
    ...buildShortsTopicPrompt(ctx.business, ctx.recentTopics, first.topic),
    schema: shortsTopicSchema,
    maxTokens: 120,
  });
}

export const shortsAutomationHandler: AutomationHandler = {
  templateSlug: "shorts",

  async run(ctx: AutomationRunContext): Promise<AutomationHandlerResult> {
    const { topic } = await generateTopic(ctx);
    const content = await generateStructured({
      ...buildShortsContentPrompt(ctx.business, topic),
      schema: shortsContentSchema,
      maxTokens: 1_600,
    });
    const videoUrl = await renderShortVideo(content.scenes, content.script);

    return {
      output: { ...content, videoUrl },
      externalUrl: videoUrl,
      title: content.hook,
      topic,
      content: content.script,
      contentType: "shorts",
    };
  },
};
