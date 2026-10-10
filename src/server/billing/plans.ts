import type { PlanConfig } from "@/types/billing";
import type { SubscriptionPlan } from "@/types/domain";

/**
 * Single source of truth for plan pricing and limits. Never hard-code a
 * price or limit anywhere else — read it from here (getPlanConfig) so
 * changing a number doesn't require touching business logic.
 */
export const PLAN_CONFIGS: Record<SubscriptionPlan, PlanConfig> = {
  FREE: {
    id: "FREE",
    name: "Free",
    priceMonthlyKrw: 0,
    automationLimit: 1,
    monthlyRunLimit: 3,
    monthlyBlogLimit: 1,
    monthlyShortsLimit: 0,
    monthlyAnimatedShortsLimit: 0,
    allowedTemplateSlugs: ["blog-marketing"],
    features: [
      "마케팅 진단 · 마케팅 캘린더",
      "사업체 프로필 등록",
      "블로그 글 월 1건 체험",
    ],
  },
  STARTER: {
    id: "STARTER",
    name: "Starter",
    priceMonthlyKrw: 19000,
    automationLimit: 2,
    monthlyRunLimit: 30,
    monthlyBlogLimit: 8,
    monthlyShortsLimit: 4,
    monthlyAnimatedShortsLimit: 2,
    allowedTemplateSlugs: null,
    features: [
      "블로그 글 월 8건 · 숏폼 영상 월 4건",
      "움직이는 캐릭터 영상 월 2건 포함",
      "정해둔 때마다 자동으로 만들기",
      "제작 기록 보기",
    ],
  },
  PRO: {
    id: "PRO",
    name: "Pro",
    priceMonthlyKrw: 49000,
    automationLimit: 10,
    monthlyRunLimit: 300,
    monthlyBlogLimit: 30,
    monthlyShortsLimit: 12,
    monthlyAnimatedShortsLimit: 6,
    allowedTemplateSlugs: null,
    features: [
      "블로그 글 월 30건 · 숏폼 영상 월 12건",
      "움직이는 캐릭터 영상 월 6건 포함",
      "정해둔 때마다 자동으로 만들기",
      "우선 처리",
    ],
  },
};

/** Plan names as shown to users. `PlanConfig.name` stays the English id-like name used in code and logs. */
export const PLAN_LABEL: Record<SubscriptionPlan, string> = { FREE: "무료", STARTER: "스타터", PRO: "프로" };

export function getPlanConfig(plan: SubscriptionPlan): PlanConfig {
  return PLAN_CONFIGS[plan];
}

export const ALL_PLANS: PlanConfig[] = [PLAN_CONFIGS.FREE, PLAN_CONFIGS.STARTER, PLAN_CONFIGS.PRO];
