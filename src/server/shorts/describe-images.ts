import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { isBudgetError } from "@/server/budget";
import { loadImageBytes } from "@/server/shorts/assets";
import { analyzeImages, prepareVisionImage } from "@/server/shorts/image-analysis";
import type { AIImageInput } from "@/server/ai/provider";
import type { Json } from "@/types/domain";
import type { ShortsAsset } from "@/types/shorts-reference";

/**
 * Looks at the photos nobody has described yet (once per run, one vision call for all of them) and remembers the
 * answer in the automation's settings so the next run does not pay for the same photos again. A failed look is not
 * fatal: the photos are used with the owner's own labels. Only a spent budget stops the run.
 */
export async function withImageAnalysis(owner: { runId: string; userId: string; automationId: string }, assets: ShortsAsset[], purpose = "video.analyze"): Promise<ShortsAsset[]> {
  const admin = createAdminClient();
  const pending = assets.filter((asset) => asset.kind === "image" && !asset.summary);
  if (pending.length === 0) return assets;
  let analyzed: ShortsAsset[] = [];
  try {
    const prepared: Array<{ asset: ShortsAsset; vision: AIImageInput }> = [];
    for (const asset of pending) prepared.push({ asset, vision: await prepareVisionImage(await loadImageBytes(admin, asset, owner)) });
    analyzed = await analyzeImages(prepared, purpose);
  } catch (error) {
    if (isBudgetError(error)) throw error;
    logger.warn("image_analysis_failed", { runId: owner.runId, message: error instanceof Error ? error.message : String(error) });
    return assets;
  }
  const byId = new Map(analyzed.map((asset) => [asset.id, asset]));
  const merged = assets.map((asset) => byId.get(asset.id) ?? asset);
  try {
    const { data } = await admin.from("automations").select("config").eq("id", owner.automationId).single();
    const config = data?.config && typeof data.config === "object" && !Array.isArray(data.config) ? (data.config as Record<string, Json | undefined>) : {};
    if (Array.isArray(config.assets)) {
      const next = (config.assets as Json[]).map((raw) => {
        const found = raw && typeof raw === "object" && !Array.isArray(raw) ? byId.get(String((raw as Record<string, Json>).id)) : undefined;
        return found ? { ...(raw as Record<string, Json>), role: found.role ?? null, summary: found.summary ?? null } : raw;
      });
      await admin.from("automations").update({ config: { ...config, assets: next } as unknown as Json }).eq("id", owner.automationId);
    }
  } catch {
    // The run already has what it needs.
  }
  return merged;
}
