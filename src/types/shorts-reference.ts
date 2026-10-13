import { z } from "zod";

/** Client-safe description of what an owner can give the ad-video pipeline (no server imports). */

/** Length of the finished ad. The model is asked for exactly this many whole seconds. */
export const SHORTS_DURATION = { min: 20, max: 30, default: 25 } as const;
export const SHORTS_BRIEF_MAX_LENGTH = 500;
export const ASSET_LABEL_MAX_LENGTH = 60;

export const SHORTS_ASSET_KINDS = {
  image: "사진",
  video: "참고 영상",
  audio: "음원",
  logo: "로고",
} as const;
export type ShortsAssetKind = keyof typeof SHORTS_ASSET_KINDS;

const MB = 1024 * 1024;

/**
 * What can be uploaded. The counts and the 15-second totals are the model's own limits
 * (alibaba/wan-3.0/reference-to-video: 10 images, 5 videos / 15 s in total, 5 audio files / 15 s in total).
 * Sizes are ours. A logo is never sent to the model: it is laid over the finished video.
 */
export const ASSET_LIMITS = {
  image: { max: 10, maxBytes: 10 * MB, mimes: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"], label: "JPG·PNG·WEBP 사진, 10MB 이하" },
  video: { max: 5, maxBytes: 100 * MB, mimes: ["video/mp4", "video/quicktime"], extensions: ["mp4", "mov"], maxSeconds: 15, totalSeconds: 15, minFps: 16, label: "MP4·MOV, 합쳐서 15초 이내, 100MB 이하" },
  audio: { max: 5, maxBytes: 20 * MB, mimes: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/wave"], extensions: ["mp3", "wav"], maxSeconds: 15, totalSeconds: 15, label: "MP3·WAV, 합쳐서 15초 이내, 20MB 이하" },
  logo: { max: 1, maxBytes: 5 * MB, mimes: ["image/png", "image/svg+xml"], extensions: ["png", "svg"], label: "PNG·SVG 로고, 5MB 이하" },
} as const;

/** What a photo is for. The owner can set it; the AI looks at the photo when the video is made and fills in what is missing. */
export const ASSET_ROLES = {
  product: "상품·메뉴",
  place: "매장·공간",
  person: "사람",
  character: "캐릭터",
  exact: "정확히 보여줄 이미지 (라벨·화면)",
  other: "기타",
} as const;
export type ShortsAssetRole = keyof typeof ASSET_ROLES;

/**
 * Poses of the 이지 마케팅 mascot shipped in `public/shorts-mascot/*.png`: reference images the owner can add with
 * one click. `description` is what the planner reads to pick a pose.
 */
export const MASCOT_POSES = [
  { key: "wave", label: "인사", description: "윙크하며 손을 흔드는 모습 — 등장 인사, 마무리 인사" },
  { key: "point", label: "아이디어", description: "한 손가락으로 위를 가리키는 모습 — 좋은 생각이 떠올랐을 때, 팁을 알려줄 때" },
  { key: "guide", label: "안내", description: "눈을 크게 뜨고 한 손을 펼쳐 안내하는 모습 — 설명, 소개" },
  { key: "present", label: "공개", description: "윙크하며 양팔을 펼쳐 보여주는 모습 — 짜잔 하고 공개할 때" },
  { key: "thumbs-up", label: "엄지척", description: "윙크하며 엄지를 세운 모습 — 확신, 칭찬, 성공" },
  { key: "thumbs-up-2", label: "놀란 엄지척", description: "눈을 동그랗게 뜨고 엄지를 세운 모습 — 놀라면서 감탄할 때" },
  { key: "welcome", label: "환영", description: "양팔을 활짝 벌린 모습 — 환영, 마지막 행동 유도(CTA)" },
  { key: "cheer", label: "신남", description: "신나게 뛰어오르며 윙크하는 모습 — 흥분, 축하" },
] as const;
export type MascotPoseKey = (typeof MASCOT_POSES)[number]["key"];

const MASCOT_KEYS = new Set<string>(MASCOT_POSES.map((pose) => pose.key));
export function isMascotPoseKey(value: string): value is MascotPoseKey {
  return MASCOT_KEYS.has(value);
}

export const shortsAssetSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["image", "video", "audio", "logo"]),
  /** `upload`: `source` is a private Storage path. `mascot`: `source` is a MASCOT_POSES key (a static file of the site). */
  origin: z.enum(["upload", "mascot"]).default("upload"),
  source: z.string().min(1).max(300),
  label: z.string().trim().max(ASSET_LABEL_MAX_LENGTH).default(""),
  mime: z.string().max(100).optional(),
  bytes: z.number().int().min(0).optional(),
  width: z.number().int().min(0).optional(),
  height: z.number().int().min(0).optional(),
  /** Media length measured by the server (ffprobe) when the file was added. */
  durationSec: z.number().min(0).max(3_600).optional(),
  fps: z.number().min(0).max(240).optional(),
  role: z.enum(["product", "place", "person", "character", "exact", "other"]).optional(),
  /** One Korean sentence about what the image shows, written by the AI when the video is made. */
  summary: z.string().trim().max(200).optional(),
  /** Storage path of the file this one was copied from when the owner reused a photo from another automation. */
  copiedFrom: z.string().max(300).optional(),
});
export type ShortsAsset = z.infer<typeof shortsAssetSchema>;

