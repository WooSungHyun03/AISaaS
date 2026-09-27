import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { generateStructured } from "@/server/ai/generate";
import { buildClassifyPrompt } from "./prompts";
import { directoryCategorySchema, type DirectoryCategory } from "./taxonomy";
import { type ClassificationSource } from "./classification-source";

/**
 * Minimal keyword-based categorizer for directory tools. Good enough to
 * seed a category until Dev3 replaces it with something smarter (e.g. an
 * AI-assisted classification pass over the description/topics — see
 * IMPLEMENTATION_GUIDE.md #4).
 *
 * Keyed by every DirectoryCategory except "other" — TypeScript rejects this
 * object at compile time if a category is missing or misspelled, so this
 * can never silently drift from taxonomy.ts. "other" is the fallback below,
 * not a keyword match.
 */
const CATEGORY_KEYWORDS: Record<Exclude<DirectoryCategory, "other">, string[]> = {
  "automation-platform": ["automation", "workflow", "no-code", "n8n", "zapier"],
  "ai-infrastructure": [
    "framework",
    "sdk",
    "library",
    "agent",
    "llm",
    "model",
    "inference",
    "fine-tune",
    "database",
    "backend",
    "baas",
    "auth",
    "postgres",
  ],
  "content-creation": ["image generation", "text-to-image", "video generation", "copywriting", "content"],
  "marketing-automation": ["marketing", "seo", "campaign", "social media", "email marketing"],
  "customer-support": ["helpdesk", "chatbot", "customer service", "faq", "support"],
  productivity: ["productivity", "note-taking", "task management", "calendar"],
};

export function classifyCategory(description: string, tags: string[] = []): DirectoryCategory {
  const haystack = `${description} ${tags.join(" ")}`.toLowerCase();

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [
    Exclude<DirectoryCategory, "other">,
    string[],
  ][]) {
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      return category;
    }
  }

  return "other";
}

const classificationResultSchema = z.object({
  category: directoryCategorySchema,
});

/**
 * A single call to the AI. `generateStructured`'s own schema validation
 * (backed by `directoryCategorySchema`, a strict enum) already rejects a
 * category name outside the fixed list — retrying once, then throwing —
 * so an "AI named a category that doesn't exist" failure and an "AI call
 * itself failed" failure both surface here identically, as a thrown error.
 * There is deliberately no retry loop in this function — see
 * IMPLEMENTATION_GUIDE.md #4's hint 1.
 */
async function classifyWithAI(name: string, description: string, tags: string[]): Promise<DirectoryCategory> {
  const { system, prompt } = buildClassifyPrompt(name, description, tags);
  const result = await generateStructured({ system, prompt, schema: classificationResultSchema });
  return result.category;
}

export interface ClassificationResult {
  category: DirectoryCategory;
  source: ClassificationSource;
}

/**
 * AI-assisted classification with a keyword-matching fallback.
 * `classifyCategory` (above) never throws — worst case it returns "other"
 * — so this function always resolves with *some* category, which is what
 * keeps the batch below from ever getting stuck retrying the same tool
 * forever (see classifyUnclassifiedDirectoryTools's docs).
 */
export async function classifyDirectoryTool(
  name: string,
  description: string,
  tags: string[],
): Promise<ClassificationResult> {
  try {
    const category = await classifyWithAI(name, description, tags);
    return { category, source: "ai" };
  } catch (err) {
    logger.warn("directory_classify_ai_failed", {
      name,
      message: err instanceof Error ? err.message : String(err),
    });
    return { category: classifyCategory(description, tags), source: "keyword" };
  }
}

export interface ClassifyUnclassifiedResult {
  processed: number;
  classifiedByAi: number;
  classifiedByKeyword: number;
  /** Rows whose category was set by something else between the select and this batch's update — not an error, just not counted as classified here. */
  skippedAlreadyClassified: number;
  failed: { slug: string; message: string }[];
}

/**
 * Classifies up to `maxToProcess` directory_tools rows whose category is
 * still null. Deliberately NOT called from syncDirectoryTools() — this is
 * its own independently-failing step; whatever schedules it should call
 * this and syncDirectoryTools() as two separate calls so an AI outage never
 * affects GitHub metadata syncing or vice versa.
 *
 * Only ever targets `category IS NULL` — once a row gets *any* category
 * (AI or keyword, even "other"), it's excluded from every future run of
 * this batch. That's what stops the same tool from calling the AI again on
 * every run if it keeps failing: after the first attempt it always has a
 * real (if low-quality, source: "keyword") category and is never revisited
 * automatically again. A future "re-classify tools that fell back to
 * keyword matching" feature can use `classification_source = 'keyword'` to
 * find candidates — deliberately not built here, since that's a
 * human-triggered action, not something this automatic batch should do on
 * its own (see this ticket's report for the reasoning).
 */
export async function classifyUnclassifiedDirectoryTools(
  admin: SupabaseClient<Database> = createAdminClient(),
  maxToProcess = 20,
): Promise<ClassifyUnclassifiedResult> {
  const { data, error } = await admin
    .from("directory_tools")
    .select("slug, name, description, tags")
    .is("category", null)
    .limit(maxToProcess);

  if (error) throw error;

  let classifiedByAi = 0;
  let classifiedByKeyword = 0;
  let skippedAlreadyClassified = 0;
  const failed: { slug: string; message: string }[] = [];

  for (const tool of data ?? []) {
    try {
      const result = await classifyDirectoryTool(tool.name, tool.description ?? "", tool.tags);

      // Re-checks `category IS NULL` at write time, not just at the select
      // above — if something else (a manual edit, another run) classified
      // this row in between, this update matches zero rows instead of
      // clobbering whatever it was just given.
      const { data: updated, error: updateError } = await admin
        .from("directory_tools")
        .update({ category: result.category, classification_source: result.source })
        .eq("slug", tool.slug)
        .is("category", null)
        .select()
        .maybeSingle();

      if (updateError) throw updateError;

      if (!updated) {
        skippedAlreadyClassified++;
        continue;
      }

      if (result.source === "ai") classifiedByAi++;
      else classifiedByKeyword++;
    } catch (err) {
      failed.push({ slug: tool.slug, message: err instanceof Error ? err.message : String(err) });
      logger.error("directory_classify_write_failed", {
        slug: tool.slug,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result: ClassifyUnclassifiedResult = {
    processed: (data ?? []).length,
    classifiedByAi,
    classifiedByKeyword,
    skippedAlreadyClassified,
    failed,
  };

  logger.info("directory_classify_finished", { ...result });
  return result;
}
