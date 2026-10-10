import "server-only";
import { generateStructured } from "@/server/ai/generate";
import {
  buildShortsContentPrompt,
  buildShortsSkitPrompt,
  buildShortsTopicPrompt,
  shortsContentSchema,
  shortsSkitContentSchema,
  shortsTopicSchema,
  type ShortsContent,
  type ShortsTopic,
} from "@/server/ai/prompts/shorts";
import { isNearDuplicateTopic } from "@/server/ai/similarity";
import { createAdminClient } from "@/lib/supabase/admin";
import { publishShortsToPlatforms } from "@/server/automations/shorts-publishing";
import { renderShortVideo, type VideoRenderScene } from "@/server/connectors/video";
import { resolveReferenceImageUrls } from "@/server/shorts/reference-images";
import { describeReferenceForPrompt, parseShortsReferenceSettings, type ShortsReferenceSettings } from "@/types/shorts-reference";
import type { AutomationHandler, AutomationHandlerResult, AutomationRunContext, ShortsPublishPlatform } from "@/types/automation";
import type { Json } from "@/types/domain";

/**
 * Selects a topic before writing the full video so a near-duplicate only
 * costs one small regeneration. The second result is accepted regardless of
 * similarity, matching the bounded retry pattern used by the Blog pipeline.
 */
async function generateTopic(ctx: AutomationRunContext, direction?: string): Promise<ShortsTopic> {
  // A calendar item already fixed the topic — never replace it with a new one.
  if (ctx.calendarItem) return { topic: ctx.calendarItem.topic.slice(0, 120) };

  const first = await generateStructured({
    ...buildShortsTopicPrompt(ctx.business, ctx.recentTopics, undefined, direction),
    schema: shortsTopicSchema,
    maxTokens: 120,
  });
  if (!isNearDuplicateTopic(first.topic, ctx.recentTopics)) return first;

  return generateStructured({
    ...buildShortsTopicPrompt(ctx.business, ctx.recentTopics, first.topic, direction),
    schema: shortsTopicSchema,
    maxTokens: 120,
  });
}

function scheduledPlatforms(config: AutomationRunContext["config"]): ShortsPublishPlatform[] {
  // Publishing is opt-in: an automation without an explicit platform list only renders a preview.
  if (!Array.isArray(config.platforms)) return [];
  const platforms = config.platforms.filter(
    (value): value is ShortsPublishPlatform => value === "instagram" || value === "youtube",
  );
  return [...new Set(platforms)];
}

async function publishExistingPreview(ctx: AutomationRunContext): Promise<AutomationHandlerResult> {
  const request = ctx.shorts?.publish;
  if (!request) throw new Error("게시할 Shorts 미리보기를 확인할 수 없습니다.");
  const admin = createAdminClient();
  const { data: sourceRun, error } = await admin
    .from("automation_runs")
    .select("output,status")
    .eq("id", request.sourceRunId)
    .eq("automation_id", ctx.automation.id)
    .maybeSingle();
  if (error || !sourceRun || sourceRun.status !== "SUCCESS") {
    throw new Error("게시할 Shorts 미리보기를 찾을 수 없습니다. 영상을 다시 만들어주세요.");
  }
  const output = sourceRun.output && typeof sourceRun.output === "object" && !Array.isArray(sourceRun.output)
    ? sourceRun.output as Record<string, unknown>
    : null;
  const content = shortsContentSchema.safeParse(output);
  const videoUrl = typeof output?.videoUrl === "string" ? output.videoUrl : "";
  const topic = typeof output?.topic === "string" ? output.topic : content.success ? content.data.hook : "";
  if (!content.success || !/^https:\/\//i.test(videoUrl)) {
    throw new Error("게시할 영상 정보가 올바르지 않습니다. 영상을 다시 만들어주세요.");
  }

  const publicationResults = await publishShortsToPlatforms({
    userId: ctx.automation.user_id,
    businessId: ctx.business.id,
    title: content.data.hook,
    caption: content.data.caption,
    videoUrl,
    platforms: request.platforms,
  });
  return {
    output: {
      operation: "PUBLISH",
      sourceRunId: request.sourceRunId,
      ...content.data,
      topic,
      videoUrl,
      publicationResults,
    } as unknown as Json,
    externalUrl: videoUrl,
    title: content.data.hook,
    topic,
    contentType: "shorts-publish",
    aiGenerationCount: 0,
  };
}

