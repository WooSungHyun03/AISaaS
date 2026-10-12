import { z } from "zod";
import type { PromotionType } from "@/types/promotion";
import { UNPROVABLE_CLAIMS } from "@/server/ai/blog-quality";

/**
 * What goes next to a finished Short when it is posted: title, alternative titles, description, keywords,
 * hashtags and a call to action. It is written from the real script and scenes of the video that was made (never
 * from the topic alone), checked here, and kept in one shape that the YouTube and Instagram fields are composed from —
 * so editing it once edits what both platforms receive.
 *
 * Pure and shared by the server and the editing screen.
 */

export const shortsPublishingSchema = z.object({
  v: z.literal(1),
  /** ai = written by the model from this video's script and checked; rules = built from the script and profile only. */
  source: z.enum(["ai", "rules"]),
  title: z.string().trim().min(1).max(100),
  alternativeTitles: z.array(z.string().trim().min(1).max(100)).max(3),
  /** Post text without hashtags. */
  description: z.string().trim().min(1).max(1_500),
  keywords: z.array(z.string().trim().min(2).max(30)).min(1).max(10),
  /** Without the leading #. */
  hashtags: z.array(z.string().trim().min(2).max(30)).min(1).max(12),
  callToAction: z.string().trim().min(1).max(120),
  /** What the video shows, in the owner's words. */
  summary: z.string().trim().min(1).max(300),
  /** Search-friendly title for YouTube Shorts (keyword first). */
  youtubeTitle: z.string().trim().min(1).max(100),
  /** First line of the Instagram caption: the part shown before "more". */
  instagramHook: z.string().trim().min(1).max(125),
});
export type ShortsPublishing = z.infer<typeof shortsPublishingSchema>;

export interface ShortsMetaContext {
  promotionType: PromotionType;
  businessName: string;
  industry: string | null;
  location: string | null;
  /** Owner keywords (profile). */
  keywords: string[];
  topic: string;
  hook: string;
  /** The narration of each scene, in order. */
  sceneTexts: string[];
  /** Purchase / sign-up / website address the owner entered, if any. */
  link: string | null;
}

export interface AiShortsPublishingDraft {
  title?: unknown;
  alternativeTitles?: unknown;
  description?: unknown;
  keywords?: unknown;
  hashtags?: unknown;
  callToAction?: unknown;
  summary?: unknown;
  youtubeTitle?: unknown;
  instagramHook?: unknown;
}

const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const hasClaim = (text: string) => UNPROVABLE_CLAIMS.some((claim) => text.includes(claim)) || /충격|경악|무조건|절대 놓치지|100\s?%/.test(text);
const oneLine = (value: unknown, max: number): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

function bigrams(text: string): Set<string> {
  const key = norm(text);
  const out = new Set<string>();
  for (let i = 0; i < key.length - 1; i += 1) out.add(key.slice(i, i + 2));
  return out;
}

/** A title may only talk about what the video is about: it must share wording with the video's own text. */
export function relatesToVideo(candidate: string, source: string): boolean {
  const have = bigrams(source);
  const grams = bigrams(candidate);
  let shared = 0;
  for (const gram of grams) if (have.has(gram)) shared += 1;
  // A few common syllable pairs ("해보", "세요") appear in any Korean text; real overlap is a good share of the candidate.
  return shared >= 2 && shared / grams.size >= 0.2;
}

