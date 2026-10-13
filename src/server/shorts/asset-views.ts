import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwnedAssetPath, REFERENCE_BUCKET } from "@/server/shorts/assets";
import type { AssetView, ShortsAsset, UsedReference } from "@/types/shorts-reference";

const PREVIEW_TTL_SEC = 60 * 30;

async function signMany(paths: string[]): Promise<Map<string, string>> {
  const signed = new Map<string, string>();
  if (paths.length === 0) return signed;
  const { data } = await createAdminClient().storage.from(REFERENCE_BUCKET).createSignedUrls(paths, PREVIEW_TTL_SEC);
  for (const item of data ?? []) if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl);
  return signed;
}

/** Previews for the materials card: mascot poses are static files, uploads get a short-lived signed URL (only for files this automation owns). */
export async function assetViewsFor(assets: ShortsAsset[], userId: string, automationId: string): Promise<AssetView[]> {
  const signed = await signMany(assets.filter((item) => item.origin === "upload" && isOwnedAssetPath(item.source, userId, automationId)).map((item) => item.source));
  return assets.map((item) => ({
    id: item.id,
    kind: item.kind,
    origin: item.origin,
    label: item.label,
    role: item.role ?? null,
    summary: item.summary ?? "",
    durationSec: item.durationSec ?? null,
    previewUrl: item.origin === "mascot" ? `/shorts-mascot/${item.source}.png` : signed.get(item.source) ?? null,
  }));
}

/** The references recorded in a run's output, with a preview where the file still exists and belongs to this owner. */
export async function usedReferenceViews(references: UsedReference[], userId: string, automationId: string): Promise<Array<UsedReference & { previewUrl: string | null }>> {
  const signed = await signMany(references.flatMap((item) => (item.path && isOwnedAssetPath(item.path, userId, automationId) ? [item.path] : [])));
  return references.map((item) => ({ ...item, previewUrl: item.origin === "mascot" ? null : item.path ? signed.get(item.path) ?? null : null }));
}
