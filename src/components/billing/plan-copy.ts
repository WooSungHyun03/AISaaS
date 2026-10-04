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

const quota = (limit: number | null, unit: string) => (limit === null ? "무제한" : limit === 0 ? "이용 불가" : `월 ${limit.toLocaleString()}${unit}`);

export function planFeatures(plan: PlanConfig): string[] {
  const features = [
    "마케팅 진단 · 마케팅 캘린더",
    `블로그 글 ${quota(plan.monthlyBlogLimit, "건")}`,
    `숏폼 영상 ${quota(plan.monthlyShortsLimit, "건")}`,
  ];
  if (plan.id === "FREE") return [...features, "블로그 글은 직접 확인하고 올려요"];
  features.push("정해둔 때마다 자동으로 만들기");
  features.push("제작 기록 보기");
  if (plan.id === "PRO") features.push("우선 처리");
  return features;
}
