import "server-only";
import { generateStructured } from "@/server/ai/generate";
import { isNearDuplicateTopic } from "@/server/ai/similarity";
import { buildInstagramCaptionPrompt, instagramCaptionSchema, type InstagramCaption } from "@/server/ai/prompts/instagram";
import { InstagramConnector } from "@/server/connectors/instagram";
import { loadInstagramConnector } from "@/server/connectors/instagram/connect";
import { ensureMarketingCardImageUrl } from "@/server/connectors/instagram/media";
import { getConnection, updateConnectionStatus } from "@/server/connectors/integrations";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConnectorError } from "@/server/shared/errors";
import type { AutomationHandler, AutomationHandlerResult, AutomationRunContext } from "@/types/automation";

/**
 * Regenerates the topic/caption exactly once on a near-duplicate — same
 * bounded-once pattern as blog.ts#generateTopic() / newsletter.ts's stage 1,
 * never a loop.
 */
async function generateCaption(ctx: AutomationRunContext): Promise<InstagramCaption> {
  const first = await generateStructured({
    ...buildInstagramCaptionPrompt(ctx.business, ctx.recentTopics),
    schema: instagramCaptionSchema,
    maxTokens: 500,
  });
  if (!isNearDuplicateTopic(first.topic, ctx.recentTopics)) return first;

  return generateStructured({
    ...buildInstagramCaptionPrompt(ctx.business, ctx.recentTopics, first.topic),
    schema: instagramCaptionSchema,
    maxTokens: 500,
  });
}

function buildCaptionText(caption: InstagramCaption): string {
  const hashtags = caption.hashtags.map((tag) => `#${tag}`).join(" ");
  return hashtags ? `${caption.caption}\n\n${hashtags}` : caption.caption;
}

/**
 * Single-image Instagram post through the same
 * container-create -> status-check -> media_publish sequence every
 * PlatformConnector caller goes through (InstagramConnector.publish()) —
 * no automation-type-specific forking of the AutomationRunner lifecycle.
 * The connector's REELS branch is used separately by the Shorts handler.
 */
export const instagramAutomationHandler: AutomationHandler = {
  templateSlug: "instagram-marketing",

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

    const caption = await generateCaption(ctx);
    const imageUrl = await ensureMarketingCardImageUrl(admin);
    const captionText = buildCaptionText(caption);

    let mediaId: string | undefined;
    try {
      const result = await connector.publish({ content: captionText, imageUrl });
      mediaId = result.externalId;
    } catch (error) {
      // A stored token Meta has since revoked/expired surfaces as AUTH_FAILED/
      // PERMISSION_DENIED — mark the connection so the Settings page and the
      // next run both see it needs reconnecting (Day 8's deferred item).
      if (sharedConnection) {
        const status = isConnectorError(error) && (error.code === "AUTH_FAILED" || error.code === "PERMISSION_DENIED") ? "EXPIRED" : "ERROR";
        await updateConnectionStatus(admin, sharedConnection.id, status);
      }
      throw error;
    }

    return {
      output: {
        topic: caption.topic,
        caption: caption.caption,
        hashtags: caption.hashtags,
        imageUrl,
        mediaId: mediaId ?? null,
      },
      title: caption.topic,
      topic: caption.topic,
      content: captionText,
      contentType: "instagram-marketing",
    };
  },
};
