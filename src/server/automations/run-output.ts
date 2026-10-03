import "server-only";

import type { Json } from "@/types/domain";

export interface SafeAutomationRunOutput {
  title: string | null;
  topic: string | null;
  summary: string | null;
  body: string | null;
  callToAction: string | null;
  keywords: string[];
  externalUrl: string | null;
  destinationStatus: "draft" | "publish" | null;
  /** Blog-only (added alongside the generation-only switch) — null for every run from before that change or for non-blog handlers. */
  hook: string | null;
  seoKeywords: string[];
  imageSuggestion: string | null;
  videoUrl: string | null;
  caption: string | null;
  script: string | null;
  scenes: Array<{ text: string; durationSec: number }>;
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
  const destinationStatus = output.wordpressStatus === "draft" || output.wordpressStatus === "publish"
    ? output.wordpressStatus
    : null;
  const safe: SafeAutomationRunOutput = {
    title: safeText(output.title, 500),
    topic: safeText(output.topic, 500),
    summary: safeText(output.excerpt, 2_000) ?? safeText(output.summary, 2_000),
    body,
    callToAction: safeText(output.callToAction, 1_000),
    keywords,
    externalUrl: safeExternalUrl(output.externalUrl),
    destinationStatus,
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
    publicationResults: safePublicationResults(output.publicationResults),
  };

  const hasVisibleValue = Object.entries(safe).some(([key, item]) => {
    if (Array.isArray(item)) return item.length > 0;
    if (key === "publicationResults") return Object.keys(item as object).length > 0;
    return item !== null;
  });
  return hasVisibleValue ? safe : null;
}
