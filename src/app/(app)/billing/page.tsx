import { ArrowDownRight, ArrowUpRight, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env/server";
import { ALL_PLANS, getPlanConfig } from "@/server/billing/plans";
import { getBillingOverview } from "@/server/billing/read-model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { PageHeader } from "@/components/layout/page-header";
import { PLAN_LABEL, planFeatures } from "@/components/billing/plan-copy";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { BillingSubmitButton } from "@/components/billing/billing-submit-button";
import { cancelSubscriptionAction, startCheckout } from "./actions";

const ACTIVE_STATUSES = new Set(["ACTIVE", "TRIALING"]);

function formatDate(value: string | null | undefined) {
  if (!value) return "결제 후 표시돼요";
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
}

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  const { plan: requestedPlan } = await searchParams;
  const selectedPlan = requestedPlan === "STARTER" || requestedPlan === "PRO" ? requestedPlan : null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { subscription, usage, automationCount } = await getBillingOverview(user.id);

  const hasActiveSubscription = subscription ? ACTIVE_STATUSES.has(subscription.status) : false;
  const plan = hasActiveSubscription ? subscription!.plan : "FREE";
  const planConfig = getPlanConfig(plan);
  const monthlyRuns = usage?.automation_runs ?? 0;
  const isPaid = plan !== "FREE";
  const isTestBilling = serverEnv.BILLING_PROVIDER === "mock" || serverEnv.TOSS_SECRET_KEY?.startsWith("test_");
  const providerLabel = serverEnv.BILLING_PROVIDER === "toss" ? "토스페이먼츠" : "모의 결제";

  return (
    <div className="mx-auto max-w-5xl space-y-10 pb-10">
      <PageHeader title="요금제·결제" description="지금 쓰는 요금제와 이번 달 사용량을 확인하고, 요금제를 바꾸거나 해지할 수 있어요." />

      {isTestBilling ? (
        <FormMessage variant="info"><strong>테스트 결제 환경이에요. 실제로 청구되지 않아요.</strong> 결제 제공자: {providerLabel}. 결제 흐름과 요금제 반영을 안전하게 확인할 수 있어요.</FormMessage>
      ) : null}

      {selectedPlan && selectedPlan !== plan ? (
        <div className="flex flex-col gap-4 rounded-2xl bg-brand-soft px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-extrabold tracking-[-0.02em]">{PLAN_LABEL[selectedPlan]} 요금제를 골랐어요</p>
            <p className="mt-1 text-sm text-muted-foreground tabular">
              월 {getPlanConfig(selectedPlan).priceMonthlyKrw.toLocaleString()}원 · 만들기 설정 {getPlanConfig(selectedPlan).automationLimit}개 · 월 {getPlanConfig(selectedPlan).monthlyRunLimit}회
            </p>
          </div>
          <form action={startCheckout.bind(null, selectedPlan)}>
            <BillingSubmitButton className="w-full sm:w-auto" pendingLabel="결제 준비 중…">
              결제 이어서 하기 <ArrowUpRight />
            </BillingSubmitButton>
          </form>
        </div>
      ) : null}

      <section aria-labelledby="current-plan-heading" className="space-y-4">
        <h2 id="current-plan-heading" className="text-lg font-extrabold tracking-[-0.03em]">지금 이용 중인 요금제</h2>
        <div className="grid gap-px overflow-hidden rounded-2xl border bg-border lg:grid-cols-[1.1fr_1fr]">
          <div className="bg-card px-6 py-6">
            <div className="flex items-center gap-3">
              <p className="text-3xl font-extrabold tracking-[-0.04em]">{PLAN_LABEL[plan]}</p>
              <Badge variant={hasActiveSubscription ? "success" : "secondary"}>{hasActiveSubscription ? "이용 중" : "기본"}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground tabular">{planConfig.priceMonthlyKrw === 0 ? "무료" : `월 ${planConfig.priceMonthlyKrw.toLocaleString()}원`}</p>
            <p className="mt-6 text-[13px] font-semibold text-muted-foreground">{isPaid ? "이용 기간 종료일" : "이용 기간"}</p>
            <p className="mt-1 font-bold">{isPaid ? formatDate(subscription?.current_period_end) : "무료 요금제는 끝나지 않아요"}</p>
          </div>
          <ul className="grid content-center gap-2.5 bg-card px-6 py-6 text-[15px]">
            {planFeatures(planConfig).map((feature) => (
              <li key={feature} className="flex items-start gap-2.5"><Check className="mt-1 size-4 shrink-0 text-success" aria-hidden="true" />{feature}</li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="usage-heading" className="space-y-4">
        <h2 id="usage-heading" className="text-lg font-extrabold tracking-[-0.03em]">이번 달 사용량</h2>
        <div className="grid gap-px overflow-hidden rounded-2xl border bg-border md:grid-cols-2">
          {[
            { label: "만들기 설정", value: automationCount, limit: planConfig.automationLimit, unit: "개" },
            { label: "이번 달 제작", value: monthlyRuns, limit: planConfig.monthlyRunLimit, unit: "회" },
          ].map((item) => (
            <div key={item.label} className="space-y-3 bg-card px-6 py-5">
              <p className="text-[13px] font-semibold text-muted-foreground">{item.label}</p>
              <p className="tabular flex items-baseline gap-1.5"><span className="text-3xl font-extrabold tracking-[-0.04em]">{item.value}</span><span className="text-sm text-muted-foreground">/ {item.limit ?? "무제한"}{item.limit ? item.unit : ""}</span></p>
              {item.limit ? <Progress value={Math.min(100, (item.value / item.limit) * 100)} aria-label={`${item.label} 사용량`} /> : null}
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="plans-heading" className="space-y-4">
        <div>
          <h2 id="plans-heading" className="text-lg font-extrabold tracking-[-0.03em]">요금제 바꾸기</h2>
          <p className="mt-1 text-sm text-muted-foreground">요금제별 한도와 기능을 비교해 보세요.</p>
        </div>
        <div className="grid gap-px overflow-hidden rounded-2xl border bg-border lg:grid-cols-3">
          {ALL_PLANS.map((option) => {
            const isCurrent = option.id === plan;
            const isUpgrade = option.priceMonthlyKrw > planConfig.priceMonthlyKrw;
            return (
              <div key={option.id} className={cn("flex flex-col gap-5 px-6 py-6", isCurrent ? "bg-brand-soft" : "bg-card")}>
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xl font-extrabold tracking-[-0.03em]">{PLAN_LABEL[option.id]}</h3>
                    {isCurrent ? <Badge variant="brand">현재</Badge> : null}
                  </div>
                  <p className="tabular mt-2"><span className="text-3xl font-extrabold tracking-[-0.04em]">{option.priceMonthlyKrw === 0 ? "무료" : `${option.priceMonthlyKrw.toLocaleString()}원`}</span>{option.priceMonthlyKrw > 0 ? <span className="text-sm text-muted-foreground"> / 월</span> : null}</p>
                  <p className="mt-2 text-sm font-semibold">만들기 설정 {option.automationLimit}개 · 월 {option.monthlyRunLimit}회</p>
                </div>
                <ul className="flex-1 space-y-2 text-sm text-muted-foreground">
                  {planFeatures(option).map((feature) => <li key={feature} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />{feature}</li>)}
                </ul>
                {isCurrent ? (
                  <Button className="w-full" disabled variant="outline">이용 중</Button>
                ) : option.id === "FREE" ? (
                  <form action={cancelSubscriptionAction} className="w-full">
                    <BillingSubmitButton className="w-full" variant="outline" pendingLabel="바꾸는 중…" confirmMessage="구독을 해지하고 무료 요금제로 바꿀까요?">
                      <ArrowDownRight /> 무료로 바꾸기
                    </BillingSubmitButton>
                  </form>
                ) : (
                  <form action={startCheckout.bind(null, option.id)} className="w-full">
                    <BillingSubmitButton className="w-full" variant={isUpgrade ? "default" : "outline"} pendingLabel="결제 준비 중…">
                      {isUpgrade ? <ArrowUpRight /> : <ArrowDownRight />}
                      {PLAN_LABEL[option.id]}로 {isUpgrade ? "올리기" : "바꾸기"}
                    </BillingSubmitButton>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {isPaid ? (
        <section aria-labelledby="cancel-heading" className="flex flex-col gap-4 rounded-2xl border border-destructive/30 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="cancel-heading" className="font-bold">구독 해지</h2>
            <p className="mt-1 text-sm text-muted-foreground">해지하면 자동 갱신이 멈추고 무료 요금제 한도가 적용돼요.</p>
          </div>
          <form action={cancelSubscriptionAction}>
            <BillingSubmitButton variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive" pendingLabel="해지하는 중…" confirmMessage="구독을 해지할까요?">구독 해지</BillingSubmitButton>
          </form>
        </section>
      ) : null}
    </div>
  );
}
