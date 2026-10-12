import "server-only";
import { generateStructured } from "@/server/ai/generate";
import { isNearDuplicateTopic } from "@/server/ai/similarity";
import {
  blogDraftSchema,
  blogFixSchema,
  blogPlanSchema,
  blogReviewSchema,
  buildBlogDraftPrompt,
  buildBlogFacts,
  buildBlogFixPrompt,
  buildBlogPlanPrompt,
  buildBlogReviewPrompt,
  type BlogPlan,
  type BlogProblemSection,
} from "@/server/ai/prompts/blog";
import { assessBlogPost, assignIssues } from "@/server/ai/blog-quality";
import { postToMarkup } from "@/server/blog/markup";
import { blogGuideContext } from "@/server/blog/guide-context";
import { generatePublishingGuide } from "@/server/blog/publishing-guide-generate";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/logger";
import { summarizeRunSpend } from "@/server/budget";
import { parseShortsSettings } from "@/types/shorts-reference";
import { blogSectionSchema, countCharsNoSpaces, postBodyText, stripInlineMarkup, type BlogBlock, type BlogPost, type BlogSection } from "@/server/blog/post";
import { renderBlogHtml } from "@/server/blog/render";
import { promotionFieldValue } from "@/lib/promotion";
import { resolvePromotionType } from "@/server/promotion/strategy";
import { blogSetupSchema, type BlogAutomationConfig } from "@/types/blog-automation";
import { z } from "zod";
import type { AutomationHandler, AutomationHandlerOutcome, AutomationHandlerResult, AutomationRunContext } from "@/types/automation";
import type { Json } from "@/types/domain";

/**
 * Blog posts are made by three models, each doing what it is best at, and every call is metered against the blog budget:
 *
 *   PLAN   Opus 5.5    topic, search intent, keywords, outline, photo spots          (run)
 *   DRAFT  Fable 5.1   the whole Korean post in one call; then the quality gate     (resume)
 *   FIX    Fable 5.1   only the sections that failed the gate, once                 (resume, if needed)
 *   REVIEW Sonnet 5.5  fact check against the owner's facts                         (resume)
 *   FACT   Fable 5.1   only the sections with a concrete unsupported claim, once    (resume, if needed)
 *   GUIDE  Sonnet 5.5  style, photo notes and SEO for publishing                    (resume)
 *
 * One model call per step, so a step fits one request however long the model thinks; the run is deferred between
 * steps (see runner.ts). Every step after DRAFT is allowed to fail without failing the post.
 */
const MAX_JOB_MINUTES = 40;
/** At most this many sections are rewritten by one targeted fix: the ones with the most problems. */
const MAX_FIX_SECTIONS = 4;

const stageSchema = z.enum(["DRAFT", "FIX", "REVIEW", "FACT_FIX", "GUIDE"]);

const jobStateSchema = z.object({
  v: z.literal(2),
  stage: stageSchema,
  topic: z.string(),
  plan: blogPlanSchema,
  title: z.string(),
  /** Intro, then each body section, then the closing — in order, as far as written. */
  sections: z.array(blogSectionSchema),
  /** Section index -> problems the next targeted fix must resolve. */
  fixes: z.record(z.string(), z.array(z.string())).default({}),
  /** Notes for the owner collected along the way (shown as "확인해 보세요"). */
  notes: z.array(z.string()).default([]),
  factCheck: z.object({ ran: z.boolean(), flagged: z.number().int().min(0), fixed: z.boolean() }).default({ ran: false, flagged: 0, fixed: false }),
  aiCalls: z.number().int().min(0),
  startedAt: z.string(),
});
type JobState = z.infer<typeof jobStateSchema>;

const PROGRESS: Record<JobState["stage"], string> = {
  DRAFT: "글 구성을 마쳤어요. 글을 쓰는 중이에요 (2/5)",
  FIX: "글을 다듬는 중이에요 (3/5)",
  REVIEW: "내용이 사실과 맞는지 확인하는 중이에요 (4/5)",
  FACT_FIX: "사실과 다른 부분을 고치는 중이에요 (4/5)",
  GUIDE: "게시용 스타일과 검색 정보를 만드는 중이에요 (5/5)",
};

