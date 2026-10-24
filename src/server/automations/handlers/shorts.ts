import "server-only";
import { z } from "zod";
import { generateStructured } from "@/server/ai/generate";
import { isNearDuplicateTopic } from "@/server/ai/similarity";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/logger";
import {
  assertPaidCallsAllowed,
  releaseSpend,
  reserveSpend,
  runPaidCall,
  settleSpend,
  summarizeRunSpend,
  ttsUsd,
  wanReserveUsd,
  wanSettledUsd,
  withBudgetScope,
  type WanPricingInput,
} from "@/server/budget";
import { getPostprocessProvider, MockPostprocessProvider, type ComposeOverlay, type PostprocessProvider, type VideoAnalysis } from "@/server/connectors/postprocess";
import { getTtsProvider } from "@/server/connectors/tts";
import { missingVideoRequirements } from "@/server/connectors/video-readiness";
import { getWanProvider, isRealVideoGeneration, wanHandleSchema, type WanHandle, type WanRequest } from "@/server/connectors/wan";
import { isAppError } from "@/server/shared/errors";
import { promotionFieldValue } from "@/lib/promotion";
import { resolvePromotionType } from "@/server/promotion/strategy";
import {
  buildAdPlanPrompt,
  buildWanPrompt,
  makeAdPlanDraftSchema,
  normalizeAdPlan,
  adPlanSchema,
  type AdPlan,
} from "@/server/shorts/ad-plan";
import {
  ensureShortsBuckets,
  resolveAssetUrls,
  resolveImageUrls,
  signAsset,
  VIDEO_BUCKET,
  VIDEO_URL_TTL_SEC,
  videoStoragePath,
} from "@/server/shorts/assets";
import { type ShortsContent } from "@/server/shorts/content";
import { withImageAnalysis } from "@/server/shorts/describe-images";
import { generateShortsPublishing } from "@/server/shorts/publishing-generate";
import { shortsPublishingSchema, type ShortsPublishing } from "@/server/shorts/publishing-metadata";
import {
  aiQaSchema,
  buildAiQaPrompt,
  combineQa,
  evaluateAnalysis,
  promptFindings,
  retryNoteFrom,
  type QaReport,
} from "@/server/shorts/qa";
import {
  assetsOfKind,
  describeAssetForPrompt,
  parseShortsSettings,
  shortsAssetSchema,
  summarizeUsedReferences,
  totalSeconds,
  type ShortsAsset,
  type ShortsSettings,
} from "@/types/shorts-reference";
import type {
  AutomationHandler,
  AutomationHandlerOutcome,
  AutomationHandlerResult,
  AutomationRunContext,
} from "@/types/automation";
import type { Json } from "@/types/domain";

/**
 * Ad Shorts. One 20-30 s vertical video is generated end to end by Wan 3.0 (reference-to-video on fal) from the owner's
 * photos, clips and music, then checked, voiced if needed and finished with FFmpeg. Every paid step reserves its worst
 * case in the VIDEO budget first (src/server/budget) and nothing runs without that.
 *
 *   run     look at new photos (vision) -> ad plan (Opus) -> Wan prompt (rules) -> posting text (Sonnet)
 *   SUBMIT  reserve the generation -> queue it at fal -> save the job id at once
 *   WAIT    poll fal -> settle the reservation when it finishes
 *   CHECK   FFmpeg measurements + vision QA of sampled frames. A clear error rejects; at most one regeneration
 *   VOICE   Korean narration (only when the video's own voice is missing, or the owner chose it)
 *   FINISH  FFmpeg worker: logo, name, CTA, exact images, voice mixing, loudness, final MP4 into private Storage
 *
 * One quick step per call; the run is deferred between steps and survives restarts (see runner.ts).
 */
const MAX_ATTEMPTS = 2;
const MAX_JOB_MINUTES = 80;
/** A generation that has not finished after this long is given up on (and, since it may be billed, stays booked). */
const MAX_GENERATION_MINUTES = 30;
const MAX_WORKER_TRIES = 3;
const QA_FRAMES = 8;
const WAN_RESOLUTION = "720p" as const;

const wanAttemptSchema = z.object({
  attempt: z.number().int().min(1),
  outcome: z.enum(["accepted", "rejected", "failed", "lost"]),
  usd: z.number().min(0).default(0),
  note: z.string().max(300).default(""),
});

