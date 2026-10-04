import "server-only";
import { generateStructured } from "@/server/ai/generate";
import { isNearDuplicateTopic } from "@/server/ai/similarity";
import { buildNewsletterPrompt, newsletterContentSchema, type NewsletterContent } from "@/server/ai/prompts/newsletter";
import { ResendConnector, listActiveSubscribers } from "@/server/connectors/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConnectorError } from "@/server/shared/errors";
import { htmlToText } from "@/server/shared/html";
import type { AutomationHandler, AutomationHandlerResult, AutomationRunContext } from "@/types/automation";
import type { Json } from "@/types/domain";

/** Failure reasons that mean "sending at all is broken", not "this one recipient bounced". */
function isSystemicFailure(error: unknown): boolean {
  return isConnectorError(error) && (error.code === "AUTH_FAILED" || error.code === "PERMISSION_DENIED" || error.code === "NOT_CONFIGURED");
}

/**
 * Stage 1: pick a subject/body, regenerating once (never a loop, mirroring
 * blog.ts's generateTopic()) if it's a near-duplicate of a recently sent
 * subject.
 */
async function generateNewsletterContent(ctx: AutomationRunContext): Promise<NewsletterContent> {
  const first = await generateStructured({
    ...buildNewsletterPrompt(ctx.business, ctx.recentTopics),
    schema: newsletterContentSchema,
    maxTokens: 1200,
  });
  if (!isNearDuplicateTopic(first.subject, ctx.recentTopics)) return first;

  return generateStructured({
    ...buildNewsletterPrompt(ctx.business, ctx.recentTopics, first.subject),
    schema: newsletterContentSchema,
    maxTokens: 1200,
  });
}

interface SendFailure {
  subscriberId: string;
  email: string;
  error: string;
}

export const newsletterAutomationHandler: AutomationHandler = {
  templateSlug: "newsletter",

  async run(ctx: AutomationRunContext): Promise<AutomationHandlerResult> {
    const connector = new ResendConnector();
    if (!connector.isConfigured()) {
      throw new Error("이메일 발송 연동이 설정되지 않았습니다. RESEND_API_KEY와 RESEND_FROM_EMAIL을 설정해주세요.");
    }

    const admin = createAdminClient();
    const subscribers = await listActiveSubscribers(admin, ctx.business.id);
    const content = await generateNewsletterContent(ctx);

    let successCount = 0;
    const messageIds: string[] = [];
    const failures: SendFailure[] = [];

    for (const subscriber of subscribers) {
      // Derived from automation_runs.id + subscriber.id so a request the
      // HTTP layer retries for the same run and the same recipient (see
      // ResendConnector.send()) is deduped by Resend instead of sending
      // twice — never re-derived per attempt, and never reused across a
      // different run.id (a fresh "Run Now" is a deliberate new send).
      const idempotencyKey = `${ctx.runId}:${subscriber.id}`;
      try {
        const result = await connector.send({
          to: { email: subscriber.email, name: subscriber.name },
          subject: content.subject,
          html: content.htmlBody,
          idempotencyKey,
        });
        successCount += 1;
        messageIds.push(result.messageId);
      } catch (error) {
        // An auth/permission/config failure means every remaining send
        // would fail identically — stop instead of burning through the
        // rest of the list, and let the runner mark the whole run FAILED.
        if (isSystemicFailure(error)) throw error;
        failures.push({
          subscriberId: subscriber.id,
          email: subscriber.email,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      output: {
        subject: content.subject,
        previewText: content.previewText,
        totalSubscribers: subscribers.length,
        successCount,
        failureCount: failures.length,
        messageIds,
        failures,
      } as unknown as Json,
      title: content.subject,
      topic: content.subject,
      content: htmlToText(content.htmlBody),
      contentType: "newsletter",
    };
  },
};
