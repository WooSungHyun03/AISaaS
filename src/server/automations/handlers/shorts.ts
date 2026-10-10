import "server-only";
import { z } from "zod";
import { generateStructured } from "@/server/ai/generate";
import {
  buildShortsPlanPrompt,
  buildShortsTopicPrompt,
  shortsContentSchema,
  shortsPlanSchema,
  shortsTopicSchema,
  type ShortsContent,
  type ShortsTopic,
} from "@/server/ai/prompts/shorts";
import { isNearDuplicateTopic } from "@/server/ai/similarity";
import { createAdminClient } from "@/lib/supabase/admin";
import { publishShortsToPlatforms } from "@/server/automations/shorts-publishing";
import { getAnimationProvider, isAnimationAvailable, type AnimationClipHandle } from "@/server/connectors/animation";
import { animationClipHandleSchema } from "@/server/connectors/animation/types";
import { buildCharacterMovie, getMovieRenderStatus, startMovieRender, type VideoRenderScene } from "@/server/connectors/video";
import { canUseAnimatedShorts } from "@/server/billing/entitlements";
import { prepareCharacterFrame } from "@/server/shorts/character-frame";
import {
  deleteReferenceImages,
  loadReferenceBytes,
  resolveReferenceImageUrls,
  signStoragePath,
  uploadReferenceImage,
} from "@/server/shorts/reference-images";
import type {
  AutomationHandler,
  AutomationHandlerOutcome,
  AutomationHandlerResult,
  AutomationRunContext,
  ShortsPublishPlatform,
} from "@/types/automation";
import type { Json } from "@/types/domain";
import { describeReferenceForPrompt, parseShortsReferenceSettings, type ShortsReferenceSettings } from "@/types/shorts-reference";

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

/** Longest a deferred Shorts run may take before it is given up on (clips + render). */
const MAX_JOB_MINUTES = 30;
/** Each clip is retried once with a fresh request; a second failure ends the run. */
const MAX_CLIP_ATTEMPTS = 2;

const plannedSceneSchema = z.object({
  text: z.string(),
  visualPrompt: z.string(),
  durationSec: z.number(),
  speaker: z.enum(["main", "partner"]),
  motion: z.string(),
  action: z.string(),
  /** 0-based index into the saved reference list. */
  referenceIndex: z.number().int().min(0),
});
type PlannedScene = z.infer<typeof plannedSceneSchema>;

const clipStateSchema = z.object({
  sceneIndex: z.number().int().min(0),
  handle: animationClipHandleSchema,
  status: z.enum(["pending", "done", "failed"]),
  videoUrl: z.string().optional(),
  attempts: z.number().int().min(1),
  framePath: z.string(),
});
type ClipState = z.infer<typeof clipStateSchema>;

const jobStateSchema = z.object({
  v: z.literal(1),
  stage: z.enum(["ANIMATING", "COMPOSING"]),
  /** video = real animated clips, tween = the still image moved by JSON2Video (fallback). */
  animationMode: z.enum(["video", "tween"]),
  animationNote: z.string().optional(),
  topic: z.string(),
  content: z.looseObject({}),
  scenes: z.array(plannedSceneSchema),
  previewOnly: z.boolean(),
  platforms: z.array(z.enum(["instagram", "youtube"])),
  clips: z.array(clipStateSchema),
  framePaths: z.array(z.string()),
  projectId: z.string().optional(),
  startedAt: z.string(),
});
type JobState = z.infer<typeof jobStateSchema>;

function deferred(state: JobState, progress: string): AutomationHandlerOutcome {
  return { deferred: { state: state as unknown as Json, progress } };
}

function clipPrompt(action: string): string {
  return `${action} Keep the character's design, colors and proportions exactly the same as in the image. Smooth, natural motion with a steady camera; the plain gradient background stays unchanged; no text, no subtitles, no logos, no new characters.`.slice(0, 600);
}

function contentForOutput(plan: { hook: string; caption: string; privacy: "private" | "unlisted" | "public" }, scenes: PlannedScene[]): ShortsContent {
  return {
    hook: plan.hook,
    script: scenes.map((scene) => scene.text).join(" "),
    scenes: scenes.map(({ text, visualPrompt, durationSec, speaker, motion, action, referenceIndex }) => ({
      text,
      visualPrompt,
      durationSec,
      speaker,
      motion,
      action,
      imageIndex: referenceIndex + 1,
    })),
    caption: plan.caption,
    privacy: plan.privacy,
  };
}

