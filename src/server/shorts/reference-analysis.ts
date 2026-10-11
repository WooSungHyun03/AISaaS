import "server-only";
import { z } from "zod";
import { generateStructured } from "@/server/ai/generate";
import { logger } from "@/lib/logger";
import { detectImageType } from "./reference-images";
import type { ReferenceSubject } from "@/types/shorts-reference";

/**
 * Looks at a reference image (Claude vision) and says what it shows, so the video planner can pick the
 * right kind of video for it without the owner having to explain: a character acts, a product or place is
 * shown and advertised, a person's photo is only ever shown (never animated).
 */
export const referenceAnalysisSchema = z.object({
  subject: z.enum(["character", "product", "place", "person", "other"]),
  /** One Korean sentence about what is visible. */
  summary: z.string().trim().min(1).max(160),
  visibleText: z.array(z.string().trim().min(1).max(60)).max(5).default([]),
});
export type ReferenceAnalysis = z.infer<typeof referenceAnalysisSchema>;

export function buildReferenceAnalysisPrompt(label: string) {
  return {
    system: "You look at one image an owner of a small business uploaded for an advertising short video, and describe it accurately and briefly. You never guess what you cannot see.",
    prompt: [
      "AUTOBIZ_REFERENCE_ANALYSIS_V1",
      `The owner's label for this image (may be empty): "${label.replace(/"/g, "'").slice(0, 80)}"`,
      "Decide what the image MAINLY shows:",
      "- character: an illustration, mascot, cartoon, toy or animal character that can act as a character (never a real person)",
      "- product: a product, dish, drink, item, package, or a close-up of goods",
      "- place: a shop, interior, exterior, office, room or a view of a space",
      "- person: a real person (owner, staff, customer, model)",
      "- other: anything else",
      "Return JSON with exactly these fields:",
      '{ "subject": "character|product|place|person|other", "summary": "one Korean sentence (at most 80 characters) saying what is in the image: what it is, colours, setting — only what is visible", "visibleText": ["words clearly readable on packaging, signs or labels (at most 5, empty if none)"] }',
    ].join("\n"),
  };
}

/** Never throws: when vision is unavailable the image is simply treated as "other" with the owner's label. */
export async function analyzeReferenceImage(bytes: Uint8Array, label: string): Promise<{ subject: ReferenceSubject; summary: string }> {
  const fallback = { subject: "other" as const, summary: label.trim() || "참고 이미지" };
  const type = detectImageType(bytes);
  if (!type) return fallback;
  try {
    const result = await generateStructured({
      ...buildReferenceAnalysisPrompt(label),
      schema: referenceAnalysisSchema,
      maxTokens: 400,
      temperature: 0.2,
      images: [{ mediaType: type === "png" ? "image/png" : "image/jpeg", base64: Buffer.from(bytes).toString("base64") }],
    });
    const text = result.visibleText.length > 0 ? ` (글자: ${result.visibleText.join(", ")})` : "";
    return { subject: result.subject, summary: `${result.summary}${text}`.slice(0, 200) };
  } catch (error) {
    logger.warn("reference_analysis_failed", { message: error instanceof Error ? error.message : String(error) });
    return fallback;
  }
}
