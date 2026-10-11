import { z } from "zod";
import type { Business } from "@/types/domain";
import type { BlogAutomationConfig } from "@/types/blog-automation";
import { AI_TELL_PHRASES, BLOG_LENGTH, UNPROVABLE_CLAIMS } from "@/server/ai/blog-quality";
import { blogBlockSchema, type BlogPlatform, type BlogSection } from "@/server/blog/post";
import { promotionFactLines, promotionGuidance, PROMOTION_STRATEGY, resolvePromotionType } from "@/server/promotion/strategy";

export const blogTopicSchema = z.object({
  topic: z.string().min(1),
  title: z.string().min(1),
});
export type BlogTopic = z.infer<typeof blogTopicSchema>;

/** The plan for the whole post, made once before any section is written. */
export const blogOutlineSchema = z.object({
  /** Final title: main keyword near the front, 15-35 characters, no clickbait. */
  title: z.string().trim().min(6).max(80),
  reader: z.string().trim().min(1).max(200),
  angle: z.string().trim().min(1).max(300),
  /** What the searcher wants to get done — the post must answer exactly that. */
  searchIntent: z.string().trim().max(300).optional(),
  hookIdea: z.string().trim().min(1).max(300),
  sections: z
    .array(
      z.object({
        /** Sub-heading starting with one emoji. */
        heading: z.string().trim().min(2).max(70),
        purpose: z.string().trim().min(1).max(240),
        /** What to say here — taken only from the facts. */
        points: z.array(z.string().trim().min(1).max(240)).min(1).max(4),
        /** What a photo here should show (the owner's own photo goes in this spot), or null. */
        photo: z.string().trim().max(140).nullable().default(null),
        extra: z.enum(["quote", "callout", "list", "none"]).default("none"),
      }),
    )
    .min(5)
    .max(7),
  closing: z.object({ takeaway: z.string().trim().min(1).max(240), cta: z.string().trim().min(1).max(240) }),
});
export type BlogOutline = z.infer<typeof blogOutlineSchema>;

/** One written section: the blocks that go under its heading. The app adds info boxes and hashtags itself. */
export const blogSectionOutputSchema = z.object({ blocks: z.array(blogBlockSchema).min(1).max(12) });

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

/**
 * Stage 1: pick a topic + working title. Kept cheap (small maxTokens) so a
 * near-duplicate topic can be regenerated once without planning a whole post.
 */
export function buildBlogTopicPrompt(
  business: Business,
  recentTopics: string[],
  config?: BlogAutomationConfig,
  rejectedTopic?: string,
) {
  const system = buildSystem(business, config?.platform ?? "naver", config);
  const avoidTopics = rejectedTopic ? [...recentTopics, rejectedTopic] : recentTopics;
  const avoid = avoidTopics.length
    ? `Do not reuse or closely resemble these recently used topics — pick something clearly different: ${avoidTopics.join(", ")}.`
    : "";

  const prompt = [
    "Pick one specific blog topic that a customer searching Naver or Google would click, relevant to what is promoted.",
    `Choose one of these angles (and vary it from recent topics): ${PROMOTION_STRATEGY[resolvePromotionType(business)].angles.join(" | ")}.`,
    avoid,
    "Return JSON with exactly these fields:",
    '{ "topic": "short topic phrase", "title": "catchy blog title" }',
  ]
    .filter(Boolean)
    .join("\n");

  return { system, prompt };
}

export interface BlogPlanInput {
  business: Business;
  topic: string;
  title: string;
  config?: BlogAutomationConfig;
  calendar?: { goal: string; summary: string; cta: string };
}

/** Stage 2: the outline for the whole post (one call, quality tier). */
export function buildBlogOutlinePrompt({ business, topic, title, config, calendar }: BlogPlanInput) {
  const platform = config?.platform ?? "naver";
  const system = buildSystem(business, platform, config, calendar);
  const prompt = [
    "AUTOBIZ_BLOG_OUTLINE_V1",
    `Plan one marketing blog post about "${topic}" (working title: "${title}").`,
    `Length target: about ${BLOG_LENGTH.targetTotal} Korean characters without spaces in total, as an intro, 5-7 sub-headed sections and a closing.`,
    ...promotionGuidance(resolvePromotionType(business), "blog").slice(3),
    "Choose one angle that a real reader searching this topic would want answered, and build the sections so each one gives a reason to keep reading and a reason to choose what is promoted.",
    "State the searcher's intent in searchIntent and make the post answer exactly that, early.",
    "Every section's points must come from the FACTS; where facts are thin, plan sections about the reader's situation, how to choose, what to look for, or how the business works — never invented specifics.",
    "Distribute photo spots (what the owner's own photo should show) across at least 4 sections, one quote section and one callout section, and a list where it helps.",
    "The final title: main keyword near the front, 15-35 characters, specific and honest.",
    "Return JSON with exactly these fields:",
    '{ "title": "final title", "reader": "who this is for and what they want", "angle": "the one angle of this post", "searchIntent": "what the searcher wants to get done", "hookIdea": "how the first two sentences hook the reader", "sections": [{ "heading": "🥐 sub-heading starting with one emoji", "purpose": "what this section does for the reader", "points": ["fact-based point"], "photo": "what the photo here shows or null", "extra": "quote|callout|list|none" }], "closing": { "takeaway": "one-line takeaway", "cta": "one soft, specific call to action" } }',
  ].join("\n");
  return { system, prompt };
}

