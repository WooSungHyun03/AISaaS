import { z } from "zod";

export const videoRenderSceneSchema = z.object({
  text: z.string().trim().min(1).max(180),
  visualPrompt: z.string().trim().min(1).max(500),
  durationSec: z.number().finite().min(1).max(15),
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
