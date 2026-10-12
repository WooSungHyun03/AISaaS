import "server-only";
import sharp from "sharp";
import { z } from "zod";
import { generateStructured } from "@/server/ai/generate";
import type { AIImageInput } from "@/server/ai/provider";
import type { ShortsAsset } from "@/types/shorts-reference";

/**
 * One vision call (Sonnet) looks at every photo the owner has not described yet and says what it shows, so the planner
 * knows which photo is the product, the shop or a person, and what text is readable on packaging. It runs inside the
 * video run and is paid from the video budget like every other call.
 */
export const imageAnalysisSchema = z.object({
  images: z
    .array(
      z.object({
        index: z.number().int().min(1).max(10),
        role: z.enum(["product", "place", "person", "character", "other"]),
        /** One Korean sentence about what is visible. */
        summary: z.string().trim().min(1).max(160),
        visibleText: z.array(z.string().trim().min(1).max(60)).max(5).default([]),
      }),
    )
    .max(10),
});
export type ImageAnalysis = z.infer<typeof imageAnalysisSchema>;

export function buildImageAnalysisPrompt(labels: string[]) {
  return {
    system: "You look at photos that the owner of a small business uploaded for an advertising video, and describe each one accurately and briefly. You never guess what you cannot see. Write in Korean.",
    prompt: [
      "AUTOBIZ_IMAGE_ANALYSIS_V2",
      "The images are attached in this order. The owner's label for each (may be empty):",
      ...labels.map((label, index) => `Image ${index + 1} label: "${label.replace(/"/g, "'").slice(0, 80)}"`),
      "For each image decide what it MAINLY shows:",
      "- product: a product, dish, drink, item, package, or a close-up of goods",
      "- place: a shop, interior, exterior, office, room or a view of a space",
      "- person: a real person (owner, staff, customer, model)",
      "- character: an illustration, mascot, cartoon, toy or animal character (never a real person)",
      "- other: anything else",
      'Return JSON with exactly this shape: { "images": [{ "index": 1, "role": "product|place|person|character|other", "summary": "one Korean sentence (at most 80 characters): what it is, colours, setting — only what is visible", "visibleText": ["words clearly readable on packaging, signs or labels (at most 5, empty if none)"] }] }',
    ].join("\n"),
  };
}

/** A small JPEG for the vision model; the original can be 10 MB. */
export async function prepareVisionImage(bytes: Uint8Array): Promise<AIImageInput> {
  const resized = await sharp(bytes, { failOn: "error" }).rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 80 }).toBuffer();
  return { mediaType: "image/jpeg", base64: resized.toString("base64") };
}

/** What the planner is told about a photo after analysis: the summary plus any readable text. */
export function analysisSummary(item: ImageAnalysis["images"][number]): string {
  const text = item.visibleText.length > 0 ? ` (글자: ${item.visibleText.join(", ")})` : "";
  return `${item.summary}${text}`.slice(0, 200);
}

/** Fills `role` (only where the owner did not set one) and `summary` for the given photos. Throws when the model cannot answer. */
export async function analyzeImages(images: Array<{ asset: ShortsAsset; vision: AIImageInput }>): Promise<ShortsAsset[]> {
  if (images.length === 0) return [];
  const result = await generateStructured({
    ...buildImageAnalysisPrompt(images.map((item) => item.asset.label)),
    schema: imageAnalysisSchema,
    maxTokens: 2_500,
    images: images.map((item) => item.vision),
    role: "vision",
    effort: "low",
    purpose: "video.analyze",
  });
  return images.map((item, position) => {
    const found = result.images.find((entry) => entry.index === position + 1);
    if (!found) return item.asset;
    return { ...item.asset, role: item.asset.role ?? found.role, summary: analysisSummary(found) };
  });
}
