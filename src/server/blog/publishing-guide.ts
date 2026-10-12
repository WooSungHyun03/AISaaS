import { z } from "zod";
import type { PromotionType } from "@/types/promotion";
import { UNPROVABLE_CLAIMS } from "@/server/ai/blog-quality";
import { postBodyText, stripInlineMarkup, type BlogBlock, type BlogPost } from "./post";
import { renderBlogText, type BlogRenderTheme } from "./render";

/**
 * Everything an owner needs to turn the written post into a published one: how to style it in the blog
 * editor, which photo goes where, and the title / keyword / tag set. The AI proposes, this module checks
 * (colours must be readable, sizes must exist in the editor, tags must come from the post) and fills in a
 * rule-based answer when the AI part is missing, so the guide is always complete and always honest.
 *
 * Pure and shared by the server (generation) and the client (live view of an edited post).
 */

export type GuidePlatform = "naver" | "tistory";

// ── Style guide ───────────────────────────────────────────────────────────────

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export const textStyleSchema = z.object({
  sizePx: z.number().int().min(10).max(48),
  color: hex,
  bold: z.boolean(),
  align: z.enum(["left", "center"]),
  /** Line height as a multiplier (body only). */
  lineHeight: z.number().min(1).max(2.4).optional(),
  note: z.string().max(160).optional(),
});
export type TextStyle = z.infer<typeof textStyleSchema>;

export const blogStyleGuideSchema = z.object({
  platform: z.enum(["naver", "tistory"]),
  fontFamily: z.string().min(1).max(40),
  fontAlternatives: z.array(z.string().max(40)).max(4),
  fontNote: z.string().max(240),
  title: textStyleSchema,
  heading: textStyleSchema,
  body: textStyleSchema,
  emphasis: textStyleSchema,
  cta: textStyleSchema,
  caption: textStyleSchema,
  paragraphSpacing: z.string().max(160),
  emphasisMethod: z.string().max(200),
  emphasisLimit: z.string().max(200),
  rationale: z.string().max(300),
  cautions: z.array(z.string().max(200)).max(6),
});
export type BlogStyleGuide = z.infer<typeof blogStyleGuideSchema>;

/** Fonts the editor's own font list offers (versions differ, so the guide says to pick from the list). */
const FONTS: Record<GuidePlatform, string[]> = {
  naver: ["나눔고딕", "나눔바른고딕", "나눔스퀘어", "나눔명조", "마루부리"],
  tistory: ["스킨 기본 글꼴", "나눔고딕", "맑은 고딕", "나눔명조"],
};
/** The SmartEditor's size list. Tistory takes any size, so it is only clamped. */
const NAVER_SIZES = [11, 13, 15, 16, 19, 24, 28, 30, 34, 38];

const PALETTE: Record<PromotionType, { heading: string; emphasis: string }> = {
  STORE: { heading: "#B45309", emphasis: "#B91C1C" },
  PRODUCT: { heading: "#1D4ED8", emphasis: "#DC2626" },
  PLATFORM: { heading: "#4338CA", emphasis: "#0F766E" },
};
const NEUTRAL = { title: "#1F2937", body: "#374151", caption: "#6B7280" };

