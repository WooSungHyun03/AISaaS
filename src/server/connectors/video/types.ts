import { z } from "zod";

/** How the reference-image character moves while it talks when it is only tweened (see json2video-skit.ts). */
export const VIDEO_MOTIONS = ["pop", "bounce", "wobble", "shake", "slide", "zoom"] as const;
export type VideoMotion = (typeof VIDEO_MOTIONS)[number];

/** `main` is the on-screen character; `partner` is the other voice it talks with. */
export const VIDEO_SPEAKERS = ["main", "partner"] as const;
export type VideoSpeaker = (typeof VIDEO_SPEAKERS)[number];

const httpsUrl = (message: string) => z.string().url().max(2_000).refine((value) => value.startsWith("https://"), message);

/** One scene of a character video: a spoken line over the character's clip (or still image). */
export const videoRenderSceneSchema = z.object({
  text: z.string().trim().min(1).max(180),
  visualPrompt: z.string().trim().min(1).max(500),
  durationSec: z.number().finite().min(1).max(15),
  /** HTTPS URL of the reference image shown in this scene when it is only tweened. */
  imageUrl: httpsUrl("HTTPS 이미지 주소만 사용할 수 있습니다.").optional(),
  /** HTTPS URL of the animated clip for this scene (it replaces the still image). */
  videoUrl: httpsUrl("HTTPS 영상 주소만 사용할 수 있습니다.").optional(),
  speaker: z.enum(VIDEO_SPEAKERS).optional(),
  motion: z.enum(VIDEO_MOTIONS).optional(),
});

export type VideoRenderScene = z.infer<typeof videoRenderSceneSchema>;

/** One quick look at a render that was started earlier; never waits. */
export type VideoRenderStatus =
  | { state: "pending" }
  | { state: "done"; videoUrl: string }
  | { state: "failed"; message: string };

export interface VideoRenderProvider {
  readonly name: "mock" | "json2video";
  /** Starts a full movie JSON render and returns its project id immediately. */
  startMovie(movie: Record<string, unknown>): Promise<string>;
  getMovieStatus(projectId: string): Promise<VideoRenderStatus>;
}
