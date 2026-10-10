import { z } from "zod";

/** Most reference images one Shorts setup can hold (uploads + mascot poses together). */
export const MAX_SHORTS_REFERENCES = 8;
/** Per-file ceiling for an uploaded reference (the browser downsizes before sending). */
export const MAX_REFERENCE_UPLOAD_BYTES = 3 * 1024 * 1024;
export const REFERENCE_LABEL_MAX_LENGTH = 60;
export const SHORTS_BRIEF_MAX_LENGTH = 300;

/** Shorts are always character videos; the style only sets the tone. */
export const SHORTS_STYLES = {
  skit: { label: "캐릭터 콩트", description: "캐릭터가 움직이며 대사를 주고받는 짧고 웃긴 영상" },
  explainer: { label: "캐릭터 설명", description: "캐릭터가 움직이며 차근차근 알려주는 영상" },
} as const;
export type ShortsStyle = keyof typeof SHORTS_STYLES;

/**
 * Poses of the 이지 마케팅 mascot shipped in `public/shorts-mascot/*.png`.
 * `description` is what the AI reads to pick the right expression for each
 * line, so keep it about the pose and the moment it fits.
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

export const shortsReferenceSchema = z.object({
  id: z.string().min(1).max(64),
  /** `upload`: `source` is a private Storage path; `mascot`: `source` is a MASCOT_POSES key. */
  kind: z.enum(["upload", "mascot"]),
  source: z.string().min(1).max(300),
  label: z.string().trim().max(REFERENCE_LABEL_MAX_LENGTH),
});
export type ShortsReference = z.infer<typeof shortsReferenceSchema>;

export interface ShortsReferenceSettings {
  references: ShortsReference[];
  style: ShortsStyle;
  /** Free-text direction from the owner ("이번엔 신메뉴 홍보" …). */
  brief: string;
}

/** Reads the reference settings out of `automations.config`, dropping anything malformed. */
export function parseShortsReferenceSettings(config: unknown): ShortsReferenceSettings {
  const record = config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
  const references: ShortsReference[] = [];
  if (Array.isArray(record.references)) {
    for (const item of record.references) {
      const parsed = shortsReferenceSchema.safeParse(item);
      if (!parsed.success) continue;
      if (parsed.data.kind === "mascot" && !isMascotPoseKey(parsed.data.source)) continue;
      if (references.some((existing) => existing.id === parsed.data.id)) continue;
      references.push(parsed.data);
      if (references.length >= MAX_SHORTS_REFERENCES) break;
    }
  }
  const style: ShortsStyle = record.shortsStyle === "explainer" ? "explainer" : "skit";
  const brief = typeof record.shortsBrief === "string" ? record.shortsBrief.trim().slice(0, SHORTS_BRIEF_MAX_LENGTH) : "";
  return { references, style, brief };
}

/** What the AI is told about each character image (1-based so it matches `imageIndex`). */
export function describeReferenceForPrompt(reference: ShortsReference): string {
  if (reference.kind === "mascot") {
    const pose = MASCOT_POSES.find((item) => item.key === reference.source);
    return pose ? `이지 마케팅 마스코트 로봇 · ${pose.description}` : "이지 마케팅 마스코트 로봇";
  }
  return reference.label || "사용자가 올린 캐릭터 이미지";
}