const jobStateSchema = z.object({
  v: z.literal(2),
  stage: z.enum(["SUBMIT", "WAIT", "CHECK", "VOICE", "FINISH"]),
  topic: z.string(),
  durationSec: z.number().int().min(20).max(30),
  voiceMode: z.enum(["native", "tts"]),
  previewOnly: z.boolean(),
  plan: adPlanSchema,
  assets: z.array(shortsAssetSchema),
  wanPrompt: z.string(),
  referenceVideoSeconds: z.number().min(0),
  publishing: shortsPublishingSchema.optional(),
  attempt: z.number().int().min(1).max(MAX_ATTEMPTS),
  retryNote: z.string().max(500).optional(),
  /** The open reservation of the current generation, if any (real generation only). */
  reservation: z.object({ id: z.string(), usd: z.number() }).optional(),
  wan: wanHandleSchema.optional(),
  wanSubmittedAt: z.string().optional(),
  generated: z.object({ videoUrl: z.string(), durationSec: z.number().optional(), seed: z.number().optional(), actualPrompt: z.string().optional() }).optional(),
  /** What the current generation was settled at. */
  lastUsd: z.number().min(0).default(0),
  analysisJob: z.object({ jobId: z.string() }).optional(),
  analysis: z.object({ hasAudio: z.boolean(), durationSec: z.number() }).optional(),
  qa: z.looseObject({}).optional(),
  attempts: z.array(wanAttemptSchema).default([]),
  needsVoice: z.boolean().default(false),
  voice: z.object({ path: z.string(), characters: z.number() }).optional(),
  composeJob: z.object({ jobId: z.string() }).optional(),
  workerTries: z.number().int().min(0).default(0),
  notes: z.array(z.string()).default([]),
  aiCalls: z.number().int().min(0).default(0),
  startedAt: z.string(),
});
type JobState = z.infer<typeof jobStateSchema>;

const PROGRESS: Record<JobState["stage"], (state: JobState) => string> = {
  SUBMIT: (state) => (state.attempt > 1 ? "영상을 다시 만들 준비를 하고 있어요 (2/2번째 시도)" : "영상 만들기를 시작하고 있어요"),
  WAIT: (state) => `AI가 영상을 만드는 중이에요 (${state.attempt}/${MAX_ATTEMPTS}번째 시도, 보통 몇 분 걸려요)`,
  CHECK: () => "만든 영상을 꼼꼼히 점검하는 중이에요",
  VOICE: () => "한국어 음성을 만드는 중이에요",
  FINISH: () => "로고와 문구를 넣어 영상을 마무리하는 중이에요",
};

function deferred(state: JobState, stage: JobState["stage"] = state.stage): AutomationHandlerOutcome {
  const next = { ...state, stage };
  return { deferred: { state: next as unknown as Json, progress: PROGRESS[stage](next) } };
}

const owner = (ctx: AutomationRunContext) => ({ userId: ctx.automation.user_id, automationId: ctx.automation.id });

function wanPricing(durationSec: number, referenceVideoSeconds: number): WanPricingInput {
  return {
    resolution: WAN_RESOLUTION,
    outputSeconds: durationSec,
    referenceVideoSeconds,
    thinking: serverEnv.WAN_ENABLE_THINKING === "true",
    thinkingCostVerified: serverEnv.WAN_THINKING_COST_VERIFIED === "true",
    thinkingReserveMultiplier: serverEnv.WAN_THINKING_RESERVE_MULTIPLIER,
  };
}

/** A placeholder video (mock generator) has nothing for the worker to download: the mock post-processor stands in for it. */
function postprocessFor(): PostprocessProvider {
  return getWanProvider().name === "mock" ? new MockPostprocessProvider() : getPostprocessProvider();
}

const scoped = <T,>(ctx: AutomationRunContext, attempt: number, fn: () => Promise<T>) => withBudgetScope({ kind: "VIDEO", runId: ctx.runId, attempt }, fn);

function videoLink(ctx: AutomationRunContext): string | null {
  return promotionFieldValue(ctx.business, "actionUrl") ?? promotionFieldValue(ctx.business, "website");
}

/** Failures that mean fal refused the request before queueing anything: nothing was billed. */
const UNBILLED_SUBMIT_CODES = new Set(["INVALID_TARGET", "NOT_CONFIGURED", "AUTH_FAILED", "PERMISSION_DENIED", "UPSTREAM_CLIENT_ERROR"]);

/** What the owner told the pipeline, checked before a credit is touched or a cent is reserved. */
function requireInputs(settings: ShortsSettings): void {
  if (assetsOfKind(settings.assets, "image").length === 0 && assetsOfKind(settings.assets, "video").length === 0) {
    throw new Error("사진이나 참고 영상을 먼저 추가해주세요. 상품·매장 사진을 올리거나 이지 마케팅 마스코트를 불러오면 광고 영상을 만들 수 있어요.");
  }
}

