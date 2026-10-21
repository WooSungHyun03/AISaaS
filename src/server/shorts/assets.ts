import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientEnv } from "@/lib/env/client";
import { logger } from "@/lib/logger";
import { ConnectorError } from "@/server/shared/errors";
import type { Database } from "@/types/database.types";
import { ASSET_LIMITS, type ShortsAsset, type ShortsAssetKind } from "@/types/shorts-reference";

/**
 * Files the owner gives the ad-video pipeline, and the videos it makes. Both live in PRIVATE buckets that only the
 * service role reads and writes; the browser uploads straight to Storage through a one-time signed upload URL (a
 * video does not fit through a Server Action), and everything that is handed to another service (the video model,
 * the FFmpeg worker) is a short-lived signed URL.
 */
export const REFERENCE_BUCKET = "shorts-references";
export const VIDEO_BUCKET = "shorts-videos";
const SIGNED_URL_TTL_SEC = 60 * 60;
/** Long enough for a model to fetch the files and for a finished video to be watched or posted. */
export const VIDEO_URL_TTL_SEC = 60 * 60 * 24;

type AdminClient = SupabaseClient<Database>;

export type AssetFileType = { kind: ShortsAssetKind; mime: string; extension: string };

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) => signature.every((value, index) => bytes[offset + index] === value);
const ascii = (bytes: Uint8Array, offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));

