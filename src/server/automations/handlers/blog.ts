import "server-only";
import { generateStructured } from "@/server/ai/generate";
import { blogContentSchema, buildBlogPrompt } from "@/server/ai/prompts/blog";
import { WordPressConnector } from "@/server/connectors/wordpress";
import { decryptWordPressPassword } from "@/server/connectors/wordpress/credentials";
import { blogSetupSchema, type BlogAutomationConfig } from "@/types/blog-automation";
import type { AutomationHandler, AutomationHandlerResult, AutomationRunContext } from "@/types/automation";

/**
 * The reference implementation of the AutomationHandler interface — this is
 * the first vertical slice (Section 20). Every other handler in this folder
 * follows the same shape once its connector is ready.
 */
export const blogAutomationHandler: AutomationHandler = {
  templateSlug: "blog-marketing",

  async run(ctx: AutomationRunContext): Promise<AutomationHandlerResult> {
    const parsed = blogSetupSchema.safeParse(ctx.config);
    const config = parsed.success ? ctx.config as unknown as BlogAutomationConfig : undefined;
    const { system, prompt } = buildBlogPrompt(ctx.business, ctx.recentTopics, config);
    const generated = await generateStructured({
      system,
      prompt,
      schema: blogContentSchema,
      maxTokens: 1200,
    });

    let externalUrl: string | undefined;
    let wordpressStatus: "draft" | "publish" | undefined;

    if (config?.deliveryMode === "wordpress_draft" || config?.deliveryMode === "wordpress_publish") {
      if (!config.wordpress) throw new Error("WordPress 연결 정보가 없습니다.");
      const connector = new WordPressConnector({
        siteUrl: config.wordpress.siteUrl,
        username: config.wordpress.username,
        appPassword: decryptWordPressPassword(config.wordpress.encryptedAppPassword),
      });
      wordpressStatus = config.deliveryMode === "wordpress_draft" ? "draft" : "publish";
      const saved = await connector.publish({ title: generated.title, content: generated.content }, wordpressStatus);
      externalUrl = saved.externalUrl;
    } else if (!config) {
      // Existing automations created before the setup wizard use the legacy server connection.
      const connector = new WordPressConnector();
      if (connector.isConfigured()) {
        const saved = await connector.publish({ title: generated.title, content: generated.content });
        externalUrl = saved.externalUrl;
        wordpressStatus = "publish";
      }
    }

    return {
      output: { ...generated, published: wordpressStatus === "publish", wordpressStatus: wordpressStatus ?? null, externalUrl: externalUrl ?? null },
      title: generated.title,
      topic: generated.topic,
      content: generated.content,
      contentType: "blog-marketing",
      externalUrl,
    };
  },
};
