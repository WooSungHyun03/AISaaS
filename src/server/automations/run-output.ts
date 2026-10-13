import "server-only";

import type { Json } from "@/types/domain";
import { blogPublishingGuideSchema, type BlogPublishingGuide } from "@/server/blog/publishing-guide";
import { ASSET_LIMITS, ASSET_ROLES, type ShortsAssetKind, type ShortsAssetRole, type UsedReference } from "@/types/shorts-reference";
import { shortsPublishingSchema, type ShortsPublishing } from "@/server/shorts/publishing-metadata";

export interface SafeShortsQa {
  status: "REJECTED" | "NEEDS_HUMAN_CHECK";
  summary: string | null;
  aiChecked: boolean;
  findings: Array<{ severity: "reject" | "warn"; message: string }>;
  notes: string[];
}

export interface SafeAutomationRunOutput {
  title: string | null;
  topic: string | null;
  summary: string | null;
  body: string | null;
  callToAction: string | null;
  keywords: string[];
  externalUrl: string | null;
  /** Blog-only (added alongside the generation-only switch) — null for every run from before that change or for non-blog handlers. */
  hook: string | null;
  seoKeywords: string[];
  imageSuggestion: string | null;
  videoUrl: string | null;
  caption: string | null;
  script: string | null;
  scenes: Array<{ text: string; durationSec: number }>;
  /** Blog posts: where the post is meant to go, its measured size, and what the quality check still found. */
  platform: "naver" | "tistory" | null;
  /** Blog: style, photo notes and SEO made with the post. Null for posts from before it existed or when it does not validate. */
  publishingGuide: BlogPublishingGuide | null;
  /** Shorts: the posting text written from the video's script. Null for older runs. */
  shortsPublishing: ShortsPublishing | null;
  blogStats: { chars: number; sections: number; photos: number } | null;
  qualityNotes: string[];
  /** Shorts: `ad` for the ad-video pipeline; older runs were `character` or `promo` videos. */
  format: "ad" | "character" | "promo" | null;
  /** Shorts made by the ad pipeline: where the finished video sits in private Storage (the page signs a fresh address), and its length. */
  videoPath: string | null;
  durationSec: number | null;
  /** Shorts: the quality check. There is no "approved": at best the video needs the owner's final look. */
  qa: SafeShortsQa | null;
  /** The video's own voice was missing, so a Korean voice was added. */
  voiceFallback: boolean;
  /** The video is a test placeholder (no real renderer connected): not a finished Short, cannot be posted. */
  sampleVideo: boolean;
  /** The owner's photos / clips the run worked from (blog photos, Shorts references): shown in the history so it is clear what was used. */
  references: UsedReference[];
  publicationResults: Partial<Record<"instagram" | "youtube", {
    externalId: string | null;
    externalUrl: string | null;
    privacy: "private" | null;
  }>>;
}

function asRecord(value: Json): Record<string, Json | undefined> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function safeText(value: Json | undefined, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

function plainTextFromHtml(value: Json | undefined): string | null {
  const html = safeText(value, 50_000);
  if (!html) return null;
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20_000) || null;
}