/** SVG is allowed for a logo only as plain shapes: nothing that can run code or fetch another file. */
export function isSafeSvg(text: string): boolean {
  const lowered = text.toLowerCase();
  if (!lowered.includes("<svg")) return false;
  return !/<script|<foreignobject|<image|<use[\s>]|<iframe|<!entity|<!doctype[^>]*\[|href\s*=|xlink:|javascript:|on[a-z]+\s*=/.test(lowered);
}

/**
 * Recognises a file by its first bytes. The type the browser reports is never trusted; `kind` is what the owner meant
 * to upload, and the bytes must agree with it.
 */
export function detectAssetType(bytes: Uint8Array, kind: ShortsAssetKind): AssetFileType | null {
  const png = startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (kind === "logo") {
    if (png) return { kind, mime: "image/png", extension: "png" };
    // The whole file, not just its start: a tag that runs code or fetches a file can sit anywhere in it.
    const text = new TextDecoder().decode(bytes);
    return text.includes("<svg") && isSafeSvg(text) ? { kind, mime: "image/svg+xml", extension: "svg" } : null;
  }
  if (kind === "image") {
    if (png) return { kind, mime: "image/png", extension: "png" };
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind, mime: "image/jpeg", extension: "jpg" };
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return { kind, mime: "image/webp", extension: "webp" };
    return null;
  }
  if (kind === "video") {
    if (ascii(bytes, 4, 4) !== "ftyp") return null;
    const brand = ascii(bytes, 8, 4);
    return brand === "qt  " ? { kind, mime: "video/quicktime", extension: "mov" } : { kind, mime: "video/mp4", extension: "mp4" };
  }
  if (ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return { kind, mime: "audio/mpeg", extension: "mp3" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") return { kind, mime: "audio/wav", extension: "wav" };
  return null;
}

/** Storage paths are always `<user>/<automation>/assets/<id>.<ext>`; anything else found in config is ignored. */
export function assetStoragePath(userId: string, automationId: string, assetId: string, extension: string): string {
  return `${userId}/${automationId}/assets/${assetId}.${extension}`;
}

/** Legacy reference uploads sit at `<user>/<automation>/<id>.<ext>`; both shapes belong to the owner's automation. */
export function isOwnedAssetPath(path: string, userId: string, automationId: string): boolean {
  return path.startsWith(`${userId}/${automationId}/`) && !path.includes("..");
}

export function videoStoragePath(userId: string, automationId: string, runId: string, name: string): string {
  return `${userId}/${automationId}/${runId}/${name}`;
}

let bucketsReady = false;

/** What went wrong while preparing storage; `code` is shown to the owner as a short reference, `cause` only goes to the log. */
export class AssetStorageError extends Error {
  constructor(
    public readonly code: "STORAGE_BUCKET" | "STORAGE_SIGN",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AssetStorageError";
  }
}

type BucketOptions = { public: boolean; fileSizeLimit?: number; allowedMimeTypes?: string[] };

function describeStorageError(error: unknown): { message: string; status?: number } {
  const record = error as { message?: unknown; status?: unknown; statusCode?: unknown } | null;
  const status = Number(record?.status ?? record?.statusCode);
  return { message: typeof record?.message === "string" ? record.message : String(error), ...(Number.isFinite(status) ? { status } : {}) };
}

/**
 * Makes sure one private bucket exists with the wanted options. A hosted Supabase project has a global upload limit
 * (50 MB on the free plan) that a bucket's own limit may not exceed: asking for more is refused, and that refusal used
 * to fail every upload — photos included — in production while the local stack (no such check) worked. So a refused
 * size limit is retried without it (the bucket then follows the project's global limit), and a bucket that already
 * exists is only updated on a best-effort basis: an update that fails must never block using the bucket.
 */
async function provisionBucket(admin: AdminClient, id: string, options: BucketOptions): Promise<void> {
  const withoutLimit: BucketOptions = { public: options.public, ...(options.allowedMimeTypes ? { allowedMimeTypes: options.allowedMimeTypes } : {}) };
  const created = await admin.storage.createBucket(id, options);
  if (!created.error) return;
  if (!/already exists|duplicate/i.test(created.error.message)) {
    logger.warn("storage_bucket_create_refused", { bucket: id, ...describeStorageError(created.error) });
    const retried = await admin.storage.createBucket(id, withoutLimit);
    if (!retried.error) return;
    if (!/already exists|duplicate/i.test(retried.error.message)) throw new AssetStorageError("STORAGE_BUCKET", "영상 파일 저장 공간을 준비하지 못했습니다.", { cause: retried.error });
  }
  // The bucket exists: widen it if possible, but it is usable either way.
  const updated = await admin.storage.updateBucket(id, options);
  if (!updated.error) return;
  const updatedWithoutLimit = await admin.storage.updateBucket(id, withoutLimit);
  if (updatedWithoutLimit.error) logger.warn("storage_bucket_update_failed", { bucket: id, ...describeStorageError(updatedWithoutLimit.error) });
}

/** Creates the private buckets on first use (and widens the older, image-only one), so no manual Supabase step is needed. */
export async function ensureShortsBuckets(admin: AdminClient): Promise<void> {
  if (bucketsReady) return;
  await provisionBucket(admin, REFERENCE_BUCKET, {
    public: false,
    fileSizeLimit: ASSET_LIMITS.video.maxBytes,
    allowedMimeTypes: [...new Set([...ASSET_LIMITS.image.mimes, ...ASSET_LIMITS.video.mimes, ...ASSET_LIMITS.audio.mimes, ...ASSET_LIMITS.logo.mimes])],
  });
  await provisionBucket(admin, VIDEO_BUCKET, { public: false, fileSizeLimit: 200 * 1024 * 1024, allowedMimeTypes: ["video/mp4", "audio/mpeg"] });
  bucketsReady = true;
}

/**
 * A one-time URL the browser uploads to (supabase-js `uploadToSignedUrl`). The bucket almost always exists already, so
 * the URL is requested first; only when that fails are the buckets provisioned and the request repeated. That keeps a
 * cold start from paying for bucket setup on every upload and keeps a bucket-settings problem from blocking uploads.
 */
export async function createAssetUpload(admin: AdminClient, path: string): Promise<{ path: string; token: string }> {
  const sign = () => admin.storage.from(REFERENCE_BUCKET).createSignedUploadUrl(path);
  let { data, error } = await sign();
  if (error || !data) {
    logger.warn("storage_signed_upload_first_attempt_failed", { ...describeStorageError(error) });
    await ensureShortsBuckets(admin);
    ({ data, error } = await sign());
  }
  if (error || !data) throw new AssetStorageError("STORAGE_SIGN", "업로드 주소를 만들지 못했습니다.", { cause: error });
  return { path: data.path, token: data.token };
}

export async function signAsset(admin: AdminClient, bucket: string, path: string, ttlSec = SIGNED_URL_TTL_SEC): Promise<string> {
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, ttlSec);
  if (error || !data?.signedUrl) throw new ConnectorError("video-assets", "INVALID_TARGET", "파일 주소를 만들지 못했습니다.", { cause: error });
  return data.signedUrl;
}

/**
 * The first bytes of a stored file (to recognise it) and its size, without downloading all of it. A file that starts
 * like text (an SVG logo) and is small enough to be one is read whole, so `detectAssetType` checks all of it.
 */
export async function readAssetHead(admin: AdminClient, path: string, length = 4_096): Promise<{ head: Uint8Array; size: number } | null> {
  const url = await signAsset(admin, REFERENCE_BUCKET, path, 120).catch(() => null);
  if (!url) return null;
  const read = async (bytes: number) => {
    const response = await fetch(url, { headers: { Range: `bytes=0-${bytes - 1}` }, signal: AbortSignal.timeout(20_000), cache: "no-store" }).catch(() => null);
    if (!response || (response.status !== 200 && response.status !== 206)) return null;
    const range = response.headers.get("content-range")?.match(/\/(\d+)$/);
    const size = range ? Number(range[1]) : Number(response.headers.get("content-length") ?? 0);
    return { head: new Uint8Array(await response.arrayBuffer()).slice(0, bytes), size };
  };
  const first = await read(length);
  if (!first || first.size <= length || first.size > ASSET_LIMITS.logo.maxBytes || !looksLikeText(first.head)) return first;
  const whole = await read(first.size);
  return whole && whole.head.length >= first.size ? whole : null;
}

/** An SVG (or any markup) starts with `<`, possibly after a byte-order mark or white space. */
function looksLikeText(bytes: Uint8Array): boolean {
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  return /^\s*</.test(new TextDecoder().decode(bytes.slice(start, start + 64)));
}

export async function removeAssets(admin: AdminClient, paths: string[], bucket: string = REFERENCE_BUCKET): Promise<void> {
  if (paths.length === 0) return;
  await admin.storage.from(bucket).remove(paths);
}

function publicBaseUrl(): string {
  return clientEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
}

/** The address of a mascot pose on our own site. */
export function mascotUrl(pose: string): string {
  return `${publicBaseUrl()}/shorts-mascot/${pose}.png`;
}

/** HTTPS addresses the video model can fetch for each file, in the same order. Mascot poses are served by our site. */
export async function resolveAssetUrls(admin: AdminClient, assets: ShortsAsset[], owner: { userId: string; automationId: string }): Promise<string[]> {
  const urls: string[] = [];
  for (const asset of assets) {
    if (asset.origin === "mascot") {
      urls.push(mascotUrl(asset.source));
      continue;
    }
    if (!isOwnedAssetPath(asset.source, owner.userId, owner.automationId)) {
      throw new ConnectorError("video-assets", "INVALID_TARGET", "올린 파일 정보가 올바르지 않습니다. 파일을 다시 올려주세요.");
    }
    urls.push(await signAsset(admin, REFERENCE_BUCKET, asset.source));
  }
  return urls;
}

/** Raw bytes of an image (a private upload, or a mascot pose from our own site) for the AI to look at. */
export async function loadImageBytes(admin: AdminClient, asset: ShortsAsset, owner: { userId: string; automationId: string }): Promise<Uint8Array> {
  const maxBytes = ASSET_LIMITS.image.maxBytes + 64 * 1024;
  if (asset.origin === "mascot") {
    const response = await fetch(mascotUrl(asset.source), { cache: "force-cache", signal: AbortSignal.timeout(15_000) }).catch((cause) => {
      throw new ConnectorError("video-assets", "NETWORK_FAILURE", "마스코트 이미지를 불러오지 못했습니다.", { cause });
    });
    if (!response.ok) throw new ConnectorError("video-assets", "UPSTREAM_SERVER_ERROR", `마스코트 이미지를 불러오지 못했습니다. (HTTP ${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }
  if (!isOwnedAssetPath(asset.source, owner.userId, owner.automationId)) {
    throw new ConnectorError("video-assets", "INVALID_TARGET", "올린 파일 정보가 올바르지 않습니다. 파일을 다시 올려주세요.");
  }
  const { data, error } = await admin.storage.from(REFERENCE_BUCKET).download(asset.source);
  if (error || !data) throw new ConnectorError("video-assets", "INVALID_TARGET", "이미지를 불러오지 못했습니다. 이미지를 다시 올려주세요.", { cause: error });
  if (data.size > maxBytes) throw new ConnectorError("video-assets", "INVALID_TARGET", "이미지가 너무 큽니다.");
  return new Uint8Array(await data.arrayBuffer());
}

/** Count and size: known before the file is sent. Returns a Korean reason when it must be refused. */
export function checkAssetBasics(args: { kind: ShortsAssetKind; size: number; existing: ShortsAsset[] }): string | null {
  const { kind, size, existing } = args;
  const limits = ASSET_LIMITS[kind];
  if (existing.filter((asset) => asset.kind === kind).length >= limits.max) return kind === "logo" ? "로고는 1개만 올릴 수 있어요. 먼저 지운 뒤 올려주세요." : `${limits.max}개까지만 올릴 수 있어요.`;
  if (size <= 0) return "빈 파일이에요. 다른 파일을 올려주세요.";
  if (size > limits.maxBytes) return `파일이 너무 커요. (${limits.label})`;
  return null;
}

/** Checks a stored file against the limits of its kind, including the length of videos and audio. Returns a Korean reason when it must be rejected. */
export function checkAssetLimits(args: {
  kind: ShortsAssetKind;
  size: number;
  existing: ShortsAsset[];
  probe?: { durationSec: number; hasVideo: boolean; hasAudio: boolean; fps: number | null };
}): string | null {
  const { kind, existing, probe } = args;
  const basics = checkAssetBasics(args);
  if (basics) return basics;
  if (kind === "video" || kind === "audio") {
    const spec = ASSET_LIMITS[kind];
    if (!probe) return "파일 정보를 읽지 못했어요. 다른 파일로 다시 올려주세요.";
    if (kind === "video" && !probe.hasVideo) return "영상 화면이 없는 파일이에요.";
    if (kind === "audio" && !probe.hasAudio) return "소리가 없는 파일이에요.";
    if (probe.durationSec <= 0) return "길이를 읽지 못했어요. 다른 파일로 다시 올려주세요.";
    if (probe.durationSec > spec.maxSeconds + 0.05) return `${kind === "video" ? "참고 영상" : "음원"} 하나는 ${spec.maxSeconds}초 이내여야 해요.`;
    const used = existing.filter((asset) => asset.kind === kind).reduce((sum, asset) => sum + (asset.durationSec ?? 0), 0);
    if (used + probe.durationSec > spec.totalSeconds + 0.05) {
      return `${kind === "video" ? "참고 영상" : "음원"}은 합쳐서 ${spec.totalSeconds}초까지예요. 지금 ${Math.round(used * 10) / 10}초를 올렸어요.`;
    }
    if (kind === "video" && probe.fps !== null && probe.fps < ASSET_LIMITS.video.minFps) return `초당 ${ASSET_LIMITS.video.minFps}프레임 이상인 영상만 쓸 수 있어요.`;
  }
  return null;
}
