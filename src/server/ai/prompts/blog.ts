import { z } from "zod";
import type { Business } from "@/types/domain";
import type { BlogAutomationConfig } from "@/types/blog-automation";
import { AI_TELL_PHRASES, BLOG_LENGTH, UNPROVABLE_CLAIMS } from "@/server/ai/blog-quality";
import { blogBlockSchema, stripInlineMarkup, type BlogPlatform, type BlogPost, type BlogSection } from "@/server/blog/post";
import { promotionFactLines, promotionGuidance, PROMOTION_STRATEGY, resolvePromotionType } from "@/server/promotion/strategy";

/** One heading of the plan: what the section is for, and what to say and show there. */
const planSectionSchema = z.object({
  /** Sub-heading starting with one emoji. */
  heading: z.string().trim().min(2).max(70),
  purpose: z.string().trim().min(1).max(240),
  /** What to say here — taken only from the facts. */
  points: z.array(z.string().trim().min(1).max(240)).min(1).max(4),
  /** What a photo here should show (the owner's own photo goes in this spot), or null. */
  photo: z.string().trim().max(140).nullable().default(null),
  extra: z.enum(["quote", "callout", "list", "none"]).default("none"),
});

/**
 * The plan for the whole post, made once by the planner (Opus) before anything is written: topic, what the searcher
 * wants, keywords, the outline and where the photos go. The writer gets this as its brief.
 */
export const blogPlanSchema = z.object({
  /** The topic phrase (kept short; used to avoid repeating recent posts). */
  topic: z.string().trim().min(2).max(120),
  /** Final title: main keyword near the front, 15-35 characters, no clickbait. */
  title: z.string().trim().min(6).max(80),
  reader: z.string().trim().min(1).max(200),
  angle: z.string().trim().min(1).max(300),
  /** What the searcher wants to get done — the post must answer exactly that. */
  searchIntent: z.string().trim().max(300).optional(),
  hookIdea: z.string().trim().min(1).max(300),
  keywords: z.object({
    primary: z.string().trim().min(1).max(40),
    secondary: z.array(z.string().trim().min(1).max(40)).max(6).default([]),
  }),
  sections: z.array(planSectionSchema).min(5).max(7),
  closing: z.object({ takeaway: z.string().trim().min(1).max(240), cta: z.string().trim().min(1).max(240) }),
});
export type BlogPlan = z.infer<typeof blogPlanSchema>;

/**
 * The whole post in one answer from the writer: an intro (no heading), one section per planned heading, a closing
 * (no heading). Info boxes and hashtags are the app's, so the writer is not asked for them.
 */
export const blogDraftSchema = z
  .object({
    title: z.string().trim().min(6).max(120),
    sections: z.array(z.object({ heading: z.string().trim().min(1).max(80).optional(), blocks: z.array(blogBlockSchema).min(1).max(14) })).min(7).max(10),
  })
  .superRefine((draft, ctx) => {
    const last = draft.sections.length - 1;
    if (draft.sections[0].heading) ctx.addIssue({ code: "custom", path: ["sections", 0], message: "the intro has no heading" });
    if (draft.sections[last].heading) ctx.addIssue({ code: "custom", path: ["sections", last], message: "the closing has no heading" });
    draft.sections.slice(1, last).forEach((section, offset) => {
      if (!section.heading) ctx.addIssue({ code: "custom", path: ["sections", offset + 1], message: "every body section has a heading" });
    });
  });
export type BlogDraft = z.infer<typeof blogDraftSchema>;

/** Rewritten sections only, by their index in the post: what the targeted fix returns. */
export const blogFixSchema = z.object({
  sections: z.array(z.object({ index: z.number().int().min(0).max(12), heading: z.string().trim().min(1).max(80).optional(), blocks: z.array(blogBlockSchema).min(1).max(14) })).min(1).max(6),
});
export type BlogFix = z.infer<typeof blogFixSchema>;