export type VoiceMode = "native" | "tts";
export const VOICE_MODES: Record<VoiceMode, { label: string; description: string }> = {
  native: { label: "AI 영상의 목소리", description: "영상을 만들 때 한국어 나레이션도 함께 만들어요. 소리가 비면 자동으로 한국어 음성을 입혀요." },
  tts: { label: "한국어 음성 입히기", description: "영상은 음악·효과음만 만들고, 대본을 한국어 음성으로 따로 만들어 입혀요. 발음이 더 또렷해요." },
};

export interface ShortsSettings {
  assets: ShortsAsset[];
  /** Free-text direction from the owner ("이번엔 신메뉴 홍보" …). */
  brief: string;
  durationSec: number;
  voiceMode: VoiceMode;
}

const LEGACY_ROLE: Record<string, ShortsAssetRole> = { character: "character", product: "product", place: "place", person: "person", other: "other" };

/** Reads the Shorts settings out of `automations.config`, dropping anything malformed and upgrading the older reference list. */
export function parseShortsSettings(config: unknown): ShortsSettings {
  const record = config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
  const candidates: unknown[] = [];
  if (Array.isArray(record.assets)) candidates.push(...record.assets);
  // Before ad videos existed, images were saved as `references` ({kind: "upload" | "mascot", subject}).
  if (Array.isArray(record.references)) {
    for (const item of record.references) {
      if (!item || typeof item !== "object") continue;
      const legacy = item as Record<string, unknown>;
      candidates.push({ ...legacy, kind: "image", origin: legacy.kind === "mascot" ? "mascot" : "upload", role: typeof legacy.subject === "string" ? LEGACY_ROLE[legacy.subject] : undefined });
    }
  }

  const assets: ShortsAsset[] = [];
  const counts: Record<ShortsAssetKind, number> = { image: 0, video: 0, audio: 0, logo: 0 };
  for (const candidate of candidates) {
    const parsed = shortsAssetSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const asset = parsed.data;
    if (asset.origin === "mascot") {
      if (!isMascotPoseKey(asset.source) || asset.kind !== "image") continue;
      asset.role = "character";
    }
    if (assets.some((existing) => existing.id === asset.id)) continue;
    if (counts[asset.kind] >= ASSET_LIMITS[asset.kind].max) continue;
    counts[asset.kind] += 1;
    assets.push(asset);
  }

  const brief = typeof record.shortsBrief === "string" ? record.shortsBrief.trim().slice(0, SHORTS_BRIEF_MAX_LENGTH) : "";
  const rawDuration = typeof record.durationSec === "number" ? Math.round(record.durationSec) : SHORTS_DURATION.default;
  const durationSec = Math.min(SHORTS_DURATION.max, Math.max(SHORTS_DURATION.min, rawDuration));
  const voiceMode: VoiceMode = record.voiceMode === "tts" ? "tts" : "native";
  return { assets, brief, durationSec, voiceMode };
}

