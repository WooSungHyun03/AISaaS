import { z } from "zod";

export const shortsSceneSchema = z.object({
  text: z.string().trim().min(1).max(180),
  visualPrompt: z.string().trim().min(1).max(500),
  durationSec: z.number().finite().min(0.5).max(30),
});

/**
 * What a finished ad Short is described by in a run's output (hook, script, scenes, caption): the shape the preview,
 * the history and the publishing step read. Older runs (character Shorts) share it.
 */
export const shortsContentSchema = z
  .object({
    hook: z.string().trim().min(1).max(120),
    script: z.string().trim().min(1).max(1_200),
    scenes: z.array(shortsSceneSchema).min(4).max(10),
    caption: z
      .string()
      .trim()
      .min(1)
      .max(1_000)
      .refine((caption) => (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length >= 3, "caption에는 해시태그가 3개 이상 포함되어야 합니다."),
    privacy: z.enum(["private", "unlisted", "public"]),
  })
  .superRefine((content, ctx) => {
    const totalDuration = content.scenes.reduce((total, scene) => total + scene.durationSec, 0);
    if (totalDuration < 15 || totalDuration > 45) {
      ctx.addIssue({ code: "custom", path: ["scenes"], message: "장면 길이의 합은 15초 이상 45초 이하여야 합니다." });
    }
  });
export type ShortsContent = z.infer<typeof shortsContentSchema>;