function deferred(state: JobState): AutomationHandlerOutcome {
  return { deferred: { state: state as unknown as Json, progress: PROGRESS[state.stage] } };
}

/** The writer returns blocks only; info boxes and dividers are the app's, so anything of the kind is dropped. */
function cleanBlocks(blocks: BlogBlock[]): BlogBlock[] {
  return blocks.filter((block) => block.type !== "info" && block.type !== "divider");
}

function planInput(ctx: AutomationRunContext, config: BlogAutomationConfig | undefined) {
  return {
    business: ctx.business,
    config,
    calendar: ctx.calendarItem ? { goal: ctx.calendarItem.goal, summary: ctx.calendarItem.summary, cta: ctx.calendarItem.cta } : undefined,
  };
}

/** The facts box at the end of the post — built from what the owner entered for this type, never written by the AI. */
function infoSection(ctx: AutomationRunContext): BlogSection | null {
  const { business } = ctx;
  const type = resolvePromotionType(business);
  const value = (key: Parameters<typeof promotionFieldValue>[1]) => promotionFieldValue(business, key);
  const candidates: Array<{ label: string; value: string | null }> =
    type === "PRODUCT"
      ? [
        { label: "🛍️ 상품", value: value("name") },
        { label: "✨ 주요 특징", value: value("mainOffering") },
        { label: "💰 가격", value: value("priceInfo") },
        { label: "🔗 구매하기", value: value("actionUrl") },
      ]
      : type === "PLATFORM"
        ? [
          { label: "💻 서비스", value: value("name") },
          { label: "✨ 주요 기능", value: value("mainOffering") },
          { label: "🌐 홈페이지", value: value("website") },
          { label: "🚀 시작하기", value: value("actionUrl") },
        ]
        : [
          { label: "📍 위치", value: value("location") },
          { label: "🛍️ 대표 메뉴·서비스", value: value("mainOffering") },
          { label: "💰 가격·프로모션", value: value("priceInfo") },
          { label: "🔗 웹사이트", value: value("website") },
        ];
  const rows = candidates.filter((row): row is { label: string; value: string } => Boolean(row.value));
  if (rows.length === 0) return null;
  const heading = type === "PRODUCT" ? `📌 ${business.name} 정보` : type === "PLATFORM" ? `📌 ${business.name} 시작하기` : `📌 ${business.name} 정보`;
  return { heading, blocks: [{ type: "info", rows }] };
}