function safeExternalUrl(value: Json | undefined): string | null {
  const raw = safeText(value, 2_000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeBlogStats(value: Json | undefined): { chars: number; sections: number; photos: number } | null {
  const record = asRecord(value ?? null);
  if (!record) return null;
  const chars = record.chars;
  const sections = record.sections;
  const photos = record.photos;
  return typeof chars === "number" && typeof sections === "number" && typeof photos === "number" ? { chars, sections, photos } : null;
}

function safeShortsQa(value: Json | undefined): SafeShortsQa | null {
  const record = asRecord(value ?? null);
  if (!record || (record.status !== "REJECTED" && record.status !== "NEEDS_HUMAN_CHECK")) return null;
  const findings: SafeShortsQa["findings"] = [];
  if (Array.isArray(record.findings)) {
    for (const entry of record.findings.slice(0, 20)) {
      const item = asRecord(entry);
      const message = item ? safeText(item.message, 400) : null;
      if (!item || !message) continue;
      if (item.severity === "reject" || item.severity === "warn") findings.push({ severity: item.severity, message });
    }
  }
  const notes = Array.isArray(record.notes) ? record.notes.filter((item): item is string => typeof item === "string").slice(0, 8).map((item) => item.slice(0, 300)) : [];
  return { status: record.status, summary: safeText(record.summary, 300), aiChecked: record.aiChecked === true, findings, notes };
}

function safeReferences(value: Json | undefined): UsedReference[] {
  if (!Array.isArray(value)) return [];
  const out: UsedReference[] = [];
  for (const entry of value.slice(0, 20)) {
    const item = asRecord(entry);
    if (!item || typeof item.number !== "number" || typeof item.id !== "string" || typeof item.kind !== "string" || !(item.kind in ASSET_LIMITS)) continue;
    out.push({
      number: Math.max(1, Math.min(99, Math.round(item.number))),
      id: item.id.slice(0, 64),
      kind: item.kind as ShortsAssetKind,
      origin: item.origin === "mascot" ? "mascot" : "upload",
      label: safeText(item.label, 60) ?? "",
      role: typeof item.role === "string" && item.role in ASSET_ROLES ? (item.role as ShortsAssetRole) : null,
      summary: safeText(item.summary, 200) ?? "",
      path: typeof item.path === "string" ? item.path.slice(0, 300) : null,
    });
  }
  return out;
}

function safePublicationResults(value: Json | undefined): SafeAutomationRunOutput["publicationResults"] {
  const record = asRecord(value ?? null);
  if (!record) return {};
  const results: SafeAutomationRunOutput["publicationResults"] = {};
  for (const platform of ["instagram", "youtube"] as const) {
    const item = asRecord(record[platform] ?? null);
    if (!item) continue;
    results[platform] = {
      externalId: safeText(item.externalId, 500),
      externalUrl: safeExternalUrl(item.externalUrl),
      privacy: item.privacy === "private" ? "private" : null,
    };
  }
  return results;
}

/**
 * Converts a provider-owned JSON payload into a small display model. This is
 * an allowlist: unknown fields (including token, password, credential, input,
 * and provider metadata) are never returned to a page component.
 */
export function toSafeAutomationRunOutput(value: Json): SafeAutomationRunOutput | null {
  const output = asRecord(value);
  if (!output) return null;

  const body =
    safeText(output.content, 20_000) ??
    safeText(output.body, 20_000) ??
    plainTextFromHtml(output.bodyHtml);
  const keywords = Array.isArray(output.keywords)
    ? output.keywords.filter((item): item is string => typeof item === "string").slice(0, 20).map((item) => item.slice(0, 100))
    : [];
  const seoKeywords = Array.isArray(output.seoKeywords)
    ? output.seoKeywords.filter((item): item is string => typeof item === "string").slice(0, 20).map((item) => item.slice(0, 100))
    : [];
  const safe: SafeAutomationRunOutput = {
    title: safeText(output.title, 500),
    topic: safeText(output.topic, 500),
    summary: safeText(output.excerpt, 2_000) ?? safeText(output.summary, 2_000),
    body,
    callToAction: safeText(output.callToAction, 1_000),
    keywords,
    externalUrl: safeExternalUrl(output.externalUrl),
    hook: safeText(output.hook, 500),
    seoKeywords,
    imageSuggestion: safeText(output.imageSuggestion, 500),
    videoUrl: safeExternalUrl(output.videoUrl),
    caption: safeText(output.caption, 2_000),
    script: safeText(output.script, 5_000),
    scenes: Array.isArray(output.scenes)
      ? output.scenes.slice(0, 20).flatMap((scene) => {
        const item = asRecord(scene);
        const text = item ? safeText(item.text, 500) : null;
        const durationSec = item && typeof item.durationSec === "number" && Number.isFinite(item.durationSec)
          ? Math.max(0, Math.min(60, item.durationSec))
          : null;
        return text && durationSec !== null ? [{ text, durationSec }] : [];
      })
      : [],
    platform: output.platform === "naver" || output.platform === "tistory" ? output.platform : null,
    publishingGuide: (() => {
      const parsed = blogPublishingGuideSchema.safeParse(output.publishingGuide);
      return parsed.success ? parsed.data : null;
    })(),
    shortsPublishing: (() => {
      const parsed = shortsPublishingSchema.safeParse(output.publishing);
      return parsed.success ? parsed.data : null;
    })(),
    blogStats: safeBlogStats(output.stats),
    qualityNotes: Array.isArray(output.qualityNotes)
      ? output.qualityNotes.filter((item): item is string => typeof item === "string").slice(0, 6).map((item) => item.slice(0, 200))
      : [],
    format: output.format === "ad" || output.format === "character" || output.format === "promo" ? output.format : null,
    videoPath: safeText(output.videoPath, 300),
    durationSec: typeof output.durationSec === "number" && Number.isFinite(output.durationSec) ? Math.max(0, Math.min(60, output.durationSec)) : null,
    qa: safeShortsQa(output.qa),
    voiceFallback: output.voiceFallback === true,
    sampleVideo: output.sampleVideo === true,
    references: safeReferences(output.references),
    publicationResults: safePublicationResults(output.publicationResults),
  };

  const hasVisibleValue = Object.entries(safe).some(([key, item]) => {
    if (Array.isArray(item)) return item.length > 0;
    if (key === "publicationResults") return Object.keys(item as object).length > 0;
    if (key === "sampleVideo" || key === "voiceFallback") return false;
    return item !== null;
  });
  return hasVisibleValue ? safe : null;
}
