import "server-only";
import { generateStructured } from "@/server/ai/generate";
import { isNearDuplicateTopic } from "@/server/ai/similarity";
import {
  blogBodySchema,
  blogTopicSchema,
  buildBlogBodyPrompt,
  buildBlogTopicPrompt,
  type BlogTopic,
} from "@/server/ai/prompts/blog";
import { WordPressConnector } from "@/server/connectors/wordpress";
import { decryptWordPressPassword } from "@/server/connectors/wordpress/credentials";
import { loadWordPressConnector } from "@/server/connectors/wordpress/connect";
import { getConnection, updateConnectionStatus } from "@/server/connectors/integrations";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConnectorError } from "@/server/shared/errors";
import { blogSetupSchema, type BlogAutomationConfig } from "@/types/blog-automation";
import type { AutomationHandler, AutomationHandlerResult, AutomationRunContext } from "@/types/automation";

/** content_history.content has historically held plain text; bodyHtml is HTML. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Stage 1 of the pipeline: pick a topic, reject it once if it's a
 * near-duplicate of a recent one, then accept whatever comes back from the
 * single regeneration attempt (bounded — never a loop).
 */
async function generateTopic(ctx: AutomationRunContext, config?: BlogAutomationConfig): Promise<BlogTopic> {
  const first = await generateStructured({
    ...buildBlogTopicPrompt(ctx.business, ctx.recentTopics, config),
    schema: blogTopicSchema,
    maxTokens: 200,
  });
  if (!isNearDuplicateTopic(first.topic, ctx.recentTopics)) return first;

  return generateStructured({
    ...buildBlogTopicPrompt(ctx.business, ctx.recentTopics, config, first.topic),
    schema: blogTopicSchema,
    maxTokens: 200,
  });
}

/**
 * The reference implementation of the AutomationHandler interface — this is
 * the first vertical slice (Section 20). Every other handler in this folder
 * follows the same shape once its connector is ready.
 */
export const blogAutomationHandler: AutomationHandler = {
  templateSlug: "blog-marketing",

  async run(ctx: AutomationRunContext): Promise<AutomationHandlerResult> {
    const parsed = blogSetupSchema.safeParse(ctx.config);
    const config = parsed.success ? (ctx.config as unknown as BlogAutomationConfig) : undefined;

    const topic = await generateTopic(ctx, config);
    const body = await generateStructured({
      ...buildBlogBodyPrompt(ctx.business, topic.topic, topic.title, config),
      schema: blogBodySchema,
      maxTokens: 1200,
    });
    const generated = { ...topic, ...body };

    let externalUrl: string | undefined;
    let wordpressStatus: "draft" | "publish" | undefined;

    if (config?.deliveryMode === "wordpress_draft" || config?.deliveryMode === "wordpress_publish") {
      const admin = createAdminClient();
      const sharedConnection = await getConnection(admin, ctx.automation.user_id, ctx.business.id, "wordpress");
      const connector = sharedConnection
        ? await loadWordPressConnector(admin, ctx.automation.user_id, ctx.business.id)
        : config.wordpress
          ? new WordPressConnector({
            siteUrl: config.wordpress.siteUrl,
            username: config.wordpress.username,
            appPassword: decryptWordPressPassword(config.wordpress.encryptedAppPassword),
          })
          : null;
      if (!connector) {
        if (sharedConnection?.status === "CONNECTED") await updateConnectionStatus(admin, sharedConnection.id, "ERROR");
        throw new Error("WordPress 연결이 해제되었거나 만료되었습니다. 설정에서 다시 연결해주세요.");
      }
      wordpressStatus = config.deliveryMode === "wordpress_draft" ? "draft" : "publish";
      try {
        const saved = await connector.publish(
          { title: generated.title, content: generated.bodyHtml, excerpt: generated.excerpt },
          wordpressStatus,
        );
        externalUrl = saved.externalUrl;
      } catch (error) {
        if (sharedConnection) {
          const status = isConnectorError(error) && (error.code === "AUTH_FAILED" || error.code === "PERMISSION_DENIED") ? "EXPIRED" : "ERROR";
          await updateConnectionStatus(admin, sharedConnection.id, status);
        }
        throw error;
      }
    } else if (!config) {
      // Existing automations created before the setup wizard use the legacy server connection.
      const connector = new WordPressConnector();
      if (connector.isConfigured()) {
        const saved = await connector.publish({ title: generated.title, content: generated.bodyHtml, excerpt: generated.excerpt });
        externalUrl = saved.externalUrl;
        wordpressStatus = "publish";
      }
    }

    return {
      output: { ...generated, published: wordpressStatus === "publish", wordpressStatus: wordpressStatus ?? null, externalUrl: externalUrl ?? null },
      title: generated.title,
      topic: generated.topic,
      content: stripHtml(generated.bodyHtml),
      contentType: "blog-marketing",
      externalUrl,
    };
  },
};
