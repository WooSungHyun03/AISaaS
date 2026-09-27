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
  };

  return Object.values(safe).some((item) => Array.isArray(item) ? item.length > 0 : item !== null) ? safe : null;
}
