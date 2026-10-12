import { z } from "zod";
import { PROMOTION_LABEL } from "@/types/promotion";
import { UNPROVABLE_CLAIMS } from "@/server/ai/blog-quality";
import { stripInlineMarkup, type BlogPost } from "@/server/blog/post";
import { SEARCH_INTENTS, type BlogGuideContext } from "@/server/blog/publishing-guide";

/** A bad field must not lose the whole answer: each one falls back to undefined and the app fills it in by rules. */
const text = z.string().optional().catch(undefined);
const num = z.number().optional().catch(undefined);
const list = z.array(z.string()).optional().catch(undefined);

export const aiGuideDraftSchema = z.object({
  style: z
    .object({
      fontFamily: text,
      titleColor: text,
      headingColor: text,
      bodyColor: text,
      emphasisColor: text,
      titleSize: num,
      headingSize: num,
      bodySize: num,
      emphasisSize: num,
      lineHeight: num,
      titleAlign: text,
      emphasisMethod: text,
      rationale: text,
    })
    .optional()
    .catch(undefined),
  images: z
    .array(z.object({ index: num, type: text, ratio: text, caption: text, altText: text, reason: text }))
    .optional()
    .catch(undefined),
  seo: z
    .object({
      titleCandidates: list,
      primaryKeyword: text,
      secondaryKeywords: list,
      regionKeywords: list,
      searchIntent: text,
      searchIntentNote: text,
      tags: list,
      metaDescription: text,
    })
    .optional()
    .catch(undefined),
});

export function buildBlogGuidePrompt(args: { post: BlogPost; context: BlogGuideContext; facts: string[]; searchIntentHint?: string }) {
  const { post, context } = args;
  const platformRules = context.platform === "naver"
    ? "Naver Blog SmartEditor: font sizes available are 11, 13, 15, 16, 19, 24, 28, 30, 34, 38 (px); fonts are chosen from the editor list (나눔고딕, 나눔바른고딕, 나눔스퀘어, 나눔명조, 마루부리); pasted fonts are not kept; alignment is left or center; paragraph spacing is made with blank lines."
    : "Tistory: any font size; fonts come from the skin or the editor list (스킨 기본 글꼴, 나눔고딕, 맑은 고딕, 나눔명조); alignment is left or center.";

  const photos: string[] = [];
  let index = 0;
  for (const section of post.sections) {
    for (const block of section.blocks) {
      if (block.type !== "photo") continue;
      index += 1;
      photos.push(`${index}. (${section.heading ? stripInlineMarkup(section.heading) : "intro/closing"}) ${stripInlineMarkup(block.slot)}`);
    }
  }

  const system = [
    "You are a Korean blog publishing consultant for small businesses. You advise how to style, illustrate and tag an already written blog post so it reads well on a phone and is easy to find.",
    `What is promoted: a ${PROMOTION_LABEL[context.promotionType]} (${context.promotionType}). Business: ${context.businessName}${context.industry ? `, industry: ${context.industry}` : ""}${context.location ? `, location: ${context.location}` : ""}${context.tone ? `, brand tone: ${context.tone}` : ""}.`,
    platformRules,
    "STYLE rules: choose colours and sizes that suit the industry and brand tone but stay readable: every text colour is a #RRGGBB value with contrast of at least 4.5:1 on white (body and title at least 7:1), at most TWO accent colours (heading colour and emphasis colour), no neon. Do not use the same style for every business: a cosy cafe, a clinic and a software service should look different. Never recommend a font or size the platform does not offer.",
    "IMAGE rules by promotion type: STORE = exterior, interior, signature service or menu, location, real space; PRODUCT = whole product, key features, use scene, detail shots; PLATFORM = service screen, core feature, usage steps, result screen. You never create images; you only say what photo or screenshot the owner should insert.",
    `SEO rules: every tag and keyword must be something the owner chose or that really appears in the post; no keyword stuffing, no meaningless tag lists; regionKeywords only for a STORE with a location (otherwise empty); titleCandidates are 3 honest alternative titles of 15-40 characters with the main keyword near the front; never use unprovable claims (${UNPROVABLE_CLAIMS.join(", ")}) and never invent facts.`,
  ].join("\n");

  const prompt = [
    "AUTOBIZ_BLOG_GUIDE_V1",
    `Post title: ${post.title}`,
    "Sub-headings:",
    ...post.sections.filter((section) => section.heading).map((section) => `- ${stripInlineMarkup(section.heading ?? "")}`),
    photos.length ? "Photo spots in the post (describe each one):" : "The post has no photo spots.",
    ...photos,
    `Owner keywords: ${context.keywords.join(", ") || "(none)"}`,
    args.searchIntentHint ? `What the searcher wants: ${args.searchIntentHint}` : null,
    "Facts you may rely on:",
    ...args.facts.slice(0, 14).map((line) => `- ${line}`),
    `searchIntent must be one of: ${SEARCH_INTENTS.join(" | ")}.`,
    "Return JSON with exactly this shape (ratio is one of 1:1, 4:3, 3:4, 16:9, 9:16; sizes are numbers in px; lineHeight is a number like 1.8; titleAlign is left or center):",
    '{ "style": { "fontFamily": "나눔고딕", "titleColor": "#1F2937", "headingColor": "#B45309", "bodyColor": "#374151", "emphasisColor": "#B91C1C", "titleSize": 28, "headingSize": 24, "bodySize": 16, "emphasisSize": 19, "lineHeight": 1.8, "titleAlign": "center", "emphasisMethod": "how to emphasise in one sentence", "rationale": "why this look fits (one sentence)" },',
    '  "images": [{ "index": 1, "type": "recommended image type", "ratio": "4:3", "caption": "caption under the photo", "altText": "plain description of the photo", "reason": "why a photo is needed here" }],',
    '  "seo": { "titleCandidates": ["..."], "primaryKeyword": "...", "secondaryKeywords": ["..."], "regionKeywords": [], "searchIntent": "정보 탐색", "searchIntentNote": "one sentence", "tags": ["..."], "metaDescription": "search-result summary of 70-130 characters" } }',
  ].filter(Boolean).join("\n");

  return { system, prompt };
}
