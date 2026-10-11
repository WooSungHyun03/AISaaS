import "server-only";
import { generateStructured } from "@/server/ai/generate";
import { isNearDuplicateTopic } from "@/server/ai/similarity";
import {
  blogOutlineSchema,
  blogSectionOutputSchema,
  blogTopicSchema,
  buildBlogFacts,
  buildBlogOutlinePrompt,
  buildBlogSectionPrompt,
  buildBlogTopicPrompt,
  type BlogOutline,
  type BlogTopic,
} from "@/server/ai/prompts/blog";
import { WordPressConnector } from "@/server/connectors/wordpress";
import { decryptWordPressPassword } from "@/server/connectors/wordpress/credentials";
import { loadWordPressConnector } from "@/server/connectors/wordpress/connect";
import { getConnection, updateConnectionStatus } from "@/server/connectors/integrations";
import { createAdminClient } from "@/lib/supabase/admin";
import { isConnectorError } from "@/server/shared/errors";
import { assessBlogPost, assignIssues } from "@/server/ai/blog-quality";
import { postToMarkup } from "@/server/blog/markup";
import { blogSectionSchema, countCharsNoSpaces, postBodyText, stripInlineMarkup, type BlogBlock, type BlogPost, type BlogSection } from "@/server/blog/post";
import { renderBlogHtml } from "@/server/blog/render";
import { blogSetupSchema, type BlogAutomationConfig } from "@/types/blog-automation";
import { z } from "zod";
import type { AutomationHandler, AutomationHandlerOutcome, AutomationHandlerResult, AutomationRunContext } from "@/types/automation";
import type { Json } from "@/types/domain";

/**
 * Stage 1 of the pipeline: pick a topic, reject it once if it's a
 * near-duplicate of a recent one, then accept whatever comes back from the
 * single regeneration attempt (bounded — never a loop).
 */
async function generateTopic(ctx: AutomationRunContext, config?: BlogAutomationConfig): Promise<BlogTopic> {
  if (ctx.calendarItem) {
    const base = buildBlogTopicPrompt(ctx.business, ctx.recentTopics, config);
    const planned = await generateStructured({
      system: [
        base.system,
        `This calendar item's fixed marketing goal: ${ctx.calendarItem.goal}`,
        `This calendar item's content brief: ${ctx.calendarItem.summary}`,
        `Preferred closing CTA: ${ctx.calendarItem.cta}`,
      ].join("\n"),
      prompt: [
        `Use exactly this planned topic without replacing it: "${ctx.calendarItem.topic}".`,
        "Create one compelling Korean blog title for it.",
        'Return JSON with exactly these fields: { "topic": "the exact supplied topic", "title": "catchy blog title" }',
      ].join("\n"),
      schema: blogTopicSchema,
      maxTokens: 200,
    });
    return { topic: ctx.calendarItem.topic, title: planned.title };
  }

  const first = await generateStructured({
    ...buildBlogTopicPrompt(ctx.business, ctx.recentTopics, config),
    schema: blogTopicSchema,
    maxTokens: 200,
  });
  if (!isNearDuplicateTopic(first.topic, ctx.recentTopics)) return first;

  return generateStructured({
    ...buildBlogTopicPrompt(ctx.business, ctx.recentTopics, config, first.topic),
    schema: blogTopicSchema,
    maxTokens: 200,
  });
}

/** Each step of a deferred blog run writes sections until about this much time has passed. */
const STEP_BUDGET_MS = 40_000;
const MAX_JOB_MINUTES = 25;

const jobStateSchema = z.object({
  v: z.literal(1),
  stage: z.enum(["WRITING", "FIXING"]),
  topic: z.string(),
  outline: blogOutlineSchema,
  /** Intro, then each body section, then the closing — in order, as far as written. */
  sections: z.array(blogSectionSchema),
  /** FIXING: section index -> problems to fix (each key is rewritten once). */
  fixes: z.record(z.string(), z.array(z.string())).default({}),
  aiCalls: z.number().int().min(0),
  startedAt: z.string(),
});
type JobState = z.infer<typeof jobStateSchema>;

