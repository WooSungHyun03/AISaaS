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
import { stripHtml } from "@/server/shared/html";
import { blogSetupSchema, type BlogAutomationConfig } from "@/types/blog-automation";
import type { AutomationHandler, AutomationHandlerResult, AutomationRunContext } from "@/types/automation";

/**
 * Stage 1 of the pipeline: pick a topic, reject it once if it's a
 * near-duplicate of a recent one, then accept whatever comes back from the
 * single regeneration attempt (bounded — never a loop).
 */
async function generateTopic(ctx: AutomationRunContext, config?: BlogAutomationConfig): Promise<BlogTopic> {
  if (ctx.calendarItem) {
    const base = buildBlogTopicPrompt(ctx.business, ctx.recentTopics, config);
    const planned = await generateStructured({
      system: [
        base.system,
        `This calendar item's fixed marketing goal: ${ctx.calendarItem.goal}`,
        `This calendar item's content brief: ${ctx.calendarItem.summary}`,
        `Preferred closing CTA: ${ctx.calendarItem.cta}`,
      ].join("\n"),
      prompt: [
        `Use exactly this planned topic without replacing it: "${ctx.calendarItem.topic}".`,
        "Create one compelling Korean blog title for it.",
        'Return JSON with exactly these fields: { "topic": "the exact supplied topic", "title": "catchy blog title" }',
      ].join("\n"),
      schema: blogTopicSchema,
      maxTokens: 200,
    });
    return { topic: ctx.calendarItem.topic, title: planned.title };
  }

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
    const bodyPrompt = buildBlogBodyPrompt(ctx.business, topic.topic, topic.title, config);
    const body = await generateStructured({
      ...bodyPrompt,
      system: ctx.calendarItem
        ? [
          bodyPrompt.system,
          `This calendar item's marketing goal: ${ctx.calendarItem.goal}`,
          `This calendar item's content brief (cover this): ${ctx.calendarItem.summary}`,
          `End with a CTA aligned with: ${ctx.calendarItem.cta}`,
        ].join("\n")
        : bodyPrompt.system,
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