async function makePlan(ctx: AutomationRunContext, settings: ShortsSettings, assets: ShortsAsset[]): Promise<AdPlan> {
  const images = assetsOfKind(assets, "image");
  const videos = assetsOfKind(assets, "video");
  const audios = assetsOfKind(assets, "audio");
  const bounds = {
    durationSec: settings.durationSec,
    imageCount: images.length,
    videoCount: videos.length,
    audioCount: audios.length,
    exactImages: images.flatMap((asset, index) => (asset.role === "exact" ? [index + 1] : [])),
  };
  const request = (rejectedTopic?: string) => ({
    ...buildAdPlanPrompt({
      business: ctx.business,
      topic: ctx.calendarItem?.topic,
      brief: settings.brief || undefined,
      recentTopics: ctx.recentTopics,
      rejectedTopic,
      calendar: ctx.calendarItem ? { goal: ctx.calendarItem.goal, summary: ctx.calendarItem.summary, cta: ctx.calendarItem.cta } : undefined,
      bounds,
      voiceMode: settings.voiceMode,
      images: images.map(describeAssetForPrompt),
      videos: videos.map((asset) => ({ label: asset.label, durationSec: asset.durationSec ?? 0 })),
      audios: audios.map((asset) => ({ label: asset.label, durationSec: asset.durationSec ?? 0 })),
      hasLogo: assetsOfKind(assets, "logo").length > 0,
    }),
    schema: makeAdPlanDraftSchema(bounds),
    maxTokens: 10_000,
    role: "planner" as const,
    purpose: rejectedTopic ? "video.plan.retry" : "video.plan",
  });
  let plan = await generateStructured(request());
  // A topic too close to a recent video is planned again, once; the calendar's own topic is never replaced.
  if (!ctx.calendarItem && isNearDuplicateTopic(plan.topic, ctx.recentTopics)) plan = await generateStructured(request(plan.topic));
  const normalized = normalizeAdPlan(plan, settings.durationSec);
  return ctx.calendarItem ? { ...normalized, topic: ctx.calendarItem.topic.slice(0, 120) } : normalized;
}

/** Wan accepts a reference to a logo-less ad; a logo asset that does not exist anymore is simply not drawn. */
function referencesFor(assets: ShortsAsset[]) {
  return { images: assetsOfKind(assets, "image"), videos: assetsOfKind(assets, "video"), audios: assetsOfKind(assets, "audio") };
}

async function startRun(ctx: AutomationRunContext): Promise<AutomationHandlerOutcome> {
  const settings = parseShortsSettings(ctx.config);
  requireInputs(settings);
  const real = isRealVideoGeneration();
  const referenceVideoSeconds = totalSeconds(settings.assets, "video");
  const pricing = wanPricing(settings.durationSec, referenceVideoSeconds);

  // The generation is the expensive part: reserve it before spending anything on planning, so a run the budget cannot
  // afford stops here, and a refused reservation costs nothing. If planning then fails, the reservation is released.
  let reservation: JobState["reservation"];
  if (real) {
    assertPaidCallsAllowed();
    const reserved = await reserveSpend({
      kind: "VIDEO",
      runId: ctx.runId,
      step: "video.generate",
      attempt: 1,
      provider: "fal",
      model: serverEnv.WAN_MODEL,
      usd: wanReserveUsd(pricing),
      idempotencyKey: `${ctx.runId}:wan:1`,
      note: `${WAN_RESOLUTION} ${settings.durationSec}s + ${referenceVideoSeconds}s reference video`,
    });
    reservation = { id: reserved.id, usd: reserved.usd };
  }

  try {
    return await scoped(ctx, 1, async () => {
      const assets = await withImageAnalysis({ runId: ctx.runId, ...owner(ctx) }, settings.assets);
      const plan = await makePlan(ctx, settings, assets);
      const wanPrompt = buildWanPrompt({ plan, durationSec: settings.durationSec, voiceMode: settings.voiceMode });
      const { metadata: publishing } = await generateShortsPublishing({
        promotionType: resolvePromotionType(ctx.business),
        businessName: ctx.business.name,
        industry: ctx.business.industry ?? null,
        location: ctx.business.location ?? null,
        keywords: ctx.business.keywords,
        topic: plan.topic,
        hook: plan.hook.text,
        sceneTexts: plan.storyboard.map((scene) => scene.narration || scene.visual.slice(0, 60)),
        link: videoLink(ctx),
      });
      const previewOnly = Boolean(ctx.shorts?.previewOnly);
      const state: JobState = {
        v: 2,
        stage: "SUBMIT",
        topic: plan.topic,
        durationSec: settings.durationSec,
        voiceMode: settings.voiceMode,
        previewOnly,
        plan,
        assets,
        wanPrompt,
        referenceVideoSeconds,
        publishing,
        attempt: 1,
        reservation,
        lastUsd: 0,
            attempts: [],
        needsVoice: false,
        workerTries: 0,
        notes: [],
        aiCalls: 3,
        startedAt: new Date().toISOString(),
      };
      return deferred(state);
    });
  } catch (error) {
    if (reservation) await releaseSpend(reservation.id, "planning failed before the video was requested").catch(() => undefined);
    throw error;
  }
}

