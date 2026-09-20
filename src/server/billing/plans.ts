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
    allowedTemplateSlugs: ["blog-marketing"],
    features: [
      "AI 툴 디렉토리 & 자동화 가이드 열람",
      "사업체 프로필 등록",
      "자동화 1개 생성 (블로그 마케팅)",
      "월 3회 실행 체험",
    ],
  },
  STARTER: {
    id: "STARTER",
    name: "Starter",
    priceMonthlyKrw: 19000,
    automationLimit: 2,
    monthlyRunLimit: 30,
    allowedTemplateSlugs: null,
    features: [
      "자동화 최대 2개",
      "월 30회 실행",
      "예약 자동 실행 (스케줄링)",
      "실행 히스토리 조회",
    ],
  },
  PRO: {
    id: "PRO",
    name: "Pro",
    priceMonthlyKrw: 49000,
    automationLimit: 10,
    monthlyRunLimit: 300,
    allowedTemplateSlugs: null,
    features: [
      "자동화 최대 10개",
      "월 300회 실행",
      "우선 처리",
      "긴 보관 기간의 실행 히스토리",
    ],
  },
};

export function getPlanConfig(plan: SubscriptionPlan): PlanConfig {
  return PLAN_CONFIGS[plan];
}

export const ALL_PLANS: PlanConfig[] = [PLAN_CONFIGS.FREE, PLAN_CONFIGS.STARTER, PLAN_CONFIGS.PRO];
