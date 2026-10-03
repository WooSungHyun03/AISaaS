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
import { createAdminClient } from "@/lib/supabase/admin";
import { InstagramConnector } from "@/server/connectors/instagram";
import { loadInstagramConnector } from "@/server/connectors/instagram/connect";
import { getConnection, updateConnectionStatus } from "@/server/connectors/integrations";
import { renderShortVideo } from "@/server/connectors/video";
import { isConnectorError } from "@/server/shared/errors";
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
    const admin = createAdminClient();
    const sharedConnection = await getConnection(admin, ctx.automation.user_id, ctx.business.id, "instagram");
    const connector = sharedConnection
      ? await loadInstagramConnector(admin, ctx.automation.user_id, ctx.business.id)
      : new InstagramConnector();

    if (!connector || !connector.isConfigured()) {
      if (sharedConnection?.status === "CONNECTED") await updateConnectionStatus(admin, sharedConnection.id, "ERROR");
      throw new Error("Instagram 연결이 해제되었거나 설정되지 않았습니다. 설정에서 다시 연결해주세요.");
    }

    const { topic } = await generateTopic(ctx);
    const content = await generateStructured({
      ...buildShortsContentPrompt(ctx.business, topic),
      schema: shortsContentSchema,
      maxTokens: 1_600,
    });
    const videoUrl = await renderShortVideo(content.scenes, content.script);
    let mediaId: string | undefined;
    try {
      const result = await connector.publish({
        content: content.caption,
        mediaType: "REELS",
        videoUrl,
      });
      mediaId = result.externalId;
    } catch (error) {
      if (sharedConnection) {
        const status = isConnectorError(error) && (error.code === "AUTH_FAILED" || error.code === "PERMISSION_DENIED") ? "EXPIRED" : "ERROR";
        await updateConnectionStatus(admin, sharedConnection.id, status);
      }
      throw error;
    }

    return {
      output: { ...content, videoUrl, instagramMediaId: mediaId ?? null },
      externalUrl: videoUrl,
      title: content.hook,
      topic,
      content: content.script,
      contentType: "shorts",
    };
  },
};
