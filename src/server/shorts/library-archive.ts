import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { VIDEO_BUCKET, detectAssetType, storedVideoSize, videoStoragePath } from "@/server/shorts/assets";
import type { Database } from "@/types/database.types";

type AdminClient = SupabaseClient<Database>;

/** Older runs kept only the address of a file hosted by the video service. Moving it into our Storage is capped well under the bucket limit. */
export const ARCHIVE_MAX_BYTES = 100 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 60_000;

/** Only a public https address of a named host is fetched: never an IP address, localhost or an internal name. */
export function isFetchableVideoUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":") || /\.(local|internal|localdomain|lan)$/.test(host)) return false;
  return true;
}

/** Does the old hosted address still answer? (A HEAD request; some hosts refuse it, so a refusal falls back to a one-byte read.) */
export async function externalVideoReachable(url: string): Promise<boolean> {
  if (!isFetchableVideoUrl(url)) return false;
  const attempt = async (init: RequestInit) => {
    const response = await fetch(url, { ...init, redirect: "follow", signal: AbortSignal.timeout(8_000), cache: "no-store" }).catch(() => null);
    return response !== null && (response.ok || response.status === 206);
  };
  return (await attempt({ method: "HEAD" })) || (await attempt({ headers: { Range: "bytes=0-0" } }));
}

export type ArchiveResult =
  | { ok: true; path: string; bytes: number }
  | { ok: false; reason: "UNREACHABLE" | "TOO_LARGE" | "NOT_A_VIDEO" | "SAVE_FAILED" };

/**
 * Copies an old, externally hosted video into the owner's own Storage folder (`<user>/<automation>/<run>/final.mp4`)
 * so it stays available. The copy is checked (it is an MP4, it is in the bucket and not empty) before the caller records
 * it; nothing is recorded, and nothing is shown as saved, for a copy that did not work.
 */
export async function archiveExternalVideo(admin: AdminClient, params: { url: string; userId: string; automationId: string; runId: string }): Promise<ArchiveResult> {
  if (!isFetchableVideoUrl(params.url)) return { ok: false, reason: "UNREACHABLE" };
  const response = await fetch(params.url, { redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" }).catch(() => null);
  if (!response || !response.ok) return { ok: false, reason: "UNREACHABLE" };
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > ARCHIVE_MAX_BYTES) return { ok: false, reason: "TOO_LARGE" };
  const bytes = new Uint8Array(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (bytes.length === 0) return { ok: false, reason: "UNREACHABLE" };
  if (bytes.length > ARCHIVE_MAX_BYTES) return { ok: false, reason: "TOO_LARGE" };
  if (detectAssetType(bytes.slice(0, 16), "video")?.mime !== "video/mp4") return { ok: false, reason: "NOT_A_VIDEO" };

  const path = videoStoragePath(params.userId, params.automationId, params.runId, "final.mp4");
  const { error } = await admin.storage.from(VIDEO_BUCKET).upload(path, bytes, { contentType: "video/mp4", upsert: true });
  if (error) {
    logger.warn("shorts_archive_upload_failed", { runId: params.runId, message: error.message });
    return { ok: false, reason: "SAVE_FAILED" };
  }
  const stored = await storedVideoSize(admin, path).catch(() => null);
  if (stored === null) return { ok: false, reason: "SAVE_FAILED" };
  return { ok: true, path, bytes: stored };
}