function deferred(state: JobState, progress: string): AutomationHandlerOutcome {
  return { deferred: { state: state as unknown as Json, progress } };
}

const totalSections = (outline: BlogOutline) => outline.sections.length + 2;

function sectionKind(index: number, outline: BlogOutline): { kind: "intro" | "body" | "closing"; bodyIndex: number } {
  if (index === 0) return { kind: "intro", bodyIndex: 0 };
  if (index === totalSections(outline) - 1) return { kind: "closing", bodyIndex: 0 };
  return { kind: "body", bodyIndex: index - 1 };
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

async function writeSection(
  ctx: AutomationRunContext,
  config: BlogAutomationConfig | undefined,
  state: JobState,
  index: number,
  options: { fixes?: string[]; previous?: BlogSection } = {},
): Promise<BlogSection> {
  const { kind, bodyIndex } = sectionKind(index, state.outline);
  const prompt = buildBlogSectionPrompt({
    ...planInput(ctx, config),
    topic: state.topic,
    title: state.outline.title,
    outline: state.outline,
    kind,
    bodyIndex,
    written: state.sections.filter((_, position) => position < index),
    fixes: options.fixes,
    previous: options.previous,
  });
  const output = await generateStructured({ ...prompt, schema: blogSectionOutputSchema, maxTokens: 1_800, tier: "quality" });
  const blocks = cleanBlocks(output.blocks);
  if (blocks.length === 0) throw new Error("AI가 이 부분의 내용을 만들지 못했어요.");
  return { heading: kind === "body" ? state.outline.sections[bodyIndex].heading : undefined, blocks };
}

/** Business facts as the box at the end of the post — built from the profile, never written by the AI. */
function infoSection(ctx: AutomationRunContext): BlogSection | null {
  const { business } = ctx;
  const rows = [
    business.location ? { label: "📍 위치", value: business.location } : null,
    business.main_offering ? { label: "🛍️ 대표 메뉴·서비스", value: business.main_offering } : null,
    business.website ? { label: "🔗 웹사이트", value: business.website } : null,
  ].filter((row): row is { label: string; value: string } => Boolean(row));
  if (rows.length === 0) return null;
  return { heading: `📌 ${business.name} 정보`, blocks: [{ type: "info", rows }] };
}

function hashtagsFor(ctx: AutomationRunContext, config: BlogAutomationConfig | undefined, outline: BlogOutline): string[] {
  const location = ctx.business.location?.split(/[\s,]+/).find((part) => part.length >= 2);
  const raw = [
    ...(config?.keywords ?? []),
    ...ctx.business.keywords,
    ctx.business.name,
    ctx.business.industry ?? "",
    ...(location ? [location, ...(config?.keywords ?? []).slice(0, 3).map((keyword) => `${location}${keyword}`)] : []),
    ...outline.sections.slice(0, 2).map((section) => section.heading.replace(/^\p{Extended_Pictographic}\s*/u, "")),
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
  return { title: state.outline.title, sections, hashtags: withExtras ? hashtagsFor(ctx, config, state.outline) : [] };
}

function qualityKeywords(ctx: AutomationRunContext, config: BlogAutomationConfig | undefined): string[] {
  return [...(config?.keywords ?? []), ...ctx.business.keywords];
}

async function deliver(ctx: AutomationRunContext, config: BlogAutomationConfig | undefined, post: BlogPost, bodyHtml: string, excerpt: string) {
  let externalUrl: string | undefined;
  let wordpressStatus: "draft" | "publish" | undefined;

  if (config?.deliveryMode === "wordpress_draft" || config?.deliveryMode === "wordpress_publish") {
    const admin = createAdminClient();
    const sharedConnection = await getConnection(admin, ctx.automation.user_id, ctx.business.id, "wordpress");
    const connector = sharedConnection
      ? await loadWordPressConnector(admin, ctx.automation.user_id, ctx.business.id)
      : config.wordpress
        ? new WordPressConnector({
          siteUrl: config.wordpress.siteUrl,
          username: config.wordpress.username,
          appPassword: decryptWordPressPassword(config.wordpress.encryptedAppPassword),
        })
        : null;
    if (!connector) {
      if (sharedConnection?.status === "CONNECTED") await updateConnectionStatus(admin, sharedConnection.id, "ERROR");
      throw new Error("WordPress 연결이 해제되었거나 만료되었습니다. 설정에서 다시 연결해주세요.");
    }
    wordpressStatus = config.deliveryMode === "wordpress_draft" ? "draft" : "publish";
    try {
      const saved = await connector.publish({ title: post.title, content: bodyHtml, excerpt }, wordpressStatus);
      externalUrl = saved.externalUrl;
    } catch (error) {
      if (sharedConnection) {
        const status = isConnectorError(error) && (error.code === "AUTH_FAILED" || error.code === "PERMISSION_DENIED") ? "EXPIRED" : "ERROR";
        await updateConnectionStatus(admin, sharedConnection.id, status);
      }
      throw error;
    }
  } else if (!config) {
    // Existing automations created before the setup wizard use the legacy server connection.
    const connector = new WordPressConnector();
    if (connector.isConfigured()) {
      const saved = await connector.publish({ title: post.title, content: bodyHtml, excerpt });
      externalUrl = saved.externalUrl;
      wordpressStatus = "publish";
    }
  }
  return { externalUrl, wordpressStatus };
}

async function finish(ctx: AutomationRunContext, config: BlogAutomationConfig | undefined, state: JobState): Promise<AutomationHandlerResult> {
  const post = assemble(ctx, config, state, true);
  const bodyHtml = renderBlogHtml(post, "generic");
  const text = postBodyText(post);
  const firstParagraph = state.sections[0]?.blocks.find((block) => block.type === "paragraph");
  const excerpt = stripInlineMarkup(firstParagraph && "text" in firstParagraph ? firstParagraph.text : text).replace(/\s+/g, " ").slice(0, 140);
  const photoSlots = post.sections.flatMap((section) => section.blocks).filter((block) => block.type === "photo").map((block) => ("slot" in block ? block.slot : ""));
  const remaining = assessBlogPost({ post, keywords: qualityKeywords(ctx, config), facts: buildBlogFacts(ctx.business, config).text }).map((issue) => issue.message);
  const delivery = await deliver(ctx, config, post, bodyHtml, excerpt);
  const markup = postToMarkup(post);

  return {
    output: {
      title: post.title,
      topic: state.topic,
      platform: config?.platform ?? "naver",
      markup,
      bodyHtml,
      excerpt,
      hook: excerpt,
      keywords: qualityKeywords(ctx, config).slice(0, 8),
      seoKeywords: post.hashtags.slice(0, 8),
      callToAction: state.outline.closing.cta,
      imageSuggestion: photoSlots.join(" / "),
      stats: { chars: countCharsNoSpaces(text), sections: post.sections.length, photos: photoSlots.length },
      ...(remaining.length > 0 ? { qualityNotes: remaining.slice(0, 6) } : {}),
      published: delivery.wordpressStatus === "publish",
      wordpressStatus: delivery.wordpressStatus ?? null,
      externalUrl: delivery.externalUrl ?? null,
    } as unknown as Json,
    title: post.title,
    topic: state.topic,
    content: markup,
    contentType: "blog-marketing",
    externalUrl: delivery.externalUrl,
    aiGenerationCount: Math.max(1, state.aiCalls),
  };
}

/**
 * Blog posts are written the way a good writer works: plan the whole post,
 * write it section by section (so every part gets full attention and the
 * length is under control), check it against concrete rules, and rewrite only
 * the sections that fail. Several AI calls take more than one request, so the
 * run is deferred and advanced in short steps (see runner.ts).
 */
export const blogAutomationHandler: AutomationHandler = {
  templateSlug: "blog-marketing",

  async run(ctx: AutomationRunContext): Promise<AutomationHandlerOutcome> {
    const parsed = blogSetupSchema.safeParse(ctx.config);
    const config = parsed.success ? (ctx.config as unknown as BlogAutomationConfig) : undefined;

    const topic = await generateTopic(ctx, config);
    const outline = await generateStructured({
      ...buildBlogOutlinePrompt({ ...planInput(ctx, config), topic: topic.topic, title: topic.title }),
      schema: blogOutlineSchema,
      maxTokens: 2_200,
      tier: "quality",
    });
    const state: JobState = { v: 1, stage: "WRITING", topic: topic.topic, outline, sections: [], fixes: {}, aiCalls: 2, startedAt: new Date().toISOString() };
    return deferred(state, `글 구성을 마쳤어요. 쓰는 중이에요 (0/${totalSections(outline)})`);
  },

  async resume(ctx: AutomationRunContext, raw: Json): Promise<AutomationHandlerOutcome> {
    const parsedConfig = blogSetupSchema.safeParse(ctx.config);
    const config = parsedConfig.success ? (ctx.config as unknown as BlogAutomationConfig) : undefined;
    const parsed = jobStateSchema.safeParse(raw);
    if (!parsed.success) throw new Error("진행 중인 블로그 작업 정보를 읽지 못했어요. 다시 만들어주세요.");
    const state: JobState = { ...parsed.data, sections: [...parsed.data.sections], fixes: { ...parsed.data.fixes } };
    if (Date.now() - Date.parse(state.startedAt) > MAX_JOB_MINUTES * 60_000) {
      throw new Error("글 쓰기가 너무 오래 걸려 중단했어요. 잠시 후 다시 시도해주세요.");
    }
    const deadline = Date.now() + STEP_BUDGET_MS;
    const total = totalSections(state.outline);

    if (state.stage === "WRITING") {
      while (state.sections.length < total && Date.now() < deadline) {
        const index = state.sections.length;
        state.sections.push(await writeSection(ctx, config, state, index));
        state.aiCalls += 1;
      }
      if (state.sections.length < total) return deferred(state, `글을 쓰는 중이에요 (${state.sections.length}/${total})`);

      // Everything is written: check it, and queue a one-time rewrite of only the sections that fail.
      const post = assemble(ctx, config, state, false);
      const issues = assessBlogPost({ post, keywords: qualityKeywords(ctx, config), facts: buildBlogFacts(ctx.business, config).text });
      const assigned = assignIssues(post, issues);
      if (assigned.size === 0) return finish(ctx, config, state);
      // At most four sections are rewritten, the ones with the most problems.
      const chosen = [...assigned.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 4);
      state.stage = "FIXING";
      state.fixes = Object.fromEntries(chosen.map(([index, messages]) => [String(index), [...new Set(messages)]]));
      return deferred(state, "글을 다듬는 중이에요");
    }

    // FIXING: rewrite each flagged section once, then finish whatever the result looks like.
    for (const key of Object.keys(state.fixes)) {
      if (Date.now() >= deadline) break;
      const index = Number(key);
      const fixes = state.fixes[key];
      delete state.fixes[key];
      const previous = state.sections[index];
      if (!previous) continue;
      try {
        state.sections[index] = await writeSection(ctx, config, state, index, { fixes, previous });
      } catch {
        // A rewrite that fails keeps the original section: a good-enough post beats a failed run.
      }
      state.aiCalls += 1;
    }
    if (Object.keys(state.fixes).length > 0) return deferred(state, "글을 다듬는 중이에요");
    return finish(ctx, config, state);
  },
};