/** Settles the open generation reservation (exactly once: the ledger ignores a second settle). */
async function settleGeneration(state: JobState, usd: number | "reserved", note: string): Promise<number> {
  if (!state.reservation) return 0;
  const amount = usd === "reserved" ? state.reservation.usd : usd;
  await settleSpend(state.reservation.id, amount, { note, attempt: state.attempt });
  return amount;
}

/** Starts the next attempt from a clean slate (the reservation of the finished attempt is already settled). */
function nextAttempt(state: JobState, outcome: "rejected" | "failed" | "lost", usd: number, note: string, retryNote?: string): JobState {
  return {
    ...state,
    attempts: [...state.attempts, { attempt: state.attempt, outcome, usd, note: note.slice(0, 300) }],
    attempt: state.attempt + 1,
    retryNote: retryNote || state.retryNote,
    reservation: undefined,
    wan: undefined,
    wanSubmittedAt: undefined,
    generated: undefined,
    lastUsd: 0,
    analysisJob: undefined,
    analysis: undefined,
    qa: undefined,
    needsVoice: false,
    workerTries: 0,
  };
}

async function submit(ctx: AutomationRunContext, state: JobState): Promise<AutomationHandlerOutcome> {
  const real = isRealVideoGeneration();
  let reservation = state.reservation;
  // A regeneration has to be affordable BEFORE anything is sent: the ledger refuses it otherwise and the run ends here.
  if (real && !reservation) {
    assertPaidCallsAllowed();
    const reserved = await reserveSpend({
      kind: "VIDEO",
      runId: ctx.runId,
      step: "video.generate",
      attempt: state.attempt,
      provider: "fal",
      model: serverEnv.WAN_MODEL,
      usd: wanReserveUsd(wanPricing(state.durationSec, state.referenceVideoSeconds)),
      idempotencyKey: `${ctx.runId}:wan:${state.attempt}`,
      note: `regeneration ${state.attempt}`,
    });
    reservation = { id: reserved.id, usd: reserved.usd };
  }

  // Everything that can fail before fal has seen the request is prepared first: if it fails here nothing was sent, so the
  // reservation is released instead of being booked as spent.
  let request: WanRequest;
  try {
    const refs = referencesFor(state.assets);
    const admin = createAdminClient();
    request = {
      prompt: state.retryNote ? buildWanPrompt({ plan: state.plan, durationSec: state.durationSec, voiceMode: state.voiceMode, retryNote: state.retryNote }) : state.wanPrompt,
      durationSec: state.durationSec,
      resolution: WAN_RESOLUTION,
      imageUrls: await resolveImageUrls(admin, refs.images, owner(ctx)),
      videoUrls: await resolveAssetUrls(admin, refs.videos, owner(ctx)),
      audioUrls: await resolveAssetUrls(admin, refs.audios, owner(ctx)),
      thinking: serverEnv.WAN_ENABLE_THINKING === "true",
      promptExpansion: serverEnv.WAN_ENABLE_PROMPT_EXPANSION === "true",
    };
  } catch (error) {
    if (reservation) await releaseSpend(reservation.id, "request could not be prepared").catch(() => undefined);
    throw error;
  }

  let handle: WanHandle;
  try {
    handle = await getWanProvider().submit(request);
  } catch (error) {
    const billed = !(isAppError(error) && UNBILLED_SUBMIT_CODES.has(error.code));
    if (reservation) {
      // Refused before queueing: free. Anything else (a timeout, a dropped connection) may have queued — and billed — a job we have no id for.
      if (!billed) await releaseSpend(reservation.id, "submit rejected").catch(() => undefined);
      else await settleSpend(reservation.id, reservation.usd, { note: "submit outcome unknown", attempt: state.attempt }).catch(() => undefined);
    }
    if (billed && state.attempt < MAX_ATTEMPTS && isAppError(error) && error.retryable) {
      return deferred(nextAttempt({ ...state, reservation }, "lost", reservation?.usd ?? 0, "요청 결과를 알 수 없어요"), "SUBMIT");
    }
    throw error;
  }

  const waiting: JobState = { ...state, reservation, wan: handle, wanSubmittedAt: new Date().toISOString() };
  // Save the job id before anything else: a crash from here on resumes polling this job instead of starting (and paying for) another.
  await ctx.checkpoint?.({ ...waiting, stage: "WAIT" } as unknown as Json);
  return deferred(waiting, "WAIT");
}