function luminance(color: string): number {
  const channel = (offset: number) => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast of a text colour on a white page. */
export function contrastOnWhite(color: string): number {
  return 1.05 / (luminance(color) + 0.05);
}

function readableColor(candidate: unknown, fallback: string, minContrast = 4.5): string {
  return typeof candidate === "string" && hex.safeParse(candidate).success && contrastOnWhite(candidate) >= minContrast ? candidate.toUpperCase() : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function snapSize(platform: GuidePlatform, value: unknown, min: number, max: number, fallback: number): number {
  const wanted = clamp(value, min, max, fallback);
  if (platform !== "naver") return Math.round(wanted);
  return NAVER_SIZES.filter((size) => size >= min && size <= max).reduce((best, size) => (Math.abs(size - wanted) < Math.abs(best - wanted) ? size : best), fallback);
}

export interface AiStyleDraft {
  fontFamily?: string;
  titleColor?: string;
  headingColor?: string;
  bodyColor?: string;
  emphasisColor?: string;
  titleSize?: number;
  headingSize?: number;
  bodySize?: number;
  emphasisSize?: number;
  lineHeight?: number;
  titleAlign?: string;
  emphasisMethod?: string;
  rationale?: string;
}

export interface BlogGuideContext {
  platform: GuidePlatform;
  promotionType: PromotionType;
  businessName: string;
  industry: string | null;
  location: string | null;
  tone: string | null;
  /** Keywords the owner chose (post setup first, then the profile). */
  keywords: string[];
  /** Labels of images the owner already uploaded (private; only names are used here). */
  ownedImages?: Array<{ label: string; subject: string }>;
}

export function buildStyleGuide(context: BlogGuideContext, draft: AiStyleDraft = {}): BlogStyleGuide {
  const { platform, promotionType } = context;
  const palette = PALETTE[promotionType];
  const fonts = FONTS[platform];
  const fontFamily = draft.fontFamily && fonts.includes(draft.fontFamily) ? draft.fontFamily : fonts[0];
  const headingColor = readableColor(draft.headingColor, palette.heading);
  const emphasisColor = readableColor(draft.emphasisColor, palette.emphasis);
  const bodyColor = readableColor(draft.bodyColor, NEUTRAL.body, 7);
  const titleColor = readableColor(draft.titleColor, NEUTRAL.title, 7);
  const lineHeight = Math.round(clamp(draft.lineHeight, 1.6, 2, 1.8) * 10) / 10;

  const bodySize = snapSize(platform, draft.bodySize, 15, 17, 16);
  const style: BlogStyleGuide = {
    platform,
    fontFamily,
    fontAlternatives: fonts.filter((font) => font !== fontFamily).slice(0, 2),
    fontNote: platform === "naver"
      ? "네이버 편집기는 붙여넣은 글꼴을 유지하지 않아요. 글을 붙여넣은 뒤 전체 선택하고 글꼴 목록에서 직접 골라주세요. Pretendard 같은 웹폰트는 편집기 목록에 없어 쓸 수 없어요."
      : "티스토리는 스킨의 글꼴을 따라가요. 기본 글꼴이 읽기 편하다면 바꾸지 않아도 되고, 바꾸려면 편집기 글꼴 목록에서 골라주세요.",
    title: { sizePx: snapSize(platform, draft.titleSize, 24, 30, 28), color: titleColor, bold: true, align: draft.titleAlign === "left" ? "left" : "center", note: "제목 칸에 입력해요. 제목은 색을 바꾸지 않아도 괜찮아요." },
    heading: { sizePx: snapSize(platform, draft.headingSize, 19, 24, 24), color: headingColor, bold: true, align: "left", note: "소제목마다 같은 색과 크기로 통일해요." },
    body: { sizePx: bodySize, color: bodyColor, bold: false, align: "left", lineHeight, note: "모바일에서 읽는 사람이 많으니 16px 안팎이 편해요." },
    emphasis: { sizePx: snapSize(platform, draft.emphasisSize, 16, 19, 19), color: emphasisColor, bold: true, align: "left", note: "인용구·핵심 문장에만 써요." },
    cta: { sizePx: bodySize, color: emphasisColor, bold: true, align: "center", note: "마지막 행동 유도 문장 한 줄에만 써요." },
    caption: { sizePx: platform === "naver" ? 13 : 13, color: NEUTRAL.caption, bold: false, align: "center", note: "사진 바로 아래 설명 글이에요." },
    paragraphSpacing: platform === "naver"
      ? "문단 사이는 빈 줄 한 줄로 띄우세요. 편집기에 문단 간격 설정이 없어서 줄 띄우기가 가장 안전해요."
      : "문단 사이는 빈 줄 한 줄로 띄우거나, HTML 모드에서는 문단 아래 여백 16~18px을 주세요.",
    emphasisMethod: draft.emphasisMethod?.trim().slice(0, 200) || "핵심 단어는 굵게, 가장 중요한 한 문장은 형광펜(배경색)으로 표시해요.",
    emphasisLimit: "굵게는 문단당 1~2곳, 색 글자와 형광펜은 글 전체에서 3~5곳 이하로 쓰세요. 색은 소제목색·강조색 두 가지만 써야 읽기 편해요.",
    rationale: draft.rationale?.trim().slice(0, 300) || styleRationale(context),
    cautions: [
      "지원하지 않는 서식은 붙여넣을 때 사라질 수 있어요. 크기·굵게·글자색·형광펜은 보통 유지되지만, 붙여넣은 뒤 꼭 미리보기로 확인하세요.",
      "정렬은 왼쪽과 가운데만 써요. 글자색을 3가지 넘게 쓰거나 모든 줄을 굵게 하면 오히려 읽기 어려워요.",
    ],
  };
  return blogStyleGuideSchema.parse(style);
}

function styleRationale(context: BlogGuideContext): string {
  const toneText = context.tone ? `‘${context.tone}’ 분위기에 맞춰` : "읽기 편한 분위기로";
  const kind = context.promotionType === "STORE" ? "따뜻하고 가게다운 색" : context.promotionType === "PRODUCT" ? "또렷하고 신뢰가 가는 색" : "깔끔하고 서비스다운 색";
  return `${toneText} ${kind}을 소제목에 쓰고, 본문은 어두운 회색으로 눈이 편하게 했어요.`;
}

/** The look the guide recommends, as input for the styled preview and the "copy with style" HTML. */
export function themeFromStyle(style: BlogStyleGuide): BlogRenderTheme {
  return {
    headingColor: style.heading.color,
    headingSize: style.heading.sizePx,
    bodyColor: style.body.color,
    bodySize: style.body.sizePx,
    lineHeight: style.body.lineHeight ?? 1.8,
    emphasisColor: style.emphasis.color,
    emphasisSize: style.emphasis.sizePx,
  };
}

const toPt = (px: number) => Math.round(px * 0.75 * 10) / 10;

// ── Image placements ─────────────────────────────────────────────────────────

export const IMAGE_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16"] as const;
export const blogImageDetailSchema = z.object({
  type: z.string().min(1).max(40),
  ratio: z.enum(IMAGE_RATIOS),
  caption: z.string().max(80),
  altText: z.string().max(120),
  reason: z.string().max(140),
});
export type BlogImageDetail = z.infer<typeof blogImageDetailSchema>;

export interface AiImageDraft {
  index?: number;
  type?: string;
  ratio?: string;
  caption?: string;
  altText?: string;
  reason?: string;
}

export interface ImagePlacement extends BlogImageDetail {
  number: number;
  /** What the picture should show, as written in the post's photo spot. */
  description: string;
  sectionLabel: string;
  afterLabel: string;
  afterExcerpt: string | null;
  /** An image the owner already uploaded that fits this spot (name only). */
  ownedImage: string | null;
}

const IMAGE_TYPES: Record<PromotionType, Array<{ type: string; reason: string }>> = {
  STORE: [
    { type: "매장 외관", reason: "처음 찾아오는 분이 간판과 입구를 알아볼 수 있어요." },
    { type: "매장 내부", reason: "공간 분위기를 보여주면 방문 전에 안심해요." },
    { type: "대표 메뉴·서비스", reason: "가장 잘하는 것을 눈으로 먼저 확인시켜요." },
    { type: "위치·가는 길", reason: "찾아오는 길이 헷갈리지 않게 도와줘요." },
    { type: "실제 공간·이용 모습", reason: "실제 이용 장면은 글의 신뢰를 높여요." },
  ],
  PRODUCT: [
    { type: "제품 전체 사진", reason: "상품의 첫인상과 전체 모습을 보여줘요." },
    { type: "주요 특징 클로즈업", reason: "글에서 말한 특징을 사진으로 확인시켜요." },
    { type: "실제 사용 장면", reason: "어떻게 쓰는지 상상하게 만들어요." },
    { type: "상세·구성품 사진", reason: "구매 전에 궁금한 구성과 디테일을 풀어줘요." },
    { type: "크기·비교 사진", reason: "크기와 쓰임새를 가늠할 수 있어요." },
  ],
  PLATFORM: [
    { type: "서비스 첫 화면", reason: "어떤 서비스인지 한눈에 보여줘요." },
    { type: "핵심 기능 화면", reason: "글에서 설명한 기능을 직접 보여줘요." },
    { type: "사용 과정 화면", reason: "쓰는 순서를 따라 하기 쉽게 해줘요." },
    { type: "결과 화면", reason: "써보면 무엇을 얻는지 보여줘요." },
    { type: "가입·시작 화면", reason: "다음 행동으로 자연스럽게 이어줘요." },
  ],
};

const PREFERRED_OWNED: Record<PromotionType, string[]> = { STORE: ["place", "product", "other"], PRODUCT: ["product", "other"], PLATFORM: ["other", "product"] };

function photoBlocks(post: BlogPost): Array<{ block: Extract<BlogBlock, { type: "photo" }>; sectionIndex: number }> {
  const out: Array<{ block: Extract<BlogBlock, { type: "photo" }>; sectionIndex: number }> = [];
  post.sections.forEach((section, sectionIndex) => {
    for (const block of section.blocks) if (block.type === "photo") out.push({ block, sectionIndex });
  });
  return out;
}

const ordinal = (n: number) => ["첫", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열"][n - 1] ?? `${n}`;

function describeAfter(post: BlogPost, sectionIndex: number, photo: BlogBlock): { afterLabel: string; afterExcerpt: string | null } {
  const section = post.sections[sectionIndex];
  const at = section.blocks.indexOf(photo);
  let previous: BlogBlock | undefined;
  for (let i = at - 1; i >= 0; i -= 1) {
    if (section.blocks[i].type !== "photo") { previous = section.blocks[i]; break; }
  }
  if (!previous) return { afterLabel: sectionIndex === 0 ? "글 맨 처음" : section.heading ? "소제목 바로 아래" : "이 부분의 처음", afterExcerpt: null };
  const excerptOf = (text: string) => stripInlineMarkup(text).replace(/\s+/g, " ").slice(0, 28);
  switch (previous.type) {
    case "paragraph": {
      const nth = section.blocks.slice(0, section.blocks.indexOf(previous) + 1).filter((block) => block.type === "paragraph").length;
      return { afterLabel: `${ordinal(nth)} 번째 문단 다음`, afterExcerpt: excerptOf(previous.text) };
    }
    case "list": return { afterLabel: "목록 다음", afterExcerpt: excerptOf(previous.items[0] ?? "") };
    case "quote": return { afterLabel: "인용구 다음", afterExcerpt: excerptOf(previous.text) };
    case "callout": return { afterLabel: "포인트 박스 다음", afterExcerpt: excerptOf(previous.text) };
    default: return { afterLabel: "앞 내용 다음", afterExcerpt: null };
  }
}

function sectionLabelOf(post: BlogPost, sectionIndex: number): string {
  const heading = post.sections[sectionIndex].heading;
  if (heading) return `소제목 “${stripInlineMarkup(heading)}”`;
  return sectionIndex === 0 ? "도입부" : "마무리";
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/**
 * One placement per photo spot that is really in the post. Where the picture goes is read from the post
 * itself (so it always matches the text, also after the owner edited it); what it should show and how it
 * is described comes from the guide's per-photo details, with a rule-based answer when none was stored.
 */
export function buildImagePlacements(post: BlogPost, details: BlogImageDetail[] | undefined, context: Pick<BlogGuideContext, "promotionType" | "businessName" | "ownedImages">): ImagePlacement[] {
  const owned = [...(context.ownedImages ?? [])];
  const types = IMAGE_TYPES[context.promotionType];
  return photoBlocks(post).map(({ block, sectionIndex }, index) => {
    const stored = details?.[index];
    const fallback = types[index % types.length];
    const description = stripInlineMarkup(block.slot);
    const caption = cleanText(block.caption, 80) || stored?.caption || description.slice(0, 40);
    const preferred = PREFERRED_OWNED[context.promotionType];
    const ownedAt = owned.findIndex((image) => preferred.includes(image.subject));
    const ownedImage = ownedAt >= 0 ? owned.splice(ownedAt, 1)[0].label : null;
    return {
      number: index + 1,
      description,
      type: stored?.type ?? fallback.type,
      ratio: stored?.ratio ?? "4:3",
      caption,
      altText: stored?.altText ?? `${context.businessName} ${description}`.slice(0, 100),
      reason: stored?.reason ?? fallback.reason,
      sectionLabel: sectionLabelOf(post, sectionIndex),
      ...describeAfter(post, sectionIndex, block),
      ownedImage,
    };
  });
}

/** How many pictures a post of this length can carry without looking stuffed: about one per 500 characters. */
export function recommendedImageCount(chars: number): { min: number; max: number } {
  const base = Math.round(chars / 500);
  return { min: Math.max(3, base - 1), max: Math.min(10, Math.max(4, base + 2)) };
}

// ── SEO ──────────────────────────────────────────────────────────────────────

export const SEARCH_INTENTS = ["정보 탐색", "방문·위치 확인", "비교·구매", "가입·사용 방법"] as const;
export const blogSeoSchema = z.object({
  titleCandidates: z.array(z.string().min(1).max(80)).max(4),
  primaryKeyword: z.string().min(1).max(40),
  secondaryKeywords: z.array(z.string().max(40)).max(6),
  regionKeywords: z.array(z.string().max(40)).max(6),
  searchIntent: z.enum(SEARCH_INTENTS),
  searchIntentNote: z.string().max(140),
  tags: z.array(z.string().min(2).max(24)).min(1).max(12),
  metaDescription: z.string().min(1).max(200),
});
export type BlogSeo = z.infer<typeof blogSeoSchema>;

export interface AiSeoDraft {
  titleCandidates?: unknown;
  primaryKeyword?: unknown;
  secondaryKeywords?: unknown;
  regionKeywords?: unknown;
  searchIntent?: unknown;
  searchIntentNote?: unknown;
  tags?: unknown;
  metaDescription?: unknown;
}

const norm = (text: string) => text.toLowerCase().replace(/[\s#.,!?·'"“”‘’()[\]{}~\-_/]+/g, "");
const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const hasClaim = (text: string) => UNPROVABLE_CLAIMS.some((claim) => text.includes(claim));

function regionTokens(location: string | null): string[] {
  return (location ?? "").split(/[\s,()]+/).map((part) => part.trim()).filter((part) => part.length >= 2 && !/^\d+$/.test(part)).slice(0, 3);
}

function intentFor(type: PromotionType): { intent: (typeof SEARCH_INTENTS)[number]; note: string } {
  if (type === "STORE") return { intent: "방문·위치 확인", note: "동네에서 갈 곳을 찾는 사람이 위치·분위기·대표 메뉴를 확인하려고 검색해요." };
  if (type === "PRODUCT") return { intent: "비교·구매", note: "살까 말까 고민하는 사람이 특징과 사용감을 비교하려고 검색해요." };
  return { intent: "가입·사용 방법", note: "문제를 풀 서비스를 찾는 사람이 기능과 사용 방법을 알아보려고 검색해요." };
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

/**
 * Titles, keywords and tags for the post. A tag or keyword is kept only when it is something the owner chose
 * or it really appears in the post (or is a place name plus an owner keyword for a shop), so the list can
 * never drift away from the text. Unprovable claims are dropped from titles.
 */
export function buildSeo(post: BlogPost, context: BlogGuideContext, draft: AiSeoDraft = {}): BlogSeo {
  const body = norm(`${post.title} ${postBodyText(post)}`);
  const regions = context.promotionType === "STORE" ? regionTokens(context.location) : [];
  const ownerTerms = distinct([...context.keywords, context.businessName, ...(context.industry ? [context.industry] : [])].map((term) => term.replace(/^#/, "").trim()).filter((term) => term.length >= 2), 20);
  const ownerNorm = new Set(ownerTerms.map(norm));
  const regionCombos = new Set(regions.flatMap((region) => ownerTerms.slice(0, 6).map((term) => norm(`${region}${term}`))));
  const grounded = (term: string) => {
    const key = norm(term);
    return key.length >= 2 && (ownerNorm.has(key) || body.includes(key) || regionCombos.has(key));
  };
  const clean = (list: unknown, limit: number, max = 24) =>
    distinct(asStrings(list).map((item) => item.replace(/^#/, "").trim()).filter((item) => item.length >= 2 && item.length <= max && grounded(item)), limit);

  const primaryCandidate = typeof draft.primaryKeyword === "string" ? draft.primaryKeyword.trim() : "";
  const primaryKeyword = (primaryCandidate && grounded(primaryCandidate) ? primaryCandidate : context.keywords[0] ?? ownerTerms[0] ?? post.title.slice(0, 20)).slice(0, 40);
  const secondaryKeywords = clean(draft.secondaryKeywords, 5).filter((term) => norm(term) !== norm(primaryKeyword));
  for (const term of ownerTerms) {
    if (secondaryKeywords.length >= 3) break;
    if (norm(term) !== norm(primaryKeyword) && !secondaryKeywords.some((existing) => norm(existing) === norm(term))) secondaryKeywords.push(term.slice(0, 40));
  }

  const regionKeywords = regions.length === 0 ? [] : distinct([...clean(draft.regionKeywords, 4), ...regions.map((region) => `${region}${primaryKeyword}`.slice(0, 40))], 4).filter((term) => regions.some((region) => term.includes(region)));

  const tags = distinct([...clean(draft.tags, 12), primaryKeyword, ...secondaryKeywords, ...regionKeywords, ...ownerTerms.slice(0, 4)].map((tag) => tag.replace(/\s+/g, "")).filter((tag) => tag.length >= 2 && tag.length <= 24), 10);

  const titleCandidates = distinct(
    [post.title, ...asStrings(draft.titleCandidates).map((title) => title.replace(/\s+/g, " ").trim()).filter((title) => title.length >= 8 && title.length <= 60 && !hasClaim(title))],
    4,
  );

  const intent = intentFor(context.promotionType);
  const draftIntent = SEARCH_INTENTS.find((item) => item === draft.searchIntent);
  const intentNote = cleanText(draft.searchIntentNote, 140);
  const paragraphs = post.sections.flatMap((section) => section.blocks).flatMap((block) => (block.type === "paragraph" ? [stripInlineMarkup(block.text)] : []));
  const firstText = paragraphs.slice(0, 3).join(" ");
  const draftMeta = cleanText(draft.metaDescription, 160);
  const metaDescription = draftMeta.length >= 40 && !hasClaim(draftMeta) ? draftMeta : (firstText || postBodyText(post)).replace(/\s+/g, " ").slice(0, 120);

  return blogSeoSchema.parse({
    titleCandidates,
    primaryKeyword,
    secondaryKeywords: secondaryKeywords.slice(0, 5),
    regionKeywords,
    searchIntent: draftIntent ?? intent.intent,
    searchIntentNote: intentNote || intent.note,
    tags: tags.length > 0 ? tags : [primaryKeyword.replace(/\s+/g, "").slice(0, 24) || context.businessName.slice(0, 24)],
    metaDescription: metaDescription || post.title,
  });
}

/** Naver takes tags typed with # and separated by spaces; Tistory takes them separated by commas. */
export function formatTags(tags: string[], platform: GuidePlatform): string {
  return platform === "naver" ? tags.map((tag) => `#${tag}`).join(" ") : tags.join(",");
}

// ── The whole guide ──────────────────────────────────────────────────────────

export const blogPublishingGuideSchema = z.object({
  v: z.literal(1),
  /** ai = the model chose the style / photo notes / SEO (checked); rules = built from the post and profile only. */
  source: z.enum(["ai", "rules"]),
  style: blogStyleGuideSchema,
  images: z.array(blogImageDetailSchema).max(14),
  seo: blogSeoSchema,
});
export type BlogPublishingGuide = z.infer<typeof blogPublishingGuideSchema>;

export interface AiGuideDraft {
  style?: AiStyleDraft;
  images?: AiImageDraft[];
  seo?: AiSeoDraft;
}

function sanitizeImageDetails(post: BlogPost, context: BlogGuideContext, drafts: AiImageDraft[] | undefined): BlogImageDetail[] {
  const count = photoBlocks(post).length;
  const types = IMAGE_TYPES[context.promotionType];
  return Array.from({ length: count }, (_, index) => {
    const draft = drafts?.find((item) => item.index === index + 1) ?? drafts?.[index];
    const fallback = types[index % types.length];
    const slot = stripInlineMarkup(photoBlocks(post)[index].block.slot);
    const ratio = IMAGE_RATIOS.find((item) => item === draft?.ratio) ?? "4:3";
    const altText = cleanText(draft?.altText, 100);
    return {
      type: cleanText(draft?.type, 40) || fallback.type,
      ratio,
      caption: cleanText(draft?.caption, 80) || cleanText(photoBlocks(post)[index].block.caption, 80) || slot.slice(0, 40),
      // An alt text is a plain description; a keyword list or a claim is not one.
      altText: altText && !hasClaim(altText) && altText.split(",").length <= 3 ? altText : `${context.businessName} ${slot}`.slice(0, 100),
      reason: cleanText(draft?.reason, 140) || fallback.reason,
    };
  });
}

/** Builds the guide from the model's draft (all of it optional and checked) or, with no draft, from rules alone. */
export function buildPublishingGuide(post: BlogPost, context: BlogGuideContext, draft?: AiGuideDraft): BlogPublishingGuide {
  return {
    v: 1,
    source: draft ? "ai" : "rules",
    style: buildStyleGuide(context, draft?.style),
    images: sanitizeImageDetails(post, context, draft?.images),
    seo: buildSeo(post, context, draft?.seo),
  };
}

// ── Copy texts ───────────────────────────────────────────────────────────────

const PLATFORM_NAME: Record<GuidePlatform, string> = { naver: "네이버 블로그", tistory: "티스토리" };
const styleLine = (label: string, style: TextStyle, extra: string[] = []) =>
  [`${label}`, `- 크기: ${style.sizePx}px (약 ${toPt(style.sizePx)}pt)`, `- 색상: ${style.color}`, `- 굵기: ${style.bold ? "Bold" : "Normal"}`, `- 정렬: ${style.align === "center" ? "가운데" : "왼쪽"}`, ...extra].join("\n");

export function styleGuideText(style: BlogStyleGuide): string {
  return [
    `■ 글자 스타일 가이드 (${PLATFORM_NAME[style.platform]})`,
    `글씨체: ${style.fontFamily}${style.fontAlternatives.length ? ` (대체: ${style.fontAlternatives.join(", ")})` : ""}`,
    style.fontNote,
    "",
    styleLine("메인 제목", style.title),
    "",
    styleLine("소제목", style.heading),
    "",
    styleLine("본문", style.body, [`- 줄 간격: ${style.body.lineHeight ?? 1.8}`]),
    "",
    styleLine("강조 문장", style.emphasis),
    "",
    styleLine("행동 유도(CTA) 문장", style.cta),
    "",
    styleLine("사진 설명(캡션)", style.caption),
    "",
    `문단 간격: ${style.paragraphSpacing}`,
    `강조 방법: ${style.emphasisMethod}`,
    `강조 횟수: ${style.emphasisLimit}`,
    `이렇게 정한 이유: ${style.rationale}`,
    "",
    ...style.cautions.map((caution) => `※ ${caution}`),
  ].join("\n");
}

export function imageGuideText(placements: ImagePlacement[]): string {
  if (placements.length === 0) return "■ 이미지 가이드\n이 글에는 사진 자리가 없어요.";
  return [
    "■ 이미지 가이드 (AI가 이미지를 만들지 않았어요. 직접 찍은 사진을 넣어주세요)",
    ...placements.map((item) => [
      "",
      `[이미지 ${item.number} 삽입]`,
      `삽입 위치: ${item.sectionLabel} · ${item.afterLabel}${item.afterExcerpt ? ` (“${item.afterExcerpt}…” 다음)` : ""}`,
      `추천 이미지: ${item.type} — ${item.description}`,
      `권장 비율: ${item.ratio}`,
      `캡션: ${item.caption}`,
      `대체 텍스트(Alt): ${item.altText}`,
      `필요한 이유: ${item.reason}`,
      ...(item.ownedImage ? [`올려둔 이미지 활용: ‘${item.ownedImage}’`] : []),
    ].join("\n")),
  ].join("\n");
}

export function seoGuideText(seo: BlogSeo, platform: GuidePlatform): string {
  return [
    "■ SEO·태그",
    `추천 제목: ${seo.titleCandidates.map((title, index) => `${index + 1}) ${title}`).join("  ")}`,
    `핵심 키워드: ${seo.primaryKeyword}`,
    `보조 키워드: ${seo.secondaryKeywords.join(", ") || "-"}`,
    `지역 키워드: ${seo.regionKeywords.join(", ") || "해당 없음"}`,
    `검색 의도: ${seo.searchIntent} — ${seo.searchIntentNote}`,
    `검색 결과용 요약: ${seo.metaDescription}`,
    `${PLATFORM_NAME[platform]} 태그: ${formatTags(seo.tags, platform)}`,
  ].join("\n");
}

/** The post as plain text with every picture spot numbered the way the image guide numbers it. */
export function postTextWithImageMarks(post: BlogPost): string {
  return renderBlogText(post);
}

/** The full publishing kit in one paste: title, text with numbered picture spots, style, pictures, SEO. */
export function fullPublishingGuideText(args: { title: string; post: BlogPost; guide: Pick<BlogPublishingGuide, "style" | "seo">; placements: ImagePlacement[] }): string {
  const { title, post, guide, placements } = args;
  return [
    `제목: ${title}`,
    "",
    "■ 본문",
    postTextWithImageMarks(post),
    "",
    styleGuideText(guide.style),
    "",
    imageGuideText(placements),
    "",
    seoGuideText(guide.seo, guide.style.platform),
  ].join("\n");
}
