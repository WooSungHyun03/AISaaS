import "server-only";
import { generateStructured } from "@/server/ai/generate";
import { blogContentSchema, buildBlogPrompt } from "@/server/ai/prompts/blog";
import { WordPressConnector } from "@/server/connectors/wordpress";
import type { AutomationHandler, AutomationHandlerResult, AutomationRunContext } from "@/types/automation";

/**
 * The reference implementation of the AutomationHandler interface — this is
 * the first vertical slice (Section 20). Every other handler in this folder
 * follows the same shape once its connector is ready.
 */
export const blogAutomationHandler: AutomationHandler = {
  templateSlug: "blog-marketing",

  async run(ctx: AutomationRunContext): Promise<AutomationHandlerResult> {
    const { system, prompt } = buildBlogPrompt(ctx.business, ctx.recentTopics);
    const generated = await generateStructured({
      system,
      prompt,
      schema: blogContentSchema,
      maxTokens: 1200,
    });

    const connector = new WordPressConnector();
    let externalUrl: string | undefined;

    if (connector.isConfigured()) {
      const published = await connector.publish({ title: generated.title, content: generated.content });
      externalUrl = published.externalUrl;
    }

    return {
      output: { ...generated, published: Boolean(externalUrl) },
      title: generated.title,
      topic: generated.topic,
      content: generated.content,
      contentType: "blog-marketing",
      externalUrl,
    };
  },
};