/**
 * Character Shorts. The AI plans a skit or explainer around the owner's
 * character images, each scene's character is animated by the image-to-video
 * service, and the clips are voiced and assembled by JSON2Video. Clips and the
 * final render take minutes, which no single request can wait for, so the run
 * is deferred and advanced in short steps (see runner.ts).
 */
async function startCharacterRun(ctx: AutomationRunContext, settings: ShortsReferenceSettings): Promise<AutomationHandlerOutcome> {
  const owner = { userId: ctx.automation.user_id, automationId: ctx.automation.id };
  const { topic } = await generateTopic(ctx, settings.brief || undefined);
  const plan = await generateStructured({
    ...buildShortsPlanPrompt(ctx.business, topic, {
      references: settings.references.map(describeReferenceForPrompt),
      style: settings.style,
      brief: settings.brief || undefined,
      mascot: settings.references.some((reference) => reference.kind === "mascot"),
      calendar: ctx.calendarItem ? { goal: ctx.calendarItem.goal, summary: ctx.calendarItem.summary, cta: ctx.calendarItem.cta } : undefined,
    }),
    schema: shortsPlanSchema,
    maxTokens: 1_800,
  });

  const admin = createAdminClient();
  const previewOnly = Boolean(ctx.shorts?.previewOnly);
  const platforms = previewOnly ? [] : scheduledPlatforms(ctx.config);
  const base = { v: 1 as const, topic, previewOnly, platforms, startedAt: new Date().toISOString() };

  // The AI numbers images from 1; a number outside the list falls back to the first image.
  const scenes: PlannedScene[] = plan.scenes.map((scene) => ({
    text: scene.text,
    visualPrompt: scene.visualPrompt,
    durationSec: scene.durationSec,
    speaker: scene.speaker,
    motion: scene.motion,
    action: scene.action,
    referenceIndex: scene.imageIndex >= 1 && scene.imageIndex <= settings.references.length ? scene.imageIndex - 1 : 0,
  }));
  const content = contentForOutput(plan, scenes);

  let animationNote: string | undefined;
  let animate = isAnimationAvailable();
  if (!animate) {
    animationNote = "움직이는 영상 서비스가 아직 연결되지 않아 기본 움직임 효과로 만들었어요.";
  } else {
    const entitlement = await canUseAnimatedShorts(admin, ctx.automation.user_id);
    if (!entitlement.allowed) {
      animate = false;
      animationNote = `${entitlement.reason ?? "움직이는 캐릭터 영상 한도를 모두 썼어요."} 기본 움직임 효과로 만들었어요.`;
    }
  }

  if (!animate) {
    const urls = await resolveReferenceImageUrls(admin, settings.references, owner);
    const renderScenes: VideoRenderScene[] = scenes.map((scene) => ({
      text: scene.text,
      visualPrompt: scene.visualPrompt,
      durationSec: scene.durationSec,
      speaker: scene.speaker,
      motion: scene.motion as VideoRenderScene["motion"],
      imageUrl: urls[scene.referenceIndex],
    }));
    const projectId = await startMovieRender(buildCharacterMovie(renderScenes));
    const state: JobState = { ...base, stage: "COMPOSING", animationMode: "tween", animationNote, content, scenes, clips: [], framePaths: [], projectId };
    return deferred(state, "영상을 만드는 중이에요");
  }

  // Really animate: one 9:16 frame and one clip per scene.
  const provider = getAnimationProvider();
  const framePaths: string[] = [];
  const clips: ClipState[] = [];
  for (const [sceneIndex, scene] of scenes.entries()) {
    const reference = settings.references[scene.referenceIndex];
    const frame = await prepareCharacterFrame(await loadReferenceBytes(admin, reference, owner), sceneIndex);
    const framePath = `${owner.userId}/${owner.automationId}/frames/${ctx.runId}-${sceneIndex}.png`;
    await uploadReferenceImage(admin, framePath, frame, "png");
    framePaths.push(framePath);
    const handle = await provider.startClip({ imageUrl: await signStoragePath(admin, framePath), prompt: clipPrompt(scene.action) });
    clips.push({ sceneIndex, handle, status: "pending", attempts: 1, framePath });
  }
  const state: JobState = { ...base, stage: "ANIMATING", animationMode: "video", content, scenes, clips, framePaths };
  return deferred(state, `캐릭터를 움직이는 중이에요 (0/${clips.length})`);
}

