import type { SubscriptionPlan } from "@/types/domain";
import type { PlanConfig } from "@/types/billing";

/**
 * 화면에 보이는 요금제 이름과 설명. 가격·한도 숫자는 server/billing/plans.ts 가 기준이고,
 * 여기서는 서비스 언어(한국어)로 풀어 쓴 문구만 다룹니다.
 */
export const PLAN_LABEL: Record<SubscriptionPlan, string> = {
  FREE: "무료",
  STARTER: "스타터",
  PRO: "프로",
};

export const PLAN_TAGLINE: Record<SubscriptionPlan, string> = {
  FREE: "마케팅 진단과 캘린더를 먼저 써보고 싶을 때",
  STARTER: "블로그와 숏폼을 꾸준히 만들고 싶을 때",
  PRO: "여러 채널을 자주, 많이 만들어야 할 때",
};

export function planFeatures(plan: PlanConfig): string[] {
  const makes = plan.automationLimit === null ? "만들기 설정 무제한" : `만들기 설정 ${plan.automationLimit}개`;
  const runs = plan.monthlyRunLimit === null ? "한 달 제작 횟수 무제한" : `한 달 ${plan.monthlyRunLimit.toLocaleString()}회 제작`;
  const common = ["마케팅 진단 · 마케팅 캘린더", makes, runs];
  if (plan.id === "FREE") return [...common, "블로그 글 만들기 체험"];
  if (plan.id === "STARTER") return [...common, "블로그 글 · 숏폼 만들기", "정해둔 때마다 자동으로 만들기", "제작 기록 보기"];
  return [...common, "블로그 글 · 숏폼 만들기", "정해둔 때마다 자동으로 만들기", "우선 처리", "제작 기록 오래 보관"];
}
