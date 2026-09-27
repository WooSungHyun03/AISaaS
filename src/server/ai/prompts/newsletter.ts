import { z } from "zod";
import type { Business } from "@/types/domain";

export const newsletterContentSchema = z.object({
  subject: z.string().min(1),
  previewText: z.string().min(1),
  htmlBody: z.string().min(1),
});
export type NewsletterContent = z.infer<typeof newsletterContentSchema>;

function buildBusinessContext(business: Business): string {
  return [
    "You are a marketing content writer for a small business, writing in Korean.",
    `Business name: ${business.name}`,
    business.industry ? `Industry: ${business.industry}` : null,
    business.location ? `Location: ${business.location}` : null,
    business.description ? `Description: ${business.description}` : null,
    business.target_customer ? `Target customer: ${business.target_customer}` : null,
    business.brand_tone ? `Brand tone: ${business.brand_tone}` : null,
    business.keywords.length ? `Keywords to weave in naturally: ${business.keywords.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Builds the prompt for one newsletter send. `recentSubjects` (from
 * `content_history.topic` for this automation, threaded through by
 * runner.ts the same way blog.ts's recentTopics is) steers the subject
 * away from what was just sent; `rejectedSubject` additionally steers away
 * from a subject just rejected as a near-duplicate (see
 * handlers/newsletter.ts's single regeneration, mirroring blog.ts).
 */
export function buildNewsletterPrompt(business: Business, recentSubjects: string[], rejectedSubject?: string) {
  const system = buildBusinessContext(business);
  const avoidSubjects = rejectedSubject ? [...recentSubjects, rejectedSubject] : recentSubjects;
  const avoid = avoidSubjects.length
    ? `Do not reuse or closely resemble these recently sent newsletter subjects — pick a clearly different angle: ${avoidSubjects.join(", ")}.`
    : "";

  const prompt = [
    "Write one marketing newsletter email for this business's email subscribers.",
    avoid,
    "Return JSON with exactly these fields:",
    '{ "subject": "short compelling email subject line", "previewText": "1 sentence inbox preview text", "htmlBody": "the full email body as simple HTML using only <p> and <a> tags, 3-5 short paragraphs, no <html>/<body> wrapper" }',
  ]
    .filter(Boolean)
    .join("\n");

  return { system, prompt };
}
