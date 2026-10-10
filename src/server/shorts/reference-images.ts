import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientEnv } from "@/lib/env/client";
import { serverEnv } from "@/lib/env/server";
import { ConnectorError } from "@/server/shared/errors";
import type { Database } from "@/types/database.types";
import type { ShortsReference } from "@/types/shorts-reference";

/**
 * Reference images for character Shorts. Uploads live in a PRIVATE bucket (only
 * the service role writes or reads it); at render time each one is turned into
 * a short-lived signed URL that JSON2Video fetches. The mascot poses are static
 * files in `public/shorts-mascot/`.
 */
export const REFERENCE_BUCKET = "shorts-references";
const SIGNED_URL_TTL_SEC = 60 * 60;

type AdminClient = SupabaseClient<Database>;

export type ReferenceImageType = "png" | "jpeg";

/** Recognises PNG/JPEG by magic bytes — the browser-reported file type is never trusted. */
export function detectImageType(bytes: Uint8Array): ReferenceImageType | null {
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  return null;
}

/** Storage paths are always `<user>/<automation>/<file>`; anything else in config is ignored. */
export function referenceStoragePath(userId: string, automationId: string, referenceId: string, type: ReferenceImageType): string {
  return `${userId}/${automationId}/${referenceId}.${type === "png" ? "png" : "jpg"}`;
}

export function isOwnedReferencePath(path: string, userId: string, automationId: string): boolean {
  return path.startsWith(`${userId}/${automationId}/`) && !path.includes("..");
}

let bucketReady = false;

/** Creates the private bucket on first use, so no manual Supabase step is needed. */
async function ensureReferenceBucket(admin: AdminClient): Promise<void> {
  if (bucketReady) return;
  const { error } = await admin.storage.createBucket(REFERENCE_BUCKET, {
    public: false,
    fileSizeLimit: 4 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg"],
  });
  if (error && !/already exists|duplicate/i.test(error.message)) {
    throw new Error("참고 이미지 저장 공간을 준비하지 못했습니다.", { cause: error });
  }
  bucketReady = true;
}

export async function uploadReferenceImage(
  admin: AdminClient,
  path: string,
  bytes: Uint8Array,
  type: ReferenceImageType,
): Promise<void> {
  await ensureReferenceBucket(admin);
  const { error } = await admin.storage.from(REFERENCE_BUCKET).upload(path, bytes, {
    contentType: type === "png" ? "image/png" : "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error("참고 이미지를 저장하지 못했습니다.", { cause: error });
}

export async function deleteReferenceImage(admin: AdminClient, path: string): Promise<void> {
  await admin.storage.from(REFERENCE_BUCKET).remove([path]);
}

/** Best-effort cleanup used when a reference is removed or replaced. */
export async function deleteReferenceImages(admin: AdminClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await admin.storage.from(REFERENCE_BUCKET).remove(paths);
}

function publicBaseUrl(): string | null {
  try {
    const base = new URL(clientEnv.NEXT_PUBLIC_SITE_URL);
    return base.protocol === "https:" ? base.origin : null;
  } catch {
    return null;
  }
}

/** The render schema only accepts HTTPS; the mock renderer never fetches, so local http URLs are swapped for a placeholder. */
function renderableUrl(url: string): string {
  if (url.startsWith("https://")) return url;
  if (serverEnv.VIDEO_RENDER_PROVIDER === "json2video") {
    throw new ConnectorError(
      "video-render",
      "NOT_CONFIGURED",
      "참고 이미지를 영상 서버가 가져갈 수 있는 HTTPS 주소가 아닙니다. NEXT_PUBLIC_SITE_URL과 Supabase 주소를 확인해주세요.",
    );
  }
  return `https://reference-image.mock.invalid/${encodeURIComponent(url.split("/").pop() ?? "image")}`;
}

const MAX_REFERENCE_BYTES = 3 * 1024 * 1024 + 64 * 1024;

/** Raw bytes of a reference image (a mascot pose from our own site, or a private upload). */
export async function loadReferenceBytes(
  admin: AdminClient,
  reference: ShortsReference,
  owner: { userId: string; automationId: string },
): Promise<Uint8Array> {
  if (reference.kind === "mascot") {
    const base = clientEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
    let response: Response;
    try {
      response = await fetch(`${base}/shorts-mascot/${reference.source}.png`, { cache: "force-cache", signal: AbortSignal.timeout(15_000) });
    } catch (cause) {
      throw new ConnectorError("video-render", "NETWORK_FAILURE", "마스코트 이미지를 불러오지 못했습니다.", { cause });
    }
    if (!response.ok) throw new ConnectorError("video-render", "UPSTREAM_SERVER_ERROR", `마스코트 이미지를 불러오지 못했습니다. (HTTP ${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }
  if (!isOwnedReferencePath(reference.source, owner.userId, owner.automationId)) {
    throw new ConnectorError("video-render", "INVALID_TARGET", "참고 이미지 정보가 올바르지 않습니다. 이미지를 다시 올려주세요.");
  }
  const { data, error } = await admin.storage.from(REFERENCE_BUCKET).download(reference.source);
  if (error || !data) {
    throw new ConnectorError("video-render", "INVALID_TARGET", "참고 이미지를 불러오지 못했습니다. 이미지를 다시 올려주세요.", { cause: error });
  }
  if (data.size > MAX_REFERENCE_BYTES) {
    throw new ConnectorError("video-render", "INVALID_TARGET", "참고 이미지가 너무 큽니다.");
  }
  return new Uint8Array(await data.arrayBuffer());
}

/** A one-hour signed HTTPS URL for a file this module stored (reference or generated frame). */
export async function signStoragePath(admin: AdminClient, path: string): Promise<string> {
  const { data, error } = await admin.storage.from(REFERENCE_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SEC);
  if (error || !data?.signedUrl) {
    throw new ConnectorError("video-render", "INVALID_TARGET", "이미지 주소를 만들지 못했습니다.", { cause: error });
  }
  return renderableUrl(data.signedUrl);
}

/** One render-ready HTTPS URL per reference, in the same order. */
export async function resolveReferenceImageUrls(
  admin: AdminClient,
  references: ShortsReference[],
  owner: { userId: string; automationId: string },
): Promise<string[]> {
  const urls: string[] = [];
  for (const reference of references) {
    if (reference.kind === "mascot") {
      const base = publicBaseUrl() ?? clientEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
      urls.push(renderableUrl(`${base}/shorts-mascot/${reference.source}.png`));
      continue;
    }
    if (!isOwnedReferencePath(reference.source, owner.userId, owner.automationId)) {
      throw new ConnectorError("video-render", "INVALID_TARGET", "참고 이미지 정보가 올바르지 않습니다. 이미지를 다시 올려주세요.");
    }
    const { data, error } = await admin.storage.from(REFERENCE_BUCKET).createSignedUrl(reference.source, SIGNED_URL_TTL_SEC);
    if (error || !data?.signedUrl) {
      throw new ConnectorError("video-render", "INVALID_TARGET", "참고 이미지를 불러오지 못했습니다. 이미지를 다시 올려주세요.", { cause: error });
    }
    urls.push(renderableUrl(data.signedUrl));
  }
  return urls;
}
