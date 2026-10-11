import { z } from "zod";

/**
 * "app_draft" is the only mode a *new* blog automation can be created with
 * (see createAutomation in src/app/(app)/automations/actions.ts — it
 * rejects any other value). "wordpress_draft"/"wordpress_publish" are
 * DEPRECATED for new automations but kept here, not deleted, for
 * automations that already use WordPress delivery: editing one
 * (updateAutomation / automation-settings-dialog.tsx) and running one
 * (handlers/blog.ts's publish() path) both still work.
 */
export const blogDeliveryModes = ["app_draft", "wordpress_draft", "wordpress_publish"] as const;

/** Where the owner will paste the post: it decides the style and the HTML flavour. */
export const blogPlatforms = ["naver", "tistory"] as const;
export const BLOG_NOTES_MAX_LENGTH = 600;

export const blogSetupSchema = z.object({
  objective: z.string().trim().min(3, "게시 목적을 입력해주세요.").max(300),
  keywords: z.array(z.string().trim().min(1).max(60)).min(1, "키워드를 하나 이상 입력해주세요.").max(12),
  tone: z.string().trim().min(2, "글의 톤을 입력해주세요.").max(100),
  deliveryMode: z.enum(blogDeliveryModes),
  /** Older automations have none and are treated as Naver. */
  platform: z.enum(blogPlatforms).optional(),
  /** Real details the owner wants in every post (signature menu, a story, an event); the only place invented-looking specifics may come from. */
  notes: z.string().trim().max(BLOG_NOTES_MAX_LENGTH).optional(),
});

export interface BlogAutomationConfig extends z.infer<typeof blogSetupSchema> {
  wordpress?: {
    siteUrl: string;
    username: string;
    encryptedAppPassword: string;
  };
}

export const BLOG_DELIVERY_LABEL: Record<(typeof blogDeliveryModes)[number], string> = {
  app_draft: "앱에 초안 저장",
  wordpress_draft: "WordPress에 초안 저장",
  wordpress_publish: "WordPress에 바로 발행",
};