async function wait(ctx: AutomationRunContext, state: JobState): Promise<AutomationHandlerOutcome> {
  if (!state.wan) return deferred({ ...state, wanSubmittedAt: undefined }, "SUBMIT");
  const status = await getWanProvider().status(state.wan);
  if (status.state === "pending") {
    const minutes = (Date.now() - Date.parse(state.wanSubmittedAt ?? state.startedAt)) / 60_000;
    if (minutes <= MAX_GENERATION_MINUTES) return deferred(state, "WAIT");
    const usd = await settleGeneration(state, "reserved", "generation timed out");
    return failedGeneration(state, usd, "영상 만들기가 너무 오래 걸렸어요");
  }
  if (status.state === "failed") {
    // A job that failed after queueing may still have been billed: it stays booked at the reserved amount.
    const usd = await settleGeneration(state, "reserved", `generation failed: ${status.message}`);
    return failedGeneration(state, usd, status.message);
  }

  const usd = await settleGeneration(state, wanSettledUsd({ ...wanPricing(state.durationSec, state.referenceVideoSeconds), actualOutputSeconds: status.durationSec }), "generation finished");
  return deferred(
    {
      ...state,
      reservation: undefined,
      generated: { videoUrl: status.videoUrl, durationSec: status.durationSec, seed: status.seed, actualPrompt: status.actualPrompt },
      lastUsd: usd,
    },
    "CHECK",
  );
}

function failedGeneration(state: JobState, usd: number, message: string): AutomationHandlerOutcome {
  // The provider's own wording stays in the log; the owner gets a plain sentence.
  logger.warn("shorts_generation_failed", { attempt: state.attempt, message });
  if (state.attempt >= MAX_ATTEMPTS) throw new Error("영상을 만들지 못했어요. 이용권은 돌려드렸어요. 요청 내용을 조금 바꿔 다시 시도해주세요.");
  return deferred(nextAttempt(state, "failed", usd, message), "SUBMIT");
}

async function check(ctx: AutomationRunContext, state: JobState): Promise<AutomationHandlerOutcome> {
  if (!state.generated) return deferred({ ...state, wan: undefined }, "SUBMIT");
  const post = postprocessFor();
  if (!state.analysisJob) {
    const job = await post.startAnalyze(state.generated.videoUrl, QA_FRAMES);
    return deferred({ ...state, analysisJob: job }, "CHECK");
  }
  const polled = await post.getAnalysis(state.analysisJob);
  if (polled.state === "pending") return deferred(state, "CHECK");
  if (polled.state === "failed") {
    const tries = state.workerTries + 1;
    if (polled.lost || tries < MAX_WORKER_TRIES) return deferred({ ...state, analysisJob: undefined, workerTries: tries }, "CHECK");
    // The measurements are unavailable: the video is not thrown away (it is paid for), but nobody has checked it automatically.
    return deferred({ ...state, analysisJob: undefined, notes: [...state.notes, "자동 품질 점검을 하지 못했어요. 영상을 직접 꼼꼼히 확인해 주세요."], needsVoice: false, workerTries: 0 }, state.voiceMode === "tts" ? "VOICE" : "FINISH");
  }

  const analysis: VideoAnalysis = polled.result;
  const deterministic = evaluateAnalysis({ analysis, expectedSeconds: state.durationSec, voiceMode: state.voiceMode });
  const aiNotes: string[] = [];
  let ai = null;
  if (analysis.frames.length > 0) {
    try {
      ai = await scoped(ctx, state.attempt, () =>
        generateStructured({
          ...buildAiQaPrompt({ plan: state.plan, durationSec: state.durationSec, referenceNotes: referenceNotes(state), frameTimes: analysis.frames.map((frame) => frame.atSec) }),
          schema: aiQaSchema,
          maxTokens: 4_000,
          images: analysis.frames.map((frame) => ({ mediaType: "image/jpeg" as const, base64: frame.base64 })),
          role: "vision",
          effort: "medium",
          purpose: "video.qa",
        }),
      );
    } catch (error) {
      // The automatic checks above still ran; a human looks at the video in any case.
      logger.warn("shorts_ai_qa_failed", { runId: ctx.runId, message: error instanceof Error ? error.message : String(error) });
      aiNotes.push("AI 화면 점검을 하지 못했어요. 영상을 직접 꼼꼼히 확인해 주세요.");
    }
  }
  const report: QaReport = combineQa({
    deterministic: deterministic.findings,
    ai,
    prompt: [...promptFindings(state.generated.actualPrompt, state.voiceMode)],
  });
  const notes = [...state.notes, ...aiNotes];
  const aiCalls = state.aiCalls + (ai ? 1 : 0);

  if (report.status === "REJECTED") {
    const reasons = report.findings.filter((finding) => finding.severity === "reject").map((finding) => finding.message);
    if (state.attempt >= MAX_ATTEMPTS) {
      throw new Error(`만든 영상이 품질 점검을 통과하지 못했어요. (${reasons.slice(0, 3).join(" / ")}) 요청 내용을 조금 바꿔 다시 시도해주세요.`);
    }
    return deferred(nextAttempt({ ...state, notes, aiCalls }, "rejected", state.lastUsd, reasons.join(" / "), retryNoteFrom(report)), "SUBMIT");
  }

  const needsVoice = state.voiceMode === "tts" || deterministic.needsVoiceFallback;
  return deferred(
    {
      ...state,
      qa: report as unknown as Record<string, unknown>,
      attempts: [...state.attempts, { attempt: state.attempt, outcome: "accepted" as const, usd: state.lastUsd, note: "" }],
      analysis: { hasAudio: analysis.probe.hasAudio, durationSec: analysis.probe.durationSec },
      analysisJob: undefined,
      needsVoice,
      notes,
      aiCalls,
      workerTries: 0,
    },
    needsVoice ? "VOICE" : "FINISH",
  );
}