function hashtagsFor(ctx: AutomationRunContext, config: BlogAutomationConfig | undefined, plan: BlogPlan): string[] {
  // A place name only helps a store's local search; products and platforms are not found by neighbourhood.
  const location = resolvePromotionType(ctx.business) === "STORE" ? ctx.business.location?.split(/[\s,]+/).find((part) => part.length >= 2) : undefined;
  const raw = [
    ...(config?.keywords ?? []),
    ...ctx.business.keywords,
    ctx.business.name,
    ctx.business.industry ?? "",
    ...(location ? [location, ...(config?.keywords ?? []).slice(0, 3).map((keyword) => `${location}${keyword}`)] : []),
    ...plan.keywords.secondary,
    ...plan.sections.slice(0, 2).map((section) => section.heading.replace(/^\p{Extended_Pictographic}\s*/u, "")),
  ];
  const tags: string[] = [];
  for (const item of raw) {
    const tag = item.replace(/[\s#]+/g, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (tag.length >= 2 && tag.length <= 24 && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= 12) break;
  }
  return tags;
}

function assemble(ctx: AutomationRunContext, config: BlogAutomationConfig | undefined, state: JobState, withExtras: boolean): BlogPost {
  const sections = [...state.sections];
  if (withExtras) {
    const info = infoSection(ctx);
    if (info) sections.push(info);
  }
  return { title: state.title, sections, hashtags: withExtras ? hashtagsFor(ctx, config, state.plan) : [] };
}

function qualityKeywords(ctx: AutomationRunContext, config: BlogAutomationConfig | undefined): string[] {
  return [...(config?.keywords ?? []), ...ctx.business.keywords];
}

/** Names (never files) of images the owner already uploaded for this business, so the guide can point at them. */
async function ownedImagesFor(ctx: AutomationRunContext): Promise<Array<{ label: string; subject: string }>> {
  try {
    const { data } = await createAdminClient()
      .from("automations")
      .select("config")
      .eq("user_id", ctx.automation.user_id)
      .eq("business_id", ctx.business.id)
      .limit(20);
    return (data ?? [])
      .flatMap((row) => parseShortsSettings(row.config).assets)
      .filter((asset) => asset.kind === "image" && asset.origin === "upload" && asset.label)
      .slice(0, 10)
      .map((asset) => ({ label: asset.label, subject: asset.role ?? "other" }));
  } catch {
    return [];
  }
}


function factsOf(ctx: AutomationRunContext, config: BlogAutomationConfig | undefined) {
  return buildBlogFacts(ctx.business, config, planInput(ctx, config).calendar);
}

/** The deterministic quality gate on the post as written so far: problems per section index. */
function gate(ctx: AutomationRunContext, config: BlogAutomationConfig | undefined, state: JobState): { remaining: string[]; fixes: Record<string, string[]> } {
  const post = assemble(ctx, config, state, false);
  const issues = assessBlogPost({ post, keywords: qualityKeywords(ctx, config), facts: factsOf(ctx, config).text, promotionType: resolvePromotionType(ctx.business) });
  const assigned = assignIssues(post, issues);
  // The sections with the most problems are rewritten; the rest of the issues stay as notes.
  const chosen = [...assigned.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, MAX_FIX_SECTIONS);
  return {
    remaining: issues.map((issue) => issue.message),
    fixes: Object.fromEntries(chosen.map(([index, messages]) => [String(index), [...new Set(messages)]])),
  };
}

/** One Fable call that rewrites only the given sections. A failure keeps the sections as they are: a good-enough post beats a failed run. */
async function applyTargetedFix(ctx: AutomationRunContext, config: BlogAutomationConfig | undefined, state: JobState, fixes: Record<string, string[]>, purpose: string): Promise<boolean> {
  const targets = Object.entries(fixes)
    .map(([key, problems]): { index: number; section: BlogSection | undefined; problems: string[] } => ({ index: Number(key), section: state.sections[Number(key)], problems }))
    .filter((target): target is BlogProblemSection => Boolean(target.section) && target.problems.length > 0);
  if (targets.length === 0) return false;
  state.aiCalls += 1;
  try {
    const output = await generateStructured({
      ...buildBlogFixPrompt({ ...planInput(ctx, config), plan: state.plan, post: state.sections, targets }),
      schema: blogFixSchema,
      maxTokens: 12_000,
      role: "writer",
      purpose,
    });
    let changed = false;
    for (const rewritten of output.sections) {
      const target = targets.find((item) => item.index === rewritten.index);
      if (!target) continue;
      const blocks = cleanBlocks(rewritten.blocks);
      if (blocks.length === 0) continue;
      // The heading belongs to the plan: a rewrite changes the writing under it, not the outline.
      state.sections[target.index] = { heading: target.section.heading, blocks };
      changed = true;
    }
    return changed;
  } catch (error) {
    logger.warn("blog_targeted_fix_failed", { runId: ctx.runId, purpose, message: error instanceof Error ? error.message : String(error) });
    state.notes.push("일부 문장을 자동으로 다듬지 못했어요. 아래 안내를 보고 직접 확인해 주세요.");
    return false;
  }
}

async function finish(ctx: AutomationRunContext, config: BlogAutomationConfig | undefined, state: JobState): Promise<AutomationHandlerResult> {
  const post = assemble(ctx, config, state, true);
  const bodyHtml = renderBlogHtml(post, "generic");
  const text = postBodyText(post);
  const firstParagraph = state.sections[0]?.blocks.find((block) => block.type === "paragraph");
  const excerpt = stripInlineMarkup(firstParagraph && "text" in firstParagraph ? firstParagraph.text : text).replace(/\s+/g, " ").slice(0, 140);
  const photoSlots = post.sections.flatMap((section) => section.blocks).filter((block) => block.type === "photo").map((block) => ("slot" in block ? block.slot : ""));
  const facts = factsOf(ctx, config);
  const remaining = assessBlogPost({ post, keywords: qualityKeywords(ctx, config), facts: facts.text, promotionType: resolvePromotionType(ctx.business) }).map((issue) => issue.message);
  const notes = [...new Set([...state.notes, ...remaining])];
  const markup = postToMarkup(post);
  // Style, photo notes and SEO come from the reviewer model in the same run; they never fail the post.
  const { guide, aiCalls: guideCalls } = await generatePublishingGuide({
    post,
    context: blogGuideContext(ctx.business, config, await ownedImagesFor(ctx)),
    facts: facts.lines,
    searchIntentHint: state.plan.searchIntent,
  });
  const generation = await generationRecord(ctx.runId);

  return {
    output: {
      title: post.title,
      topic: state.topic,
      platform: config?.platform ?? "naver",
      promotionType: resolvePromotionType(ctx.business),
      markup,
      bodyHtml,
      excerpt,
      hook: excerpt,
      keywords: [...new Set([state.plan.keywords.primary, ...qualityKeywords(ctx, config)])].slice(0, 8),
      seoKeywords: post.hashtags.slice(0, 8),
      publishingGuide: guide,
      callToAction: state.plan.closing.cta,
      imageSuggestion: photoSlots.join(" / "),
      stats: { chars: countCharsNoSpaces(text), sections: post.sections.length, photos: photoSlots.length },
      factCheck: state.factCheck,
      ...(notes.length > 0 ? { qualityNotes: notes.slice(0, 8) } : {}),
      ...(generation ? { generation } : {}),
    } as unknown as Json,
    title: post.title,
    topic: state.topic,
    content: markup,
    contentType: "blog-marketing",
    aiGenerationCount: Math.max(1, state.aiCalls + guideCalls),
  };
}

/** What each model call of this run cost (from the spend ledger). Absent when nothing was metered (mock provider). */
async function generationRecord(runId: string): Promise<Json | null> {
  try {
    const spend = await summarizeRunSpend(runId);
    if (spend.steps.length === 0) return null;
    return { pipeline: "blog-v2", costUsd: spend.totalUsd, steps: spend.steps } as unknown as Json;
  } catch {
    return null;
  }
}

export const blogAutomationHandler: AutomationHandler = {
  templateSlug: "blog-marketing",

  /** The paid pipeline draws on the blog budget. The mock provider costs nothing and is not metered. */
  metered: () => (serverEnv.AI_PROVIDER === "mock" ? null : "BLOG"),

  preflight: () =>
    serverEnv.AI_PROVIDER === "mock" || serverEnv.AI_PROVIDER === "anthropic"
      ? null
      : "블로그 글 만들기는 Claude(Anthropic) 설정이 필요해요. 관리자에게 문의해주세요.",

  async run(ctx: AutomationRunContext): Promise<AutomationHandlerOutcome> {
    const parsed = blogSetupSchema.safeParse(ctx.config);
    const config = parsed.success ? (ctx.config as unknown as BlogAutomationConfig) : undefined;

    let aiCalls = 1;
    const request = (rejectedTopic?: string) => ({
      ...buildBlogPlanPrompt({ ...planInput(ctx, config), recentTopics: ctx.recentTopics, rejectedTopic, fixedTopic: ctx.calendarItem?.topic }),
      schema: blogPlanSchema,
      maxTokens: 8_000,
      role: "planner" as const,
      purpose: rejectedTopic ? "blog.plan.retry" : "blog.plan",
    });
    let plan: BlogPlan = await generateStructured(request());
    // A topic too close to a recent post is planned again, once; the calendar's own topic is never replaced.
    if (!ctx.calendarItem && isNearDuplicateTopic(plan.topic, ctx.recentTopics)) {
      plan = await generateStructured(request(plan.topic));
      aiCalls += 1;
    }
    const topic = ctx.calendarItem ? ctx.calendarItem.topic : plan.topic;
    const state: JobState = { v: 2, stage: "DRAFT", topic, plan, title: plan.title, sections: [], fixes: {}, notes: [], factCheck: { ran: false, flagged: 0, fixed: false }, aiCalls, startedAt: new Date().toISOString() };
    return deferred(state);
  },

  async resume(ctx: AutomationRunContext, raw: Json): Promise<AutomationHandlerOutcome> {
    const parsedConfig = blogSetupSchema.safeParse(ctx.config);
    const config = parsedConfig.success ? (ctx.config as unknown as BlogAutomationConfig) : undefined;
    const parsed = jobStateSchema.safeParse(raw);
    if (!parsed.success) throw new Error("진행 중인 블로그 작업 정보를 읽지 못했어요. 다시 만들어주세요.");
    const state: JobState = { ...parsed.data, sections: [...parsed.data.sections], fixes: { ...parsed.data.fixes }, notes: [...parsed.data.notes] };
    if (Date.now() - Date.parse(state.startedAt) > MAX_JOB_MINUTES * 60_000) {
      throw new Error("글 쓰기가 너무 오래 걸려 중단했어요. 잠시 후 다시 시도해주세요.");
    }

    switch (state.stage) {
      case "DRAFT": {
        // The only step whose failure fails the run: without a draft there is no post.
        const draft = await generateStructured({
          ...buildBlogDraftPrompt({ ...planInput(ctx, config), plan: state.plan }),
          schema: blogDraftSchema,
          maxTokens: 16_000,
          role: "writer",
          purpose: "blog.draft",
        });
        state.aiCalls += 1;
        state.title = draft.title;
        state.sections = draft.sections.map((section) => ({ heading: section.heading, blocks: cleanBlocks(section.blocks) })).filter((section) => section.blocks.length > 0);
        if (state.sections.length < 7) throw new Error("AI가 글을 끝까지 쓰지 못했어요. 다시 시도해주세요.");
        const checked = gate(ctx, config, state);
        state.fixes = checked.fixes;
        state.stage = Object.keys(checked.fixes).length > 0 ? "FIX" : "REVIEW";
        return deferred(state);
      }

      case "FIX": {
        await applyTargetedFix(ctx, config, state, state.fixes, "blog.fix");
        state.fixes = {};
        state.stage = "REVIEW";
        return deferred(state);
      }

      case "REVIEW": {
        try {
          const review = await generateStructured({
            ...buildBlogReviewPrompt({ plan: state.plan, post: assemble(ctx, config, state, false), facts: factsOf(ctx, config).text }),
            schema: blogReviewSchema,
            maxTokens: 8_000,
            role: "reviewer",
            effort: "medium",
            purpose: "blog.review",
          });
          state.aiCalls += 1;
          state.factCheck = { ran: true, flagged: review.unsupported.length, fixed: false };
          const high = review.unsupported.filter((item) => item.severity === "high" && item.section < state.sections.length);
          for (const item of review.unsupported.filter((entry) => entry.severity === "low")) {
            state.notes.push(`사실 확인이 필요해요: ${item.quote ? `“${item.quote}” — ` : ""}${item.reason}`);
          }
          if (review.seo?.titleNote) state.notes.push(review.seo.titleNote);
          if (review.seo?.keywordNote) state.notes.push(review.seo.keywordNote);
          if (high.length > 0) {
            state.fixes = {};
            for (const item of high) {
              const key = String(item.section);
              state.fixes[key] = [...(state.fixes[key] ?? []), `제공된 사실에 없는 내용을 빼 주세요${item.quote ? `: “${item.quote}”` : ""} (${item.reason}). 사실로 확인되는 표현으로 바꾸거나 그 문장을 지워 주세요.`];
            }
            state.stage = "FACT_FIX";
            return deferred(state);
          }
        } catch (error) {
          logger.warn("blog_fact_check_failed", { runId: ctx.runId, message: error instanceof Error ? error.message : String(error) });
          state.notes.push("AI 사실 검수를 하지 못했어요. 가격·시간·수치가 맞는지 직접 확인해 주세요.");
        }
        state.stage = "GUIDE";
        return deferred(state);
      }

      case "FACT_FIX": {
        state.factCheck.fixed = await applyTargetedFix(ctx, config, state, state.fixes, "blog.factfix");
        if (!state.factCheck.fixed) state.notes.push("사실 확인이 필요한 문장이 남아 있어요. 가격·시간·수치가 맞는지 직접 확인해 주세요.");
        state.fixes = {};
        state.stage = "GUIDE";
        return deferred(state);
      }

      case "GUIDE":
        return finish(ctx, config, state);
    }
  },
};
