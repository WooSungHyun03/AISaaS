import { z } from "zod";

/** What the worker's ffprobe says about a media file. */
export const mediaProbeSchema = z.object({
  durationSec: z.number().min(0),
  sizeBytes: z.number().min(0),
  formatName: z.string().default(""),
  hasVideo: z.boolean(),
  hasAudio: z.boolean(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  fps: z.number().nullable(),
  videoCodec: z.string().nullable(),
  audioCodec: z.string().nullable(),
  pixelFormat: z.string().nullable().optional(),
});
export type MediaProbe = z.infer<typeof mediaProbeSchema>;

const span = z.object({ start: z.number(), end: z.number() });

/** Measurements of a generated video; judging them is the QA module's job. */
export const videoAnalysisSchema = z.object({
  probe: mediaProbeSchema,
  black: z.object({ seconds: z.number(), spans: z.array(span) }),
  frozen: z.object({ seconds: z.number(), spans: z.array(span) }),
  audio: z
    .object({
      meanVolumeDb: z.number().nullable(),
      maxVolumeDb: z.number().nullable(),
      silentSeconds: z.number(),
      silentRatio: z.number(),
      clippedSamples: z.number(),
    })
    .nullable(),
  frames: z.array(z.object({ atSec: z.number(), base64: z.string() })).default([]),
});
export type VideoAnalysis = z.infer<typeof videoAnalysisSchema>;

export const OVERLAY_POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right", "top", "center", "bottom"] as const;
export type OverlayPosition = (typeof OVERLAY_POSITIONS)[number];

export type ComposeOverlay =
  | { kind: "image"; url: string; position: OverlayPosition; widthPct?: number; startSec?: number; endSec?: number }
  | { kind: "text"; text: string; position: OverlayPosition; fontSizePx?: number; color?: string; startSec?: number; endSec?: number };

export interface ComposeSpec {
  videoUrl: string;
  /** Korean narration to mix in (the voice fallback). */
  voiceUrl?: string;
  /** native = keep the video's own sound; mix = narration over the sound with ducking; voice_only = narration replaces it. */
  audioMode: "native" | "mix" | "voice_only";
  overlays: ComposeOverlay[];
  /** A signed URL the worker PUTs the finished MP4 to. */
  uploadUrl: string;
  target?: { width: number; height: number; fps: number };
}

export const jobHandleSchema = z.object({ jobId: z.string().min(1).max(100) });
export type PostprocessJobHandle = z.infer<typeof jobHandleSchema>;

export type PostprocessJobStatus<T> =
  | { state: "pending" }
  | { state: "done"; result: T }
  /** `lost`: the worker no longer knows the job (it restarted). Nothing was paid for, so the job can simply be sent again. */
  | { state: "failed"; message: string; lost?: boolean };

export interface PostprocessProvider {
  readonly name: "mock" | "worker";
  probe(url: string): Promise<MediaProbe>;
  startAnalyze(videoUrl: string, frames: number): Promise<PostprocessJobHandle>;
  getAnalysis(handle: PostprocessJobHandle): Promise<PostprocessJobStatus<VideoAnalysis>>;
  startCompose(spec: ComposeSpec): Promise<PostprocessJobHandle>;
  getCompose(handle: PostprocessJobHandle): Promise<PostprocessJobStatus<{ probe: MediaProbe }>>;
}
