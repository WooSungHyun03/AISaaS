import { z } from "zod";

/**
 * Posts are written for the owner to review and post by hand ("app_draft"). Older automations were saved with
 * WordPress delivery modes; whatever an old row says, it now reads as "app_draft" and any stored WordPress
 * settings are ignored.
 */
export const blogDeliveryModes = ["app_draft"] as const;

/** Where the owner will paste the post: it decides the style and the HTML flavour. */
export const blogPlatforms = ["naver", "tistory"] as const;
export const BLOG_NOTES_MAX_LENGTH = 600;

export const blogSetupSchema = z.object({
  objective: z.string().trim().min(3, "게시 목적을 입력해주세요.").max(300),
  keywords: z.array(z.string().trim().min(1).max(60)).min(1, "키워드를 하나 이상 입력해주세요.").max(12),
  tone: z.string().trim().min(2, "글의 톤을 입력해주세요.").max(100),
  deliveryMode: z.string().optional().transform(() => "app_draft" as const),
  /** Older automations have none and are treated as Naver. */
  platform: z.enum(blogPlatforms).optional(),
  /** Real details the owner wants in every post (signature menu, a story, an event); the only place invented-looking specifics may come from. */
  notes: z.string().trim().max(BLOG_NOTES_MAX_LENGTH).optional(),
});

export type BlogAutomationConfig = z.infer<typeof blogSetupSchema>;

export const BLOG_DELIVERY_LABEL: Record<(typeof blogDeliveryModes)[number], string> = {
  app_draft: "앱에 초안 저장",
};