async function resumeCharacterRun(ctx: AutomationRunContext, raw: Json): Promise<AutomationHandlerOutcome> {
  const parsed = jobStateSchema.safeParse(raw);
  if (!parsed.success) throw new Error("진행 중인 숏폼 작업 정보를 읽지 못했어요. 영상을 다시 만들어주세요.");
  const state = parsed.data;
  if (Date.now() - Date.parse(state.startedAt) > MAX_JOB_MINUTES * 60_000) {
    throw new Error("영상 만들기가 너무 오래 걸려 중단했어요. 잠시 후 다시 시도해주세요.");
  }
  const admin = createAdminClient();

  if (state.stage === "ANIMATING") {
    const provider = getAnimationProvider();
    const clips = state.clips.map((clip) => ({ ...clip }));
    for (const clip of clips) {
      if (clip.status !== "pending") continue;
      const status = await provider.getClip(clip.handle as AnimationClipHandle);
      if (status.state === "done") {
        clip.status = "done";
        clip.videoUrl = status.videoUrl;
      } else if (status.state === "failed") {
        if (clip.attempts >= MAX_CLIP_ATTEMPTS) {
          throw new Error(`캐릭터 움직임을 만들지 못했어요: ${status.message}`);
        }
        clip.handle = await provider.startClip({
          imageUrl: await signStoragePath(admin, clip.framePath),
          prompt: clipPrompt(state.scenes[clip.sceneIndex]?.action ?? ""),
        });
        clip.attempts += 1;
      }
    }
    const done = clips.filter((clip) => clip.status === "done").length;
    if (done < clips.length) {
      return deferred({ ...state, clips }, `캐릭터를 움직이는 중이에요 (${done}/${clips.length})`);
    }

    const renderScenes: VideoRenderScene[] = state.scenes.map((scene, index) => ({
      text: scene.text,
      visualPrompt: scene.visualPrompt,
      durationSec: scene.durationSec,
      speaker: scene.speaker,
      motion: scene.motion as VideoRenderScene["motion"],
      videoUrl: clips.find((clip) => clip.sceneIndex === index)?.videoUrl,
    }));
    const projectId = await startMovieRender(buildCharacterMovie(renderScenes));
    return deferred({ ...state, stage: "COMPOSING", clips, projectId }, "영상을 합치는 중이에요");
  }

  // COMPOSING
  if (!state.projectId) throw new Error("영상 렌더 작업 정보가 없어요. 영상을 다시 만들어주세요.");
  const status = await getMovieRenderStatus(state.projectId);
  if (status.state === "pending") return deferred(state, state.animationMode === "video" ? "영상을 합치는 중이에요" : "영상을 만드는 중이에요");
  if (status.state === "failed") throw new Error(status.message);

  const videoUrl = status.videoUrl;
  const content = state.content as unknown as ShortsContent;
  const publicationResults = state.platforms.length > 0
    ? await publishShortsToPlatforms({
      userId: ctx.automation.user_id,
      businessId: ctx.business.id,
      title: content.hook,
      caption: content.caption,
      videoUrl,
      platforms: state.platforms,
    })
    : {};
  await deleteReferenceImages(admin, state.framePaths).catch(() => undefined);

  return {
    output: {
      ...content,
      topic: state.topic,
      videoUrl,
      animationMode: state.animationMode,
      ...(state.animationNote ? { animationNote: state.animationNote } : {}),
      publicationResults,
    } as unknown as Json,
    externalUrl: videoUrl,
    title: content.hook,
    topic: state.topic,
    content: content.script,
    contentType: "shorts",
  };
}

export const shortsAutomationHandler: AutomationHandler = {
  templateSlug: "shorts",

  async run(ctx: AutomationRunContext): Promise<AutomationHandlerOutcome> {
    if (ctx.shorts?.publish) return publishExistingPreview(ctx);
    const settings = parseShortsReferenceSettings(ctx.config);
    if (settings.references.length === 0) {
      throw new Error("캐릭터 이미지를 먼저 추가해주세요. 이지 마케팅 마스코트를 불러오거나 캐릭터 이미지를 올리면 영상을 만들 수 있어요.");
    }
    return startCharacterRun(ctx, settings);
  },

  async resume(ctx: AutomationRunContext, state: Json): Promise<AutomationHandlerOutcome> {
    return resumeCharacterRun(ctx, state);
  },
};