/**
 * Character mode: the owner supplied reference images, so the AI writes a
 * short skit that picks an image per line and the renderer shows that image
 * (with a simple motion) instead of a plain colour card.
 */
async function generateCharacterShort(
  ctx: AutomationRunContext,
  topic: string,
  settings: ShortsReferenceSettings,
): Promise<{ content: ShortsContent; scenes: VideoRenderScene[] }> {
  const admin = createAdminClient();
  const imageUrls = await resolveReferenceImageUrls(admin, settings.references, {
    userId: ctx.automation.user_id,
    automationId: ctx.automation.id,
  });
  const skit = await generateStructured({
    ...buildShortsSkitPrompt(ctx.business, topic, {
      references: settings.references.map(describeReferenceForPrompt),
      style: settings.style,
      brief: settings.brief || undefined,
      mascot: settings.references.some((reference) => reference.kind === "mascot"),
      calendar: ctx.calendarItem
        ? { goal: ctx.calendarItem.goal, summary: ctx.calendarItem.summary, cta: ctx.calendarItem.cta }
        : undefined,
    }),
    schema: shortsSkitContentSchema,
    maxTokens: 1_500,
  });

  const scenes: VideoRenderScene[] = skit.scenes.map((scene) => {
    // The AI numbers images from 1; an out-of-range number falls back to the first image.
    const index = scene.imageIndex >= 1 && scene.imageIndex <= imageUrls.length ? scene.imageIndex - 1 : 0;
    return {
      text: scene.text,
      visualPrompt: scene.visualPrompt,
      durationSec: scene.durationSec,
      speaker: scene.speaker,
      motion: scene.motion,
      imageUrl: imageUrls[index],
    };
  });
  const content: ShortsContent = {
    hook: skit.hook,
    script: skit.scenes.map((scene) => scene.text).join(" "),
    // Scenes keep speaker/imageIndex/motion (numbers and names, never the signed image URLs).
    scenes: skit.scenes,
    caption: skit.caption,
    privacy: skit.privacy,
  };
  return { content, scenes };
}

export const shortsAutomationHandler: AutomationHandler = {
  templateSlug: "shorts",

  async run(ctx: AutomationRunContext): Promise<AutomationHandlerResult> {
    if (ctx.shorts?.publish) return publishExistingPreview(ctx);

    const references = parseShortsReferenceSettings(ctx.config);
    const characterMode = references.references.length > 0;
    const { topic } = await generateTopic(ctx, characterMode ? references.brief || undefined : undefined);

    let content: ShortsContent;
    let videoUrl: string;
    if (characterMode) {
      const character = await generateCharacterShort(ctx, topic, references);
      content = character.content;
      videoUrl = await renderShortVideo(character.scenes, content.script);
    } else {
      content = await generateStructured({
        ...buildShortsContentPrompt(ctx.business, topic, ctx.calendarItem),
        schema: shortsContentSchema,
        maxTokens: 1_600,
      });
      videoUrl = await renderShortVideo(content.scenes, content.script);
    }
    const platforms = ctx.shorts?.previewOnly ? [] : scheduledPlatforms(ctx.config);
    const publicationResults = platforms.length > 0
      ? await publishShortsToPlatforms({
        userId: ctx.automation.user_id,
        businessId: ctx.business.id,
        title: content.hook,
        caption: content.caption,
        videoUrl,
        platforms,
      })
      : {};

    return {
      output: { ...content, topic, videoUrl, publicationResults } as unknown as Json,
      externalUrl: videoUrl,
      title: content.hook,
      topic,
      content: content.script,
      contentType: "shorts",
    };
  },
};
