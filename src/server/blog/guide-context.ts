import type { Business } from "@/types/domain";
import type { BlogAutomationConfig } from "@/types/blog-automation";
import { resolvePromotionType } from "@/server/promotion/strategy";
import type { BlogGuideContext } from "./publishing-guide";

type BusinessForGuide = Pick<Business, "name" | "industry" | "location" | "brand_tone" | "keywords" | "promotion_type">;

/** The facts the guide is built around: the profile, the post's setup and the images the owner already uploaded. */
export function blogGuideContext(
  business: BusinessForGuide,
  config: Pick<BlogAutomationConfig, "platform" | "keywords"> | undefined,
  ownedImages: BlogGuideContext["ownedImages"] = [],
): BlogGuideContext {
  return {
    platform: config?.platform ?? "naver",
    promotionType: resolvePromotionType(business),
    businessName: business.name,
    industry: business.industry ?? null,
    location: business.location ?? null,
    tone: business.brand_tone ?? null,
    keywords: [...new Set([...(config?.keywords ?? []), ...business.keywords])].slice(0, 16),
    ownedImages,
  };
}
