import type { PlanConfig } from "@/types/billing";
import type { SubscriptionPlan } from "@/types/domain";

/**
 * Single source of truth for plan pricing and limits. Never hard-code a
 * price or limit anywhere else — read it from here (getPlanConfig) so
 * changing a number doesn't require touching business logic.
 */
/**
 * Generation is paid per use (credits), so the number of saved setups is no longer a way to meter a plan: a free
 * account needs one blog and one Shorts setup per business to use its trial. This only guards against runaway setups.
 */
export const AUTOMATION_SETUP_LIMIT = 30;

export const PLAN_CONFIGS: Record<SubscriptionPlan, PlanConfig> = {
  FREE: {
    id: "FREE",
    name: "Free",
    priceMonthlyKrw: 0,
    automationLimit: AUTOMATION_SETUP_LIMIT,
    animationQuality: "standard",
    allowedTemplateSlugs: null,
    features: [
      "마케팅 진단 · 마케팅 캘린더",
      "사업체 프로필 등록",
      "가입 시 블로그·숏폼 체험 이용권",
    ],
  },
  STARTER: {
    id: "STARTER",
    name: "Starter",
    priceMonthlyKrw: 19000,
    automationLimit: AUTOMATION_SETUP_LIMIT,
    animationQuality: "standard",
    allowedTemplateSlugs: null,
    features: [
      "구매한 블로그·숏폼 이용권만큼 제작",
      "움직이는 영상(캐릭터·상품) 지원",
      "정해둔 때마다 자동으로 만들기",
      "제작 기록 보기",
    ],
  },
  PRO: {
    id: "PRO",
    name: "Pro",
    priceMonthlyKrw: 49000,
    automationLimit: AUTOMATION_SETUP_LIMIT,
    animationQuality: "premium",
    allowedTemplateSlugs: null,
    features: [
      "구매한 블로그·숏폼 이용권만큼 제작",
      "움직이는 영상(캐릭터·상품) · 고화질 모델",
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