export function assetsOfKind(assets: ShortsAsset[], kind: ShortsAssetKind): ShortsAsset[] {
  return assets.filter((asset) => asset.kind === kind);
}

/** Seconds of media the owner's reference videos (or audio files) add up to: what the model bills on top of the output. */
export function totalSeconds(assets: ShortsAsset[], kind: "video" | "audio"): number {
  return Math.round(assetsOfKind(assets, kind).reduce((sum, asset) => sum + (asset.durationSec ?? 0), 0) * 100) / 100;
}

/** What the planner is told about an image (1-based position among the images sent to the model). */
export function describeAssetForPrompt(asset: ShortsAsset): string {
  if (asset.origin === "mascot") {
    const pose = MASCOT_POSES.find((item) => item.key === asset.source);
    return `[character] 이지 마케팅 마스코트 로봇${pose ? ` · ${pose.description}` : ""}`;
  }
  const text = [asset.summary, asset.label && asset.label !== asset.summary ? `(사장님 설명: ${asset.label})` : ""].filter(Boolean).join(" ");
  return `[${asset.role ?? "other"}] ${text || "사용자가 올린 참고 이미지"}`;
}

/** One reference as recorded in a run's output: enough to show "what was used" later, even if the file was deleted since. */
export interface UsedReference {
  number: number;
  id: string;
  kind: ShortsAssetKind;
  origin: "upload" | "mascot";
  label: string;
  role: ShortsAssetRole | null;
  summary: string;
  /** Private Storage path (never a URL); the history page signs it on demand. Null for mascot poses. */
  path: string | null;
}

/** The files a run actually worked from, numbered the way the prompts number them (per kind, 1-based). */
export function summarizeUsedReferences(assets: ShortsAsset[]): UsedReference[] {
  const counters: Record<ShortsAssetKind, number> = { image: 0, video: 0, audio: 0, logo: 0 };
  return assets.map((asset) => {
    counters[asset.kind] += 1;
    return {
      number: counters[asset.kind],
      id: asset.id,
      kind: asset.kind,
      origin: asset.origin,
      label: asset.label,
      role: asset.role ?? null,
      summary: asset.summary ?? "",
      path: asset.origin === "upload" ? asset.source : null,
    };
  });
}

/** What the materials screens show for one file (the server fills `previewUrl`). */
export interface AssetView {
  id: string;
  kind: ShortsAssetKind;
  origin: "upload" | "mascot";
  label: string;
  role: ShortsAssetRole | null;
  /** What the AI saw in a photo. */
  summary: string;
  durationSec: number | null;
  /** Signed URL for uploads, `/shorts-mascot/...` for the mascot. Null when it could not be created. */
  previewUrl: string | null;
}

/** What is wrong with a photo before it is sent (checked in the browser and worded for the owner), or null when it can go. */
export function checkPhotoFile(file: { name: string; size: number; type: string }): string | null {
  const image = ASSET_LIMITS.image;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "heic" || extension === "heif") return "HEIC 사진은 올릴 수 없어요. JPG나 PNG로 저장해서 올려주세요.";
  if (!(image.extensions as readonly string[]).includes(extension) || (file.type && !(image.mimes as readonly string[]).includes(file.type))) return `${image.label} 파일만 올릴 수 있어요.`;
  if (file.size <= 0) return "빈 파일이에요.";
  if (file.size > image.maxBytes) return `파일이 너무 커요. (${Math.round(image.maxBytes / 1024 / 1024)}MB 이하)`;
  return null;
}