/** The reviewer's fact check: claims the facts do not support, section by section. */
export const blogReviewSchema = z.object({
  unsupported: z
    .array(
      z.object({
        section: z.number().int().min(0).max(12),
        quote: z.string().trim().max(240).default(""),
        reason: z.string().trim().min(1).max(300),
        severity: z.enum(["high", "low"]).default("low"),
      }),
    )
    .max(12)
    .default([]),
  seo: z
    .object({
      titleNote: z.string().trim().max(240).optional().catch(undefined),
      keywordNote: z.string().trim().max(240).optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});
export type BlogReview = z.infer<typeof blogReviewSchema>;

/** Facts the writer may rely on, as lines, plus the same text for the numeric fact check. */
export function buildBlogFacts(business: Business, config?: BlogAutomationConfig, calendar?: { goal: string; summary: string; cta: string }): { lines: string[]; text: string } {
  const lines = [
    ...promotionFactLines(business, resolvePromotionType(business)),
    business.description ? `소개: ${business.description}` : null,
    business.marketing_goal ? `마케팅 목표: ${business.marketing_goal}` : null,
    business.brand_tone ? `브랜드 톤: ${business.brand_tone}` : null,
    business.keywords.length ? `업체 키워드: ${business.keywords.join(", ")}` : null,
    config?.objective ? `이번 글의 목적: ${config.objective}` : null,
    config?.keywords.length ? `이번 글의 핵심 키워드: ${config.keywords.join(", ")}` : null,
    config?.notes ? `사장님 메모(반드시 반영, 이 안의 구체적 내용은 사실로 써도 됩니다): ${config.notes}` : null,
    calendar ? `캘린더 목표: ${calendar.goal}` : null,
    calendar ? `캘린더 내용: ${calendar.summary}` : null,
    calendar ? `캘린더 CTA: ${calendar.cta}` : null,
  ].filter((line): line is string => Boolean(line));
  return { lines, text: lines.join("\n") };
}

const PLATFORM_STYLE: Record<Exclude<BlogPlatform, "generic">, string> = {
  naver: [
    "Platform: Naver Blog. The reader scrolls on a phone, so write in short paragraphs, use a lively, friendly 해요체, and make every section easy to skim.",
    "Use a warm, chatty rhythm (a quick question to the reader, a small aside), plenty of photo spots, and emoji the way popular Naver business blogs do.",
  ].join(" "),
  tistory: [
    "Platform: Tistory (also read via Google). Write in a clear 해요체 that answers the searcher's question early, with informative sub-headings and a tidy structure.",
    "Emoji are lighter than on Naver (headings and a few paragraph ends), lists and a short summary help, and every section should be useful on its own.",
  ].join(" "),
};

const WRITING_RULES = [
  "You write Korean ad blog posts for a small business, in the style of the best-performing Naver/Tistory business blogs: warm, specific, easy to skim, clearly promotional without sounding like an advertisement.",
  "Voice: the business itself (저희 / 우리 가게 / 사장님) talking to a neighbour-like reader. Never pretend to be a customer or a reviewer.",
  "FACTS: use only the facts provided. Never invent prices, discounts, awards, rankings, statistics, years, opening hours, addresses, phone numbers, ingredients, events, customer reviews, visits or personal anecdotes. Never write a number with a unit (원, %, 시, 분, 개, 명, 년, 호 …) that does not appear in the facts. When a detail is missing, describe the feeling, the situation or the reason instead of guessing.",
  "Human writing: concrete sensory detail taken from the facts (taste, smell, texture, atmosphere, process), a clear point of view, varied sentence length, endings that vary (…해요 / …이에요 / …죠 / noun endings / questions), and a small surprise or opinion per section. No filler, no repeating the same idea in new words.",
  "Formatting you write as plain text (the app renders it): **bold** for key benefits and terms (at most two per paragraph), ==highlight== for the single most important sentence of a section (3-6 in the whole post), one emoji at the start of every heading, and natural emoji at the end of some paragraphs (about 8-25 in the whole post, never more than two in a paragraph).",
  "Paragraphs: 2-4 short sentences (about 150-220 characters). Ask the reader a question once or twice. No walls of text.",
  `Never write these phrases: ${AI_TELL_PHRASES.map((phrase) => `"${phrase}"`).join(", ")}. Never use unprovable claims: ${UNPROVABLE_CLAIMS.map((phrase) => `"${phrase}"`).join(", ")}.`,
  "Keywords: put the main keyword in the first 100 characters and in one sub-heading, and use it naturally 4-7 times in total. Never stuff.",
].join("\n");

function buildSystem(business: Business, platform: Exclude<BlogPlatform, "generic">, config?: BlogAutomationConfig, calendar?: { goal: string; summary: string; cta: string }): string {
  const facts = buildBlogFacts(business, config, calendar);
  const type = resolvePromotionType(business);
  return [
    WRITING_RULES,
    PLATFORM_STYLE[platform],
    ...promotionGuidance(type, "blog").slice(0, 3),
    config?.tone ? `Tone for this automation: ${config.tone}` : null,
    "FACTS (the only things you may state as true):",
    facts.text,
  ].filter(Boolean).join("\n");
}

export interface BlogPlanInput {
  business: Business;
  config?: BlogAutomationConfig;
  calendar?: { goal: string; summary: string; cta: string };
}

/** Step 1 (planner): topic, search intent, keywords, outline and photo spots — one call. A calendar item fixes the topic. */
export function buildBlogPlanPrompt({ business, config, calendar, recentTopics, rejectedTopic, fixedTopic }: BlogPlanInput & { recentTopics: string[]; rejectedTopic?: string; fixedTopic?: string }) {
  const platform = config?.platform ?? "naver";
  const system = buildSystem(business, platform, config, calendar);
  const avoidTopics = rejectedTopic ? [...recentTopics, rejectedTopic] : recentTopics;
  const prompt = [
    "AUTOBIZ_BLOG_PLAN_V2",
    fixedTopic
      ? `Plan one marketing blog post about exactly this planned topic, without replacing it: "${fixedTopic}".`
      : [
        "Pick one specific blog topic that a customer searching Naver or Google would click, relevant to what is promoted, then plan the post.",
        `Choose one of these angles (and vary it from recent topics): ${PROMOTION_STRATEGY[resolvePromotionType(business)].angles.join(" | ")}.`,
        avoidTopics.length ? `Do not reuse or closely resemble these recently used topics — pick something clearly different: ${avoidTopics.join(", ")}.` : "",
      ].filter(Boolean).join("\n"),
    `Length target: about ${BLOG_LENGTH.targetTotal} Korean characters without spaces in total, as an intro, 5-7 sub-headed sections and a closing.`,
    ...promotionGuidance(resolvePromotionType(business), "blog").slice(3),
    "Choose one angle that a real reader searching this topic would want answered, and build the sections so each one gives a reason to keep reading and a reason to choose what is promoted.",
    "State the searcher's intent in searchIntent and make the post answer exactly that, early. Choose one primary keyword (what the searcher types) and up to four secondary keywords, taken from the facts or the owner's keywords.",
    "Every section's points must come from the FACTS; where facts are thin, plan sections about the reader's situation, how to choose, what to look for, or how the business works — never invented specifics.",
    "Distribute photo spots (what the owner's own photo should show) across at least 4 sections, one quote section and one callout section, and a list where it helps.",
    "The final title: primary keyword near the front, 15-35 characters, specific and honest.",
    "Return JSON with exactly these fields:",
    '{ "topic": "short topic phrase", "title": "final title", "reader": "who this is for and what they want", "angle": "the one angle of this post", "searchIntent": "what the searcher wants to get done", "hookIdea": "how the first two sentences hook the reader", "keywords": { "primary": "...", "secondary": ["..."] }, "sections": [{ "heading": "🥐 sub-heading starting with one emoji", "purpose": "what this section does for the reader", "points": ["fact-based point"], "photo": "what the photo here shows or null", "extra": "quote|callout|list|none" }], "closing": { "takeaway": "one-line takeaway", "cta": "one soft, specific call to action" } }',
  ].filter(Boolean).join("\n");
  return { system, prompt };
}

const BLOCK_TYPES =
  'Block types: {"type":"paragraph","text":"…"}, {"type":"quote","text":"…"}, {"type":"list","style":"check|bullet|number","items":["…","…"]}, {"type":"callout","label":"💡 꿀팁","text":"…"}, {"type":"photo","slot":"what the photo shows","caption":"short caption"}. Write inline **bold** and ==highlight== inside the text values.';

function planBrief(plan: BlogPlan): string {
  return [
    `Post title: ${plan.title}`,
    `Reader: ${plan.reader}. Angle: ${plan.angle}.`,
    plan.searchIntent ? `What the searcher wants: ${plan.searchIntent}` : null,
    `Primary keyword: ${plan.keywords.primary}${plan.keywords.secondary.length ? `; secondary: ${plan.keywords.secondary.join(", ")}` : ""}`,
    `Hook idea: ${plan.hookIdea}`,
    "Sections, in order:",
    ...plan.sections.map(
      (section, index) =>
        `${index + 1}. ${section.heading} — purpose: ${section.purpose}. Points (facts only): ${section.points.join(" / ")}.${section.photo ? ` Photo block: slot = "${section.photo}", plus a short caption.` : " No photo block."}${section.extra === "quote" ? " Include one quote block." : section.extra === "callout" ? ' Include one callout block with a label like "💡 꿀팁" or "📌 포인트".' : section.extra === "list" ? " Include one list block (3-5 short items)." : ""}`,
    ),
    `Closing: takeaway: ${plan.closing.takeaway}. CTA: ${plan.closing.cta}.`,
  ].filter(Boolean).join("\n");
}

/** Step 2 (writer): the whole post in one call, so voice, rhythm and flow stay consistent from the first line to the last. */
export function buildBlogDraftPrompt({ business, config, calendar, plan }: BlogPlanInput & { plan: BlogPlan }) {
  const system = buildSystem(business, config?.platform ?? "naver", config, calendar);
  const prompt = [
    "AUTOBIZ_BLOG_DRAFT_V2",
    "Write the whole blog post now, following this plan.",
    planBrief(plan),
    `Structure: first the INTRO (no heading): 2-3 short paragraphs, about 250-400 characters without spaces, the main keyword within the first 100 characters, ending with a one-line quote block that sums up the promise. Then one section per planned heading, in order, using the planned heading text exactly: 2-3 paragraphs, about 330-480 characters without spaces each. Then the CLOSING (no heading): 2 short paragraphs, about 200-320 characters without spaces: the takeaway, then one soft, specific call to action.`,
    `The whole post is about ${BLOG_LENGTH.targetTotal} characters without spaces. Do not repeat ideas or openings between sections. Do not write the business information box or hashtags (the app adds them).`,
    BLOCK_TYPES,
    'Return JSON with exactly this shape: { "title": "the final title", "sections": [ { "blocks": [ … ] }, { "heading": "🥐 …", "blocks": [ … ] }, …, { "blocks": [ … ] } ] }',
  ].join("\n");
  return { system, prompt };
}

export interface BlogProblemSection {
  index: number;
  section: BlogSection;
  problems: string[];
}

/** Step 3 (writer): rewrite only the sections that failed the quality gate or the fact check, fixing every listed problem. */
export function buildBlogFixPrompt({ business, config, calendar, plan, post, targets }: BlogPlanInput & { plan: BlogPlan; post: BlogSection[]; targets: BlogProblemSection[] }) {
  const system = buildSystem(business, config?.platform ?? "naver", config, calendar);
  const prompt = [
    "AUTOBIZ_BLOG_FIX_V2",
    "Part of an already written blog post has problems. Rewrite ONLY the sections listed below, fixing every problem and keeping what already works. Do not touch the other sections.",
    planBrief(plan),
    `The whole post as it stands (for flow — do not repeat these ideas):\n${summarize(post)}`,
    ...targets.map(
      (target) =>
        `SECTION ${target.index}${target.section.heading ? ` (heading: ${target.section.heading})` : target.index === 0 ? " (intro, no heading)" : " (closing, no heading)"}\nCurrent blocks: ${JSON.stringify(target.section.blocks)}\nProblems to fix:\n${target.problems.map((problem) => `- ${problem}`).join("\n")}`,
    ),
    BLOCK_TYPES,
    'Return JSON with exactly this shape, one entry per section above and no others: { "sections": [ { "index": 3, "heading": "keep the heading of a body section", "blocks": [ … ] } ] }',
  ].join("\n");
  return { system, prompt };
}

function summarize(sections: BlogSection[]): string {
  return sections
    .map((section, index) => {
      const text = section.blocks.map((block) => ("text" in block ? block.text : block.type === "list" ? block.items.join(" / ") : "")).filter(Boolean).join(" ");
      return `${index}. ${section.heading ?? (index === 0 ? "(intro)" : "(closing)")}: ${text.slice(0, 140)}…`;
    })
    .join("\n");
}

/** Step 4 (reviewer): checks the finished post against the facts. It never rewrites; it points at what is not supported. */
export function buildBlogReviewPrompt({ plan, post, facts }: { plan: BlogPlan; post: BlogPost; facts: string }) {
  const system = [
    "You are a strict fact checker for Korean marketing blog posts written for a small business.",
    "A claim is SUPPORTED only if the FACTS state it or it is plainly a general, harmless statement (a feeling, an invitation, advice). Flag: invented prices, numbers with units, hours, addresses, awards, rankings, statistics, customer reviews or visits, effects/efficacy, features, menu items or services that the FACTS do not mention.",
    "severity high = a concrete, checkable claim that is not in the FACTS (must be removed). severity low = vague or borderline wording. Do not flag style. Do not flag things the FACTS support. Write every reason in Korean.",
    "FACTS:",
    facts,
  ].join("\n");
  const prompt = [
    "AUTOBIZ_BLOG_REVIEW_V2",
    `Primary keyword: ${plan.keywords.primary}`,
    "The post, section by section (index. heading: text):",
    ...post.sections.map((section, index) => {
      const text = section.blocks.map((block) => ("text" in block ? block.text : block.type === "list" ? block.items.join(" / ") : block.type === "photo" ? "" : "")).filter(Boolean).join(" ");
      return `${index}. ${section.heading ?? (index === 0 ? "(intro)" : "(closing)")}: ${stripInlineMarkup(text)}`;
    }),
    "Also give one short SEO note if the title or the first 100 characters do not contain the primary keyword.",
    'Return JSON with exactly this shape: { "unsupported": [ { "section": 2, "quote": "the exact claim", "reason": "why the facts do not support it", "severity": "high" } ], "seo": { "titleNote": "…", "keywordNote": "…" } }. Use an empty unsupported array when everything is supported.',
  ].join("\n");
  return { system, prompt };
}
