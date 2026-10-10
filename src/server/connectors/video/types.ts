import { z } from "zod";

/** How the reference-image character moves while it talks (see json2video-skit.ts). */
export const VIDEO_MOTIONS = ["pop", "bounce", "wobble", "shake", "slide", "zoom"] as const;
export type VideoMotion = (typeof VIDEO_MOTIONS)[number];

/** `main` is the on-screen character; `partner` is the other voice it talks with. */
export const VIDEO_SPEAKERS = ["main", "partner"] as const;
export type VideoSpeaker = (typeof VIDEO_SPEAKERS)[number];

export const videoRenderSceneSchema = z.object({
  text: z.string().trim().min(1).max(180),
  visualPrompt: z.string().trim().min(1).max(500),
  durationSec: z.number().finite().min(1).max(15),
  /** HTTPS URL of the reference image shown in this scene (character mode only). */
  imageUrl: z.string().url().max(2_000).refine((value) => value.startsWith("https://"), "HTTPS 이미지 주소만 사용할 수 있습니다.").optional(),
  speaker: z.enum(VIDEO_SPEAKERS).optional(),
  motion: z.enum(VIDEO_MOTIONS).optional(),
});

export const videoRenderInputSchema = z
  .object({
    scenes: z.array(videoRenderSceneSchema).min(4).max(10),
    voiceScript: z.string().trim().min(1).max(1_200),
  })
  .superRefine((input, ctx) => {
    const durationSec = input.scenes.reduce((total, scene) => total + scene.durationSec, 0);
    if (durationSec < 15 || durationSec > 45) {
      ctx.addIssue({
        code: "custom",
        path: ["scenes"],
        message: "Shorts 렌더 길이는 15초 이상 45초 이하여야 합니다.",
      });
    }
  });

export type VideoRenderScene = z.infer<typeof videoRenderSceneSchema>;

export interface VideoRenderProvider {
  readonly name: "mock" | "json2video";
  renderShortVideo(scenes: VideoRenderScene[], voiceScript: string): Promise<string>;
}