/** What the AI saw in the owner's photos, so the QA can judge label and packaging fidelity. */
function referenceNotes(state: JobState): string[] {
  return assetsOfKind(state.assets, "image").flatMap((asset) => (asset.summary ? [asset.summary] : []));
}

async function voice(ctx: AutomationRunContext, state: JobState): Promise<AutomationHandlerOutcome> {
  const tts = getTtsProvider();
  const text = state.plan.narration;
  const admin = createAdminClient();
  await ensureShortsBuckets(admin);
  try {
    const synth = () => tts.synthesize(text);
    const result = tts.name === "mock"
      ? await synth()
      : await scoped(ctx, state.attempt, () =>
        runPaidCall({
          kind: "VIDEO",
          runId: ctx.runId,
          step: "video.tts",
          attempt: state.attempt,
          provider: "elevenlabs",
          model: serverEnv.TTS_MODEL_ID,
          reserveUsd: ttsUsd(text.length, serverEnv.TTS_USD_PER_1K_CHARS),
          idempotencyKey: `${ctx.runId}:tts:${state.attempt}`,
          run: async () => {
            const spoken = await synth();
            return { value: spoken, actualUsd: ttsUsd(spoken.characters, serverEnv.TTS_USD_PER_1K_CHARS), usage: { characters: spoken.characters } };
          },
          // A rejected request (bad key, bad voice) was not billed; a timeout may have been.
          onError: (error) => (isAppError(error) && UNBILLED_SUBMIT_CODES.has(error.code) ? "release" : undefined),
        }),
      );
    const path = videoStoragePath(ctx.automation.user_id, ctx.automation.id, ctx.runId, `voice-${state.attempt}.mp3`);
    const { error } = await admin.storage.from(VIDEO_BUCKET).upload(path, result.audio, { contentType: "audio/mpeg", upsert: true });
    if (error) throw new Error("음성 파일을 저장하지 못했어요.", { cause: error });
    return deferred({ ...state, voice: { path, characters: result.characters } }, "FINISH");
  } catch (error) {
    logger.warn("shorts_voice_failed", { runId: ctx.runId, message: error instanceof Error ? error.message : String(error) });
    const own = state.analysis?.hasAudio;
    return deferred(
      { ...state, notes: [...state.notes, own ? "한국어 음성을 입히지 못해서 영상 자체의 소리를 그대로 썼어요." : "한국어 음성을 입히지 못했어요. 소리 없는 영상이니 확인해 주세요."] },
      "FINISH",
    );
  }
}

function overlaysFor(ctx: AutomationRunContext, state: JobState, urls: { logo?: string; inserts: Map<number, string> }): ComposeOverlay[] {
  const overlays: ComposeOverlay[] = [];
  if (urls.logo && state.plan.logo.show) overlays.push({ kind: "image", url: urls.logo, position: state.plan.logo.position, widthPct: 0.2 });
  else overlays.push({ kind: "text", text: ctx.business.name, position: "top-left", fontSizePx: 34 });
  for (const insert of state.plan.inserts) {
    const url = urls.inserts.get(insert.imageIndex);
    if (url) overlays.push({ kind: "image", url, position: "center", widthPct: 0.82, startSec: insert.startSec, endSec: insert.endSec });
  }
  overlays.push({ kind: "text", text: state.plan.cta.text, position: "bottom", fontSizePx: 46, startSec: state.plan.cta.startSec, endSec: state.durationSec });
  return overlays;
}

