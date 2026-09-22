import { z } from "zod";

export const blogDeliveryModes = ["app_draft", "wordpress_draft", "wordpress_publish"] as const;

export const blogSetupSchema = z.object({
  objective: z.string().trim().min(3, "게시 목적을 입력해주세요.").max(300),
  keywords: z.array(z.string().trim().min(1).max(60)).min(1, "키워드를 하나 이상 입력해주세요.").max(12),
  tone: z.string().trim().min(2, "글의 톤을 입력해주세요.").max(100),
  deliveryMode: z.enum(blogDeliveryModes),
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