export type BlogSectionKind = "intro" | "body" | "closing";

export interface BlogSectionPromptInput extends BlogPlanInput {
  outline: BlogOutline;
  kind: BlogSectionKind;
  /** Index into outline.sections for a body section. */
  bodyIndex?: number;
  /** Sections already written, in order (used to keep flow and avoid repeating). */
  written: BlogSection[];
  /** Problems found in a previous version of this section — fix every one. */
  fixes?: string[];
  /** The previous version of this section (when rewriting). */
  previous?: BlogSection;
}

function summarize(sections: BlogSection[]): string {
  return sections
    .map((section) => {
      const text = section.blocks.map((block) => ("text" in block ? block.text : block.type === "list" ? block.items.join(" / ") : "")).filter(Boolean).join(" ");
      return `- ${section.heading ?? "(intro)"}: ${text.slice(0, 120)}…`;
    })
    .join("\n");
}

/** Stage 3: write one section (intro, one body section, or the closing). */
export function buildBlogSectionPrompt(input: BlogSectionPromptInput) {
  const { business, config, calendar, outline, kind, bodyIndex = 0, written, fixes = [], previous } = input;
  const platform = config?.platform ?? "naver";
  const system = buildSystem(business, platform, config, calendar);
  const section = kind === "body" ? outline.sections[bodyIndex] : undefined;

  const task =
    kind === "intro"
      ? [
        "Write the INTRO (no heading): 2-3 short paragraphs, about 250-400 characters without spaces.",
        `Hook idea: ${outline.hookIdea}. Put the main keyword in the first 100 characters. Say who this is for and what they will get, in a friendly way.`,
        "End the intro with a one-line quote block that sums up the promise.",
      ].join(" ")
      : kind === "closing"
        ? [
          "Write the CLOSING (no heading): 2 short paragraphs, about 200-320 characters without spaces: the takeaway, then one soft, specific call to action.",
          `Takeaway: ${outline.closing.takeaway}. CTA: ${outline.closing.cta}.`,
          "Do not repeat the business information box (the app adds it) and do not write hashtags (the app adds them).",
        ].join(" ")
        : [
          `Write the section "${section?.heading}": 2-3 paragraphs, about 330-480 characters without spaces in total.`,
          `Purpose: ${section?.purpose}. Cover these points in your own words, using only the facts: ${section?.points.join(" / ")}.`,
          section?.photo ? `Include one photo block where it fits best: slot = "${section.photo}", plus a short caption.` : "Include no photo block.",
          section?.extra === "quote" ? "Include one quote block (one memorable line)." : section?.extra === "callout" ? 'Include one callout block with a label like "💡 꿀팁" or "📌 포인트".' : section?.extra === "list" ? "Include one list block (check or bullet style, 3-5 short items)." : "",
        ].filter(Boolean).join(" ");

  const prompt = [
    "AUTOBIZ_BLOG_SECTION_V1",
    `KIND=${kind}${kind === "body" ? ` INDEX=${bodyIndex}` : ""}`,
    `Post title: ${outline.title}`,
    `Reader: ${outline.reader}. Angle: ${outline.angle}.`,
    `Outline headings: ${outline.sections.map((item) => item.heading).join(" | ")}`,
    written.length > 0 ? `Already written (do not repeat these ideas or openings; continue naturally from the last one):\n${summarize(written)}` : null,
    task,
    previous
      ? `The previous version of this section (rewrite it, keeping what works):\n${JSON.stringify(previous.blocks)}`
      : null,
    fixes.length ? `It had these problems. Fix every one:\n${fixes.map((fix) => `- ${fix}`).join("\n")}` : null,
    'Block types: {"type":"paragraph","text":"…"}, {"type":"quote","text":"…"}, {"type":"list","style":"check|bullet|number","items":["…","…"]}, {"type":"callout","label":"💡 꿀팁","text":"…"}, {"type":"photo","slot":"what the photo shows","caption":"short caption"}. Write inline **bold** and ==highlight== inside the text values.',
    'Return JSON with exactly this shape: { "blocks": [ … ] }',
  ].filter(Boolean).join("\n");

  return { system, prompt };
}