async function finish(ctx: AutomationRunContext, state: JobState): Promise<AutomationHandlerOutcome> {
  if (!state.generated) return deferred({ ...state, wan: undefined }, "SUBMIT");
  const post = postprocessFor();
  const admin = createAdminClient();
  const finalPath = videoStoragePath(ctx.automation.user_id, ctx.automation.id, ctx.runId, "final.mp4");

  if (!state.composeJob) {
    await ensureShortsBuckets(admin);
    const images = assetsOfKind(state.assets, "image");
    const logoAsset = assetsOfKind(state.assets, "logo")[0];
    // resolveAssetUrls refuses a path outside this automation's own folder: config is owner-writable through RLS.
    const logo = logoAsset && logoAsset.origin === "upload" ? (await resolveAssetUrls(admin, [logoAsset], owner(ctx)))[0] : undefined;
    const inserts = new Map<number, string>();
    for (const insert of state.plan.inserts) {
      const asset = images[insert.imageIndex - 1];
      if (asset?.origin === "upload" && asset.role === "exact") inserts.set(insert.imageIndex, (await resolveAssetUrls(admin, [asset], owner(ctx)))[0]);
    }
    const { data: upload, error: uploadError } = await admin.storage.from(VIDEO_BUCKET).createSignedUploadUrl(finalPath, { upsert: true });
    if (uploadError || !upload) throw new Error("영상을 저장할 주소를 만들지 못했어요.", { cause: uploadError });
    const hasOwnAudio = state.analysis?.hasAudio ?? true;
    const job = await post.startCompose({
      videoUrl: state.generated.videoUrl,
      voiceUrl: state.voice ? await signAsset(admin, VIDEO_BUCKET, state.voice.path) : undefined,
      audioMode: state.voice ? (hasOwnAudio ? "mix" : "voice_only") : "native",
      overlays: overlaysFor(ctx, state, { logo, inserts }),
      uploadUrl: upload.signedUrl,
      target: { width: 720, height: 1280, fps: 30 },
    });
    return deferred({ ...state, composeJob: job }, "FINISH");
  }

  const polled = await post.getCompose(state.composeJob);
  if (polled.state === "pending") return deferred(state, "FINISH");
  if (polled.state === "failed") {
    const tries = state.workerTries + 1;
    if (tries >= MAX_WORKER_TRIES) throw new Error("영상 마무리 작업에 실패했어요. 잠시 후 다시 시도해주세요.");
    return deferred({ ...state, composeJob: undefined, workerTries: tries }, "FINISH");
  }

  return complete(ctx, state, finalPath);
}

function sceneTextOf(scene: AdPlan["storyboard"][number], hook: string): string {
  return (scene.narration || (scene.startSec === 0 ? hook : scene.visual.slice(0, 90))).slice(0, 180);
}

function captionFor(plan: AdPlan, publishing: ShortsPublishing | undefined, businessName: string): string {
  const tags = (publishing?.hashtags ?? []).map((tag) => `#${tag.replace(/^#/, "")}`);
  const filler = [`#${businessName.replace(/[^\p{L}\p{N}_]/gu, "")}`, "#광고", "#숏폼"].filter((tag) => tag.length > 1);
  const all = [...new Set([...tags, ...filler])].slice(0, 8);
  return `${plan.message.slice(0, 200)}\n${all.join(" ")}`.slice(0, 1_000);
}

