import "server-only";
import { z } from "zod";
import { generateStructured } from "@/server/ai/generate";
import {
  buildShortsPlanPrompt,
  buildShortsTopicPrompt,
  makeShortsPlanSchema,
  shortsContentSchema,
  shortsTopicSchema,
  type CharacterPlan,
  type PromoPlan,
  type ShortsContent,
  type ShortsTopic,
} from "@/server/ai/prompts/shorts";
import { isNearDuplicateTopic } from "@/server/ai/similarity";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env/server";
import { publishShortsToPlatforms } from "@/server/automations/shorts-publishing";
import { getAnimationProvider, isAnimationAvailable, type AnimationClipHandle, type AnimationQuality } from "@/server/connectors/animation";
import { animationClipHandleSchema } from "@/server/connectors/animation/types";
import {
  buildCharacterMovie,
  buildPromoMovie,
  getMovieRenderStatus,
  startMovieRender,
  withBackgroundMusic,
  type PromoEndCard,
  type PromoRenderScene,
  type VideoRenderScene,
} from "@/server/connectors/video";
import { canUseAnimatedShorts } from "@/server/billing/entitlements";
import { promotionFieldValue } from "@/lib/promotion";
import { resolvePromotionType } from "@/server/promotion/strategy";
import { prepareCharacterFrame, preparePhotoFrame } from "@/server/shorts/character-frame";
import { analyzeReferenceImage } from "@/server/shorts/reference-analysis";
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
import {
  allowedShortsFormats,
  describeReferenceForPrompt,
  parseShortsReferenceSettings,
  referenceIndexes,
  type ShortsReference,
  type ShortsReferenceSettings,
} from "@/types/shorts-reference";

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
  if (isSampleVideo(output)) {
    throw new Error("테스트용 샘플 영상은 게시할 수 없어요. 영상 제작 서비스를 연결한 뒤 다시 만들어주세요.");
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
    externalApiCallCount: request.platforms.length,
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
  /** 0-based index into the saved reference list. */
  referenceIndex: z.number().int().min(0),
  // character format
  speaker: z.enum(["main", "partner"]).optional(),
  motion: z.string().optional(),
  action: z.string().optional(),
  // promo format
  camera: z.string().optional(),
  animate: z.boolean().optional(),
  motionPrompt: z.string().optional(),
  /** Private-bucket path of this scene's framed photo (promo). */
  framePath: z.string().optional(),
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

const musicStateSchema = z.object({
  handle: animationClipHandleSchema,
  status: z.enum(["pending", "done", "failed"]),
  audioUrl: z.string().optional(),
});
type MusicState = z.infer<typeof musicStateSchema>;

const jobStateSchema = z.object({
  v: z.literal(1),
  stage: z.enum(["ANIMATING", "COMPOSING"]),
  format: z.enum(["character", "promo"]),
  /** video = real animated clips; tween = a still character moved by JSON2Video (fallback); photos = promo without clips. */
  animationMode: z.enum(["video", "tween", "photos"]),
  animationNote: z.string().optional(),
  topic: z.string(),
  content: z.looseObject({}),
  scenes: z.array(plannedSceneSchema),
  previewOnly: z.boolean(),
  platforms: z.array(z.enum(["instagram", "youtube"])),
  clips: z.array(clipStateSchema),
  framePaths: z.array(z.string()),
  /** Background track queued next to the clips; the movie waits for it, but a failed track is simply left out. */
  music: musicStateSchema.optional(),
  /** Model tier the plan paid for; reused when a clip is retried. */
  quality: z.enum(["standard", "premium"]).default("standard"),
  projectId: z.string().optional(),
  startedAt: z.string(),
});
type JobState = z.infer<typeof jobStateSchema>;

function deferred(state: JobState, progress: string): AutomationHandlerOutcome {
  return { deferred: { state: state as unknown as Json, progress } };
}

/** The AI numbers images from 1; anything outside the group the format may use falls back to that group's first image. */
function clampReferenceIndex(imageIndex: number, validOneBased: number[]): number {
  return (validOneBased.includes(imageIndex) ? imageIndex : validOneBased[0]) - 1;
}

const CHARACTER_PRESERVE = "Keep the character's design, colors and proportions exactly the same as in the image. Smooth, natural motion with a steady camera; the plain gradient background stays unchanged; no text, no subtitles, no logos, no new characters.";
const PRODUCT_PRESERVE = "Keep the product, its shape, colors, labels, packaging text and logo exactly as in the image. Smooth, slow, realistic motion; the framing stays stable; no new objects, no people appear, no added text or subtitles.";

function clipPrompt(action: string, format: "character" | "promo"): string {
  return `${action} ${format === "character" ? CHARACTER_PRESERVE : PRODUCT_PRESERVE}`.slice(0, 600);
}

function contentForOutput(plan: { hook: string; caption: string; privacy: "private" | "unlisted" | "public" }, scenes: PlannedScene[]): ShortsContent {
  return {
    hook: plan.hook,
    script: scenes.map((scene) => scene.text).join(" "),
    scenes: scenes.map(({ text, visualPrompt, durationSec, speaker, motion, action, camera, referenceIndex }) => ({
      text,
      visualPrompt,
      durationSec,
      ...(speaker ? { speaker } : {}),
      ...(motion ? { motion } : {}),
      ...(action ? { action } : {}),
      ...(camera ? { camera } : {}),
      imageIndex: referenceIndex + 1,
    })),
    caption: plan.caption,
    privacy: plan.privacy,
  };
}

/** Images added before the AI looked at them (or while it was unavailable) are looked at now, once. */
async function withAnalysis(
  admin: ReturnType<typeof createAdminClient>,
  settings: ShortsReferenceSettings,
  owner: { userId: string; automationId: string },
): Promise<ShortsReferenceSettings> {
  const references = await Promise.all(
    settings.references.map(async (reference): Promise<ShortsReference> => {
      if (reference.subject) return reference;
      try {
        const analysis = await analyzeReferenceImage(await loadReferenceBytes(admin, reference, owner), reference.label);
        return { ...reference, ...analysis };
      } catch {
        return { ...reference, subject: "other" };
      }
    }),
  );
  return { ...settings, references };
}

/** "https://shop.example.com/p/1/" -> "shop.example.com/p/1": what fits on a card and what a viewer can type. */
function shortUrl(url: string | null): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "")}`.slice(0, 40);
  } catch {
    return "";
  }
}

/** The closing card: straight from what the owner entered for this type, never written by the AI. */
function endCardFor(ctx: AutomationRunContext): PromoEndCard {
  const { business } = ctx;
  const type = resolvePromotionType(business);
  const value = (key: Parameters<typeof promotionFieldValue>[1]) => promotionFieldValue(business, key);
  const lines =
    type === "PRODUCT"
      ? [value("priceInfo") ? `💰 ${value("priceInfo")!.slice(0, 40)}` : "", value("actionUrl") ? `🛒 ${shortUrl(value("actionUrl"))}` : "", value("mainOffering")?.slice(0, 40) ?? ""]
      : type === "PLATFORM"
        ? [value("mainOffering")?.slice(0, 40) ?? "", value("actionUrl") ? `🚀 ${shortUrl(value("actionUrl"))}` : value("website") ? `🌐 ${shortUrl(value("website"))}` : ""]
        : [value("location") ? `📍 ${value("location")!.slice(0, 40)}` : "", value("mainOffering")?.slice(0, 40) ?? "", value("priceInfo") ? `💰 ${value("priceInfo")!.slice(0, 40)}` : ""];
  return { title: business.name, lines: lines.filter(Boolean) };
}

async function checkAnimation(
  admin: ReturnType<typeof createAdminClient>,
  ctx: AutomationRunContext,
  format: "character" | "promo",
): Promise<{ animate: boolean; note?: string; quality: AnimationQuality }> {
  const fallback = format === "character" ? "기본 움직임 효과" : "사진을 천천히 움직이는 기본 효과";
  if (!isAnimationAvailable()) return { animate: false, quality: "standard", note: `움직이는 영상 서비스가 아직 연결되지 않아 ${fallback}로 만들었어요.` };
  const entitlement = await canUseAnimatedShorts(admin, ctx.automation.user_id);
  const quality = entitlement.animationQuality ?? "standard";
  if (!entitlement.allowed) {
    return { animate: false, quality, note: `${entitlement.reason ?? "움직이는 영상 한도를 모두 썼어요."} ${fallback}로 만들었어요.` };
  }
  return { animate: true, quality };
}

/** Queues the background track. Music is a nice-to-have: any failure here just means a video without it. */
async function startMusic(direction: string): Promise<MusicState | undefined> {
  if (!isAnimationAvailable()) return undefined;
  try {
    return { handle: await getAnimationProvider().startMusic({ prompt: direction }), status: "pending" };
  } catch {
    return undefined;
  }
}

/**
 * Reference-image Shorts. The AI looks at what the owner's images show and plans the matching kind of ad
 * (a character acts it out, or the product / place photos are advertised), then clips are generated where
 * motion helps and JSON2Video assembles voice, music and clips. Clips and the render take minutes, which
 * no single request can wait for, so the run is deferred and advanced in short steps (see runner.ts).
 */
async function startReferenceRun(ctx: AutomationRunContext, rawSettings: ShortsReferenceSettings): Promise<AutomationHandlerOutcome> {
  const owner = { userId: ctx.automation.user_id, automationId: ctx.automation.id };
  const admin = createAdminClient();
  const settings = await withAnalysis(admin, rawSettings, owner);
  const { topic } = await generateTopic(ctx, settings.brief || undefined);
  const allowed = allowedShortsFormats(settings.references, settings.style);
  const plan = await generateStructured({
    ...buildShortsPlanPrompt(ctx.business, topic, {
      references: settings.references.map(describeReferenceForPrompt),
      allowedFormats: allowed,
      style: settings.style,
      brief: settings.brief || undefined,
      mascot: settings.references.some((reference) => reference.kind === "mascot"),
      calendar: ctx.calendarItem ? { goal: ctx.calendarItem.goal, summary: ctx.calendarItem.summary, cta: ctx.calendarItem.cta } : undefined,
    }),
    schema: makeShortsPlanSchema(allowed),
    maxTokens: 2_000,
  });

  const previewOnly = Boolean(ctx.shorts?.previewOnly);
  const platforms = previewOnly ? [] : scheduledPlatforms(ctx.config);
  // The background track is queued right away so it is ready by the time the clips are.
  const music = await startMusic(plan.music);
  const base: RunBase = { v: 1, topic, previewOnly, platforms, startedAt: new Date().toISOString(), music };
  const groups = referenceIndexes(settings.references);

  if (plan.format === "promo") return startPromoRun(ctx, admin, settings, owner, plan, groups.photo, base);
  return startCharacterRun(ctx, admin, settings, owner, plan, groups.character, base);
}

type RunBase = { v: 1; topic: string; previewOnly: boolean; platforms: ShortsPublishPlatform[]; startedAt: string; music?: MusicState };

async function startCharacterRun(
  ctx: AutomationRunContext,
  admin: ReturnType<typeof createAdminClient>,
  settings: ShortsReferenceSettings,
  owner: { userId: string; automationId: string },
  plan: CharacterPlan,
  characterIndexes: number[],
  base: RunBase,
): Promise<AutomationHandlerOutcome> {
  const scenes: PlannedScene[] = plan.scenes.map((scene) => ({
    text: scene.text,
    visualPrompt: scene.visualPrompt,
    durationSec: scene.durationSec,
    speaker: scene.speaker,
    motion: scene.motion,
    action: scene.action,
    referenceIndex: clampReferenceIndex(scene.imageIndex, characterIndexes),
  }));
  const content = contentForOutput(plan, scenes);
  const { animate, note: animationNote, quality } = await checkAnimation(admin, ctx, "character");

  if (!animate) {
    const waiting: JobState = { ...base, stage: "ANIMATING", format: "character", animationMode: "tween", animationNote, quality, content, scenes, clips: [], framePaths: [] };
    // With a track on the way, wait for it first; otherwise render right away.
    if (base.music) return deferred(waiting, "배경음악을 만드는 중이에요");
    const projectId = await startMovieRender(await characterTweenMovie(admin, ctx, scenes));
    return deferred({ ...waiting, stage: "COMPOSING", projectId }, "영상을 만드는 중이에요");
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
    const handle = await provider.startClip({ imageUrl: await signStoragePath(admin, framePath), prompt: clipPrompt(scene.action ?? "", "character") }, { quality });
    clips.push({ sceneIndex, handle, status: "pending", attempts: 1, framePath });
  }
  const state: JobState = { ...base, stage: "ANIMATING", format: "character", animationMode: "video", quality, content, scenes, clips, framePaths };
  return deferred(state, `캐릭터를 움직이는 중이에요 (0/${clips.length})`);
}

async function startPromoRun(
  ctx: AutomationRunContext,
  admin: ReturnType<typeof createAdminClient>,
  settings: ShortsReferenceSettings,
  owner: { userId: string; automationId: string },
  plan: PromoPlan,
  photoIndexes: number[],
  base: RunBase,
): Promise<AutomationHandlerOutcome> {
  const wantsAnimation = plan.scenes.some((scene) => scene.animate);
  const { animate, note, quality } = wantsAnimation
    ? await checkAnimation(admin, ctx, "promo")
    : { animate: false, note: undefined, quality: "standard" as AnimationQuality };

  // People are never animated: their photo is only framed and panned.
  const scenes: PlannedScene[] = plan.scenes.map((scene) => {
    const referenceIndex = clampReferenceIndex(scene.imageIndex, photoIndexes);
    const isPerson = settings.references[referenceIndex]?.subject === "person";
    return {
      text: scene.text,
      visualPrompt: scene.visualPrompt,
      durationSec: scene.durationSec,
      camera: scene.camera,
      animate: animate && scene.animate && !isPerson,
      motionPrompt: scene.motionPrompt,
      referenceIndex,
    };
  });
  const content = contentForOutput(plan, scenes);

  // Frame every scene's photo as 9:16 once (the same file is the animator's input and the still shown in the video).
  const provider = getAnimationProvider();
  const bytesByReference = new Map<number, Uint8Array>();
  const framePaths: string[] = [];
  const clips: ClipState[] = [];
  for (const [sceneIndex, scene] of scenes.entries()) {
    const reference = settings.references[scene.referenceIndex];
    let bytes = bytesByReference.get(scene.referenceIndex);
    if (!bytes) {
      bytes = await loadReferenceBytes(admin, reference, owner);
      bytesByReference.set(scene.referenceIndex, bytes);
    }
    const framePath = `${owner.userId}/${owner.automationId}/frames/${ctx.runId}-${sceneIndex}.jpg`;
    await uploadReferenceImage(admin, framePath, await preparePhotoFrame(bytes), "jpeg");
    framePaths.push(framePath);
    scene.framePath = framePath;
    if (scene.animate) {
      const handle = await provider.startClip({ imageUrl: await signStoragePath(admin, framePath), prompt: clipPrompt(scene.motionPrompt ?? "", "promo") }, { quality });
      clips.push({ sceneIndex, handle, status: "pending", attempts: 1, framePath });
    }
  }

  if (clips.length === 0) {
    const waiting: JobState = { ...base, stage: "ANIMATING", format: "promo", animationMode: "photos", animationNote: note, quality, content, scenes, clips: [], framePaths };
    if (base.music) return deferred(waiting, "배경음악을 만드는 중이에요");
    const projectId = await startMovieRender(await promoMovie(admin, ctx, scenes, []));
    return deferred({ ...waiting, stage: "COMPOSING", projectId }, "사진으로 영상을 만드는 중이에요");
  }
  const state: JobState = { ...base, stage: "ANIMATING", format: "promo", animationMode: "video", quality, content, scenes, clips, framePaths };
  return deferred(state, `사진을 움직이는 중이에요 (0/${clips.length})`);
}

/** The character video without animation: the reference image moved by JSON2Video. */
async function characterTweenMovie(admin: ReturnType<typeof createAdminClient>, ctx: AutomationRunContext, scenes: PlannedScene[]): Promise<Record<string, unknown>> {
  const settings = parseShortsReferenceSettings(ctx.config);
  const owner = { userId: ctx.automation.user_id, automationId: ctx.automation.id };
  const urls = await resolveReferenceImageUrls(admin, settings.references, owner);
  const renderScenes: VideoRenderScene[] = scenes.map((scene) => ({
    text: scene.text,
    visualPrompt: scene.visualPrompt,
    durationSec: scene.durationSec,
    speaker: scene.speaker,
    motion: scene.motion as VideoRenderScene["motion"],
    imageUrl: urls[scene.referenceIndex],
  }));
  return buildCharacterMovie(renderScenes);
}

async function promoMovie(
  admin: ReturnType<typeof createAdminClient>,
  ctx: AutomationRunContext,
  scenes: PlannedScene[],
  clips: ClipState[],
): Promise<Record<string, unknown>> {
  const renderScenes: PromoRenderScene[] = [];
  for (const [index, scene] of scenes.entries()) {
    const clipUrl = clips.find((clip) => clip.sceneIndex === index)?.videoUrl;
    renderScenes.push({
      text: scene.text,
      camera: scene.camera as PromoRenderScene["camera"],
      ...(clipUrl ? { videoUrl: clipUrl } : { imageUrl: await signStoragePath(admin, scene.framePath ?? "") }),
    });
  }
  return buildPromoMovie(renderScenes, { brandName: ctx.business.name, endCard: endCardFor(ctx) });
}

async function resumeReferenceRun(ctx: AutomationRunContext, raw: Json): Promise<AutomationHandlerOutcome> {
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
          throw new Error(`움직이는 영상을 만들지 못했어요: ${status.message}`);
        }
        const scene = state.scenes[clip.sceneIndex];
        clip.handle = await provider.startClip({
          imageUrl: await signStoragePath(admin, clip.framePath),
          prompt: clipPrompt(state.format === "character" ? scene?.action ?? "" : scene?.motionPrompt ?? "", state.format),
        }, { quality: state.quality });
        clip.attempts += 1;
      }
    }

    // The background track: a failed or missing one simply means the video is made without music.
    let music = state.music ? { ...state.music } : undefined;
    if (music?.status === "pending") {
      try {
        const musicStatus = await provider.getMusic(music.handle as AnimationClipHandle);
        if (musicStatus.state === "done") {
          music.status = "done";
          music.audioUrl = musicStatus.audioUrl;
        } else if (musicStatus.state === "failed") {
          music = { ...music, status: "failed" };
        }
      } catch {
        music = { ...music, status: "failed" };
      }
    }

    const done = clips.filter((clip) => clip.status === "done").length;
    const noun = state.format === "character" ? "캐릭터를" : "사진을";
    if (done < clips.length) {
      return deferred({ ...state, clips, music }, `${noun} 움직이는 중이에요 (${done}/${clips.length})`);
    }
    if (music?.status === "pending") return deferred({ ...state, clips, music }, "배경음악을 만드는 중이에요");

    let movie: Record<string, unknown>;
    if (state.format === "promo") {
      movie = await promoMovie(admin, ctx, state.scenes, clips);
    } else if (state.animationMode === "tween") {
      movie = await characterTweenMovie(admin, ctx, state.scenes);
    } else {
      const renderScenes: VideoRenderScene[] = state.scenes.map((scene, index) => ({
        text: scene.text,
        visualPrompt: scene.visualPrompt,
        durationSec: scene.durationSec,
        speaker: scene.speaker,
        motion: scene.motion as VideoRenderScene["motion"],
        videoUrl: clips.find((clip) => clip.sceneIndex === index)?.videoUrl,
      }));
      movie = buildCharacterMovie(renderScenes);
    }
    if (music?.status === "done" && music.audioUrl) movie = withBackgroundMusic(movie, music.audioUrl);
    const projectId = await startMovieRender(movie);
    return deferred({ ...state, stage: "COMPOSING", clips, music, projectId }, "영상을 합치는 중이에요");
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
      format: state.format,
      animationMode: state.animationMode,
      ...(state.animationNote ? { animationNote: state.animationNote } : {}),
      // A mock renderer's address is a placeholder; flag it so the screen says so and posting is refused.
      ...(serverEnv.VIDEO_RENDER_PROVIDER !== "json2video" ? { sampleVideo: true } : {}),
      publicationResults,
    } as unknown as Json,
    externalUrl: videoUrl,
    title: content.hook,
    topic: state.topic,
    content: content.script,
    contentType: "shorts",
    externalApiCallCount: 1 + state.clips.length + (state.music?.audioUrl ? 1 : 0) + state.platforms.length,
  };
}

/** The preview a mock renderer returns is a placeholder address, not a video: it must never be shown as a finished Short. */
function isSampleVideo(output: Record<string, unknown> | null | undefined): boolean {
  if (!output) return false;
  if (output.sampleVideo === true) return true;
  return typeof output.videoUrl === "string" && /\.invalid(\/|$)/.test(output.videoUrl);
}

export const shortsAutomationHandler: AutomationHandler = {
  templateSlug: "shorts",

  preflight(ctx) {
    if (ctx.shorts?.publish) return null;
    // Without a real renderer a production run would "succeed" with a placeholder instead of a video.
    if (process.env.NODE_ENV === "production" && serverEnv.VIDEO_RENDER_PROVIDER !== "json2video") {
      return "영상 제작 서비스가 아직 연결되지 않아 지금은 숏폼을 만들 수 없어요. 이용권은 차감되지 않았어요. 관리자에게 문의해주세요.";
    }
    return null;
  },

  async run(ctx: AutomationRunContext): Promise<AutomationHandlerOutcome> {
    if (ctx.shorts?.publish) return publishExistingPreview(ctx);
    const settings = parseShortsReferenceSettings(ctx.config);
    if (settings.references.length === 0) {
      throw new Error("참고 이미지를 먼저 추가해주세요. 이지 마케팅 마스코트를 불러오거나 캐릭터·상품·매장 이미지를 올리면 영상을 만들 수 있어요.");
    }
    return startReferenceRun(ctx, settings);
  },

  async resume(ctx: AutomationRunContext, state: Json): Promise<AutomationHandlerOutcome> {
    return resumeReferenceRun(ctx, state);
  },
};