function distinct(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = norm(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

const tagOf = (value: string) => value.replace(/^#+/, "").replace(/[\s#]+/g, "").replace(/[^\p{L}\p{N}_]/gu, "");

const CTA_FALLBACK: Record<PromotionType, string> = {
  STORE: "방문 전에 궁금한 점은 댓글로 남겨 주세요.",
  PRODUCT: "궁금한 점은 댓글로 남겨 주세요.",
  PLATFORM: "써보고 싶다면 아래 안내를 확인해 주세요.",
};

function sourceText(context: ShortsMetaContext): string {
  return [context.topic, context.hook, ...context.sceneTexts].join(" ");
}

/** The title the video itself suggests: its spoken hook, which is by definition about the video. */
function fallbackTitle(context: ShortsMetaContext): string {
  return (context.hook.trim() || context.topic.trim() || context.businessName).slice(0, 60);
}

export function buildShortsPublishing(context: ShortsMetaContext, draft?: AiShortsPublishingDraft): ShortsPublishing {
  const source = sourceText(context);
  const ownerTerms = distinct([...context.keywords, context.businessName, ...(context.industry ? [context.industry] : [])].map((term) => term.replace(/^#/, "").trim()).filter((term) => term.length >= 2), 12);
  const region = context.promotionType === "STORE" ? (context.location ?? "").split(/[\s,()]+/).find((part) => part.length >= 2 && !/^\d+$/.test(part)) ?? null : null;
  const grounded = (term: string) => {
    const key = norm(term);
    return key.length >= 2 && (norm(source).includes(key) || ownerTerms.some((owner) => norm(owner) === key) || (region !== null && ownerTerms.some((owner) => norm(`${region}${owner}`) === key)));
  };
  const honestTitle = (title: string, max: number) => title.length >= 6 && title.length <= max && !hasClaim(title) && relatesToVideo(title, `${source} ${context.businessName}`);

  const titleDraft = oneLine(draft?.title, 100);
  const title = titleDraft && honestTitle(titleDraft, 70) ? titleDraft : fallbackTitle(context);
  const alternatives = distinct(
    [...asStrings(draft?.alternativeTitles).map((item) => oneLine(item, 100)).filter((item) => honestTitle(item, 70)), context.topic.slice(0, 70), `${context.businessName} ${context.topic}`.slice(0, 70)],
    6,
  ).filter((item) => norm(item) !== norm(title)).slice(0, 3);

  const summaryDraft = oneLine(draft?.summary, 300);
  const summary = summaryDraft.length >= 10 && !hasClaim(summaryDraft) ? summaryDraft : `${context.topic} — ${context.sceneTexts.slice(0, 3).join(" ")}`.slice(0, 280);

  const descriptionDraft = typeof draft?.description === "string" ? draft.description.replace(/#[\p{L}\p{N}_]+/gu, "").replace(/[ \t]+\n/g, "\n").trim().slice(0, 900) : "";
  const description = descriptionDraft.length >= 20 && !hasClaim(descriptionDraft) && relatesToVideo(descriptionDraft, source) ? descriptionDraft : `${context.topic}\n${context.sceneTexts.slice(0, 3).join(" ")}`.slice(0, 600);

  const keywords = distinct([...asStrings(draft?.keywords).map((item) => item.replace(/^#/, "").trim()).filter((item) => item.length >= 2 && item.length <= 30 && grounded(item)), ...ownerTerms], 8);

  const hashtagSources = [...asStrings(draft?.hashtags).filter((item) => grounded(tagOf(item))), ...keywords, ...(region && ownerTerms[0] ? [`${region}${ownerTerms[0]}`] : [])];
  const hashtags = distinct(hashtagSources.map(tagOf).filter((tag) => tag.length >= 2 && tag.length <= 24), 8);

  const ctaDraft = oneLine(draft?.callToAction, 120);
  const callToAction = ctaDraft && !hasClaim(ctaDraft) ? ctaDraft : CTA_FALLBACK[context.promotionType];

  const ytDraft = oneLine(draft?.youtubeTitle, 100);
  const hookDraft = oneLine(draft?.instagramHook, 125);

  return shortsPublishingSchema.parse({
    v: 1,
    source: draft ? "ai" : "rules",
    title,
    alternativeTitles: alternatives,
    description,
    keywords: keywords.length > 0 ? keywords : [context.businessName],
    hashtags: hashtags.length > 0 ? hashtags : [tagOf(context.businessName) || "숏폼"],
    callToAction,
    summary,
    youtubeTitle: ytDraft && honestTitle(ytDraft, 70) ? ytDraft : title,
    instagramHook: hookDraft && !hasClaim(hookDraft) && relatesToVideo(hookDraft, source) ? hookDraft : context.hook.slice(0, 120) || title,
  });
}

/** Cleans what the owner typed: trims, drops #, de-duplicates and keeps within the limits. Never throws away their wording. */
export function normalizeShortsPublishing(input: unknown): { ok: true; value: ShortsPublishing } | { ok: false; error: string } {
  const record = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  if (!record) return { ok: false, error: "입력 내용을 확인해주세요." };
  const lines = (value: unknown, max: number, limit: number) => distinct(asStrings(value).map((item) => item.replace(/^#+/, "").trim().slice(0, max)).filter((item) => item.length >= 2), limit);
  const parsed = shortsPublishingSchema.safeParse({
    v: 1,
    source: record.source === "ai" ? "ai" : "rules",
    title: oneLine(record.title, 100),
    alternativeTitles: distinct(asStrings(record.alternativeTitles).map((item) => oneLine(item, 100)).filter(Boolean), 3),
    description: typeof record.description === "string" ? record.description.replace(/\r\n?/g, "\n").trim().slice(0, 1_500) : "",
    keywords: lines(record.keywords, 30, 10),
    hashtags: distinct(asStrings(record.hashtags).map(tagOf).filter((tag) => tag.length >= 2).map((tag) => tag.slice(0, 30)), 12),
    callToAction: oneLine(record.callToAction, 120),
    summary: oneLine(record.summary, 300),
    youtubeTitle: oneLine(record.youtubeTitle, 100) || oneLine(record.title, 100),
    instagramHook: oneLine(record.instagramHook, 125) || oneLine(record.title, 100),
  });
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    const labels: Record<string, string> = { title: "제목", description: "영상 설명", keywords: "핵심 키워드(2자 이상 1개 이상)", hashtags: "해시태그(2자 이상 1개 이상)", callToAction: "행동 유도 문구", summary: "영상 요약" };
    return { ok: false, error: `${labels[field] ?? "입력 내용"}을 확인해주세요.` };
  }
  return { ok: true, value: parsed.data };
}

// ── Platform fields ──────────────────────────────────────────────────────────

const hashtagLine = (tags: string[], extra: string[] = []) => distinct([...extra, ...tags], 12).map((tag) => `#${tag}`).join(" ");

export interface YoutubeMetadata {
  title: string;
  description: string;
  /** Video tags (the API field), within YouTube's 500-character total. */
  tags: string[];
}

/**
 * YouTube Shorts: title, description and tags are real API fields. The first hashtags of the description show above the
 * title, so a few relevant ones plus #Shorts are used (more than 15 hashtags make YouTube ignore all of them).
 */
export function youtubeMetadata(meta: ShortsPublishing, link: string | null = null): YoutubeMetadata {
  const tags: string[] = [];
  let length = 0;
  for (const keyword of meta.keywords) {
    length += keyword.length + 3;
    if (length > 480) break;
    tags.push(keyword);
  }
  return {
    title: meta.youtubeTitle.slice(0, 100),
    description: [meta.description, meta.callToAction, ...(link ? [link] : []), hashtagLine(meta.hashtags.slice(0, 5), ["Shorts"])].join("\n\n").slice(0, 5_000),
    tags,
  };
}

/** Instagram Reels: one caption field (up to 2,200 characters). A first line that works before "more", then the text, CTA and a few hashtags. */
export function instagramCaption(meta: ShortsPublishing): string {
  const body = meta.description.startsWith(meta.instagramHook) ? meta.description : `${meta.instagramHook}\n\n${meta.description}`;
  return [body, meta.callToAction, hashtagLine(meta.hashtags.slice(0, 8))].join("\n\n").slice(0, 2_200);
}

export function shortsPublishingText(meta: ShortsPublishing): string {
  return [
    `영상 제목: ${meta.title}`,
    ...meta.alternativeTitles.map((title, index) => `대체 제목 ${index + 1}: ${title}`),
    "",
    "영상 설명:",
    meta.description,
    "",
    `핵심 키워드: ${meta.keywords.join(", ")}`,
    `해시태그: ${meta.hashtags.map((tag) => `#${tag}`).join(" ")}`,
    `CTA: ${meta.callToAction}`,
    `영상 내용 요약: ${meta.summary}`,
  ].join("\n");
}