async function complete(ctx: AutomationRunContext, state: JobState, finalPath: string): Promise<AutomationHandlerResult> {
  const admin = createAdminClient();
  const sample = getWanProvider().name === "mock";
  const videoUrl = sample ? state.generated!.videoUrl : await signAsset(admin, VIDEO_BUCKET, finalPath, VIDEO_URL_TTL_SEC);
  const content: ShortsContent = {
    hook: state.plan.hook.text.slice(0, 120),
    script: state.plan.narration,
    scenes: state.plan.storyboard.map((scene) => ({ text: sceneTextOf(scene, state.plan.hook.text), visualPrompt: scene.visual.slice(0, 500), durationSec: Math.max(0.5, Math.round((scene.endSec - scene.startSec) * 10) / 10) })),
    caption: captionFor(state.plan, state.publishing, ctx.business.name),
    privacy: "private",
  };
  const qa = state.qa ?? { status: "NEEDS_HUMAN_CHECK", findings: [], summary: "", aiChecked: false };
  const spend = await summarizeRunSpend(ctx.runId).catch(() => null);
  const wanAttempts = state.attempts.filter((item) => item.outcome !== "lost").length || 1;

  return {
    output: {
      ...content,
      topic: state.topic,
      format: "ad",
      durationSec: state.durationSec,
      voiceMode: state.voiceMode,
      voiceFallback: state.needsVoice && state.voiceMode === "native",
      ...(sample ? { videoUrl, sampleVideo: true } : { videoPath: finalPath, videoUrl }),
      ...(state.publishing ? { publishing: state.publishing } : {}),
      concept: state.plan.concept,
      references: summarizeUsedReferences(state.assets),
      qa: { ...qa, notes: state.notes.slice(0, 8) },
      generation: {
        pipeline: "wan3-v1",
        model: serverEnv.WAN_MODEL,
        resolution: WAN_RESOLUTION,
        attempts: state.attempts,
        referenceVideoSeconds: state.referenceVideoSeconds,
        seed: state.generated?.seed ?? null,
        actualPrompt: state.generated?.actualPrompt ?? null,
        ...(spend && spend.steps.length > 0 ? { costUsd: spend.totalUsd, steps: spend.steps } : {}),
      },
    } as unknown as Json,
    externalUrl: undefined,
    title: content.hook,
    topic: state.topic,
    content: content.script,
    contentType: "shorts",
    aiGenerationCount: Math.max(1, state.aiCalls),
    externalApiCallCount: wanAttempts + (state.voice ? 1 : 0),
  };
}

async function resumeRun(ctx: AutomationRunContext, raw: Json): Promise<AutomationHandlerOutcome> {
  const parsed = jobStateSchema.safeParse(raw);
  if (!parsed.success) throw new Error("진행 중인 숏폼 작업 정보를 읽지 못했어요. 영상을 다시 만들어주세요.");
  const state = parsed.data;
  if (Date.now() - Date.parse(state.startedAt) > MAX_JOB_MINUTES * 60_000) {
    // Money already booked stays booked; the run ends and the credit is returned.
    throw new Error("영상 만들기가 너무 오래 걸려 중단했어요. 잠시 후 다시 시도해주세요.");
  }
  switch (state.stage) {
    case "SUBMIT": return submit(ctx, state);
    case "WAIT": return wait(ctx, state);
    case "CHECK": return check(ctx, state);
    case "VOICE": return voice(ctx, state);
    case "FINISH": return finish(ctx, state);
  }
}

export const shortsAutomationHandler: AutomationHandler = {
  templateSlug: "shorts",

  /** Real video generation, or any real AI call, draws on the video budget. */
  metered() {
    return isRealVideoGeneration() || serverEnv.AI_PROVIDER !== "mock" ? "VIDEO" : null;
  },

  preflight(ctx) {
    const base = "영상 제작 서비스가 아직 연결되지 않아 지금은 광고 영상을 만들 수 없어요. 이용권은 차감되지 않았어요. 관리자에게 문의해주세요.";
    // Which setting is missing goes to the log (names only); the owner just gets the plain sentence.
    const refuse = () => {
      logger.warn("shorts_pipeline_not_ready", { missing: missingVideoRequirements() });
      return base;
    };
    // Without a real generator a production run would "succeed" with a placeholder instead of a video.
    if (process.env.NODE_ENV === "production" && !isRealVideoGeneration()) return refuse();
    if (isRealVideoGeneration()) {
      if (serverEnv.AI_PROVIDER !== "anthropic" || !serverEnv.FAL_KEY) return refuse();
      if (serverEnv.POSTPROCESS_PROVIDER !== "worker" || !serverEnv.POSTPROCESS_WORKER_URL || !serverEnv.POSTPROCESS_WORKER_TOKEN) return refuse();
      // A Korean voice the owner asked for needs the voice service; without it the run would only produce the silent kind.
      if (parseShortsSettings(ctx.config).voiceMode === "tts" && (serverEnv.TTS_PROVIDER !== "elevenlabs" || !serverEnv.ELEVENLABS_API_KEY || !serverEnv.TTS_VOICE_ID)) {
        return "한국어 음성 서비스가 아직 연결되지 않아 음성을 입힌 영상은 지금 만들 수 없어요. '영상 자체 목소리'로 바꾸거나 관리자에게 문의해주세요. 이용권은 차감되지 않았어요.";
      }
    }
    return null;
  },

  async run(ctx: AutomationRunContext): Promise<AutomationHandlerOutcome> {
    return startRun(ctx);
  },

  async resume(ctx: AutomationRunContext, state: Json): Promise<AutomationHandlerOutcome> {
    return resumeRun(ctx, state);
  },
};
