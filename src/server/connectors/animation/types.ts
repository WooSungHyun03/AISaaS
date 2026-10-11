import { z } from "zod";

/** Every clip is a fixed 5 seconds: it is the shortest length the image-to-video models bill and offer. */
export const ANIMATION_CLIP_SECONDS = 5;

export const animationClipRequestSchema = z.object({
  /** HTTPS URL of the 9:16 still the clip starts from. */
  imageUrl: z.string().url().refine((value) => value.startsWith("https://"), "HTTPS 이미지 주소만 사용할 수 있습니다."),
  /** What the character does, in English (the models follow English prompts best). */
  prompt: z.string().trim().min(1).max(600),
});
export type AnimationClipRequest = z.infer<typeof animationClipRequestSchema>;

/** Opaque, JSON-serialisable pointer to a queued clip; stored in the run's job state between polls. */
export const animationClipHandleSchema = z.object({
  requestId: z.string().min(1).max(200),
  statusUrl: z.string().url().max(1_000),
  responseUrl: z.string().url().max(1_000),
});
export type AnimationClipHandle = z.infer<typeof animationClipHandleSchema>;

export type AnimationClipStatus =
  | { state: "pending" }
  | { state: "done"; videoUrl: string }
  | { state: "failed"; message: string };

export type AnimationQuality = "standard" | "premium";

export interface AnimationClipOptions {
  /** `premium` uses the stronger (pricier) model when one is configured. */
  quality?: AnimationQuality;
}

export const musicRequestSchema = z.object({
  /** English description of the background music: mood, instruments, tempo. Always instrumental. */
  prompt: z.string().trim().min(1).max(400),
});
export type MusicRequest = z.infer<typeof musicRequestSchema>;

export type MusicStatus =
  | { state: "pending" }
  | { state: "done"; audioUrl: string }
  | { state: "failed"; message: string };

export interface AnimationProvider {
  readonly name: "mock" | "fal";
  /** Queues one clip and returns immediately. */
  startClip(request: AnimationClipRequest, options?: AnimationClipOptions): Promise<AnimationClipHandle>;
  /** One quick status check; never waits for the clip. */
  getClip(handle: AnimationClipHandle): Promise<AnimationClipStatus>;
  /** Queues an instrumental background track (same queue and key as the clips). */
  startMusic(request: MusicRequest): Promise<AnimationClipHandle>;
  getMusic(handle: AnimationClipHandle): Promise<MusicStatus>;
}
