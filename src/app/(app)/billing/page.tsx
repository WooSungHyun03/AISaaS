import { ArrowDownRight, ArrowUpRight, Check, CreditCard, Gauge, ShieldCheck, Workflow } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env/server";
import { ALL_PLANS, getPlanConfig } from "@/server/billing/plans";
import { getBillingOverview } from "@/server/billing/read-model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { BillingSubmitButton } from "@/components/billing/billing-submit-button";
import { cancelSubscriptionAction, startCheckout } from "./actions";

const ACTIVE_STATUSES = new Set(["ACTIVE", "TRIALING"]);

function formatDate(value: string | null | undefined) {
  if (!value) return "결제 후 표시";
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
  const providerLabel = serverEnv.BILLING_PROVIDER === "toss" ? "Toss Payments" : "Mock";

  return (
    <div className="space-y-8 pb-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">현재 플랜, 이번 달 사용량, 업그레이드와 구독 취소를 한곳에서 관리하세요.</p>
      </div>

      {isTestBilling ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
          <ShieldCheck className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">테스트 결제 환경 · 실제 청구 없음</p>
            <p className="mt-0.5 text-xs text-amber-800">현재 결제 제공자: {providerLabel}. 결제 완료 흐름과 플랜 반영을 안전하게 확인할 수 있습니다.</p>
          </div>
        </div>
      ) : null}

      {selectedPlan && selectedPlan !== plan ? (
        <Card className="border-blue-200 bg-blue-50/60">
          <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">{getPlanConfig(selectedPlan).name} 플랜을 선택했습니다</p>
              <p className="mt-1 text-sm text-muted-foreground">
                월 ₩{getPlanConfig(selectedPlan).priceMonthlyKrw.toLocaleString()} · 자동화 {getPlanConfig(selectedPlan).automationLimit}개 · 월 {getPlanConfig(selectedPlan).monthlyRunLimit}회
              </p>
            </div>
            <form action={startCheckout.bind(null, selectedPlan)}>
              <BillingSubmitButton className="w-full bg-blue-600 text-white hover:bg-blue-700 sm:w-auto" pendingLabel="결제 준비 중...">
                결제 계속하기 <ArrowUpRight />
              </BillingSubmitButton>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <section aria-labelledby="current-plan-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="current-plan-heading" className="text-lg font-semibold">Current Plan</h2>
          <Badge variant={hasActiveSubscription ? "default" : "secondary"}>{hasActiveSubscription ? subscription?.status ?? "ACTIVE" : "FREE"}</Badge>
        </div>
        <Card>
          <CardContent className="grid gap-6 py-6 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><CreditCard className="size-5" /></div>
                <div>
                  <p className="text-2xl font-bold">{planConfig.name}</p>
                  <p className="text-sm text-muted-foreground">{planConfig.priceMonthlyKrw === 0 ? "무료" : `월 ₩${planConfig.priceMonthlyKrw.toLocaleString()}`}</p>
                </div>
              </div>
              <p className="mt-5 text-sm text-muted-foreground">현재 이용 기간 종료일</p>
              <p className="mt-1 font-medium">{isPaid ? formatDate(subscription?.current_period_end) : "무료 플랜은 만료되지 않습니다"}</p>
            </div>
            <ul className="grid content-center gap-2 text-sm sm:grid-cols-2 lg:grid-cols-1">
              {planConfig.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{feature}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="usage-heading">
        <h2 id="usage-heading" className="mb-3 text-lg font-semibold">Usage</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Workflow className="size-4 text-blue-600" />활성 자동화</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-end justify-between"><p className="text-3xl font-bold">{automationCount}</p><p className="text-sm text-muted-foreground">/ {planConfig.automationLimit ?? "무제한"}개</p></div>
              {planConfig.automationLimit ? <Progress value={Math.min(100, (automationCount / planConfig.automationLimit) * 100)} /> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Gauge className="size-4 text-violet-600" />이번 달 실행</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-end justify-between"><p className="text-3xl font-bold">{monthlyRuns}</p><p className="text-sm text-muted-foreground">/ {planConfig.monthlyRunLimit ?? "무제한"}회</p></div>
              {planConfig.monthlyRunLimit ? <Progress value={Math.min(100, (monthlyRuns / planConfig.monthlyRunLimit) * 100)} /> : null}
            </CardContent>
          </Card>
        </div>
      </section>

      <section aria-labelledby="plans-heading">
        <div className="mb-3">
          <h2 id="plans-heading" className="text-lg font-semibold">Upgrade / Downgrade</h2>
          <p className="text-sm text-muted-foreground">플랜별 한도와 기능을 비교한 뒤 변경하세요.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {ALL_PLANS.map((option) => {
            const isCurrent = option.id === plan;
            const isUpgrade = option.priceMonthlyKrw > planConfig.priceMonthlyKrw;
            return (
              <Card key={option.id} className={isCurrent ? "border-blue-300 ring-1 ring-blue-200" : ""}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>{option.name}</CardTitle>
                    {isCurrent ? <Badge>현재 플랜</Badge> : null}
                  </div>
                  <div className="pt-2"><span className="text-3xl font-bold">{option.priceMonthlyKrw === 0 ? "무료" : `₩${option.priceMonthlyKrw.toLocaleString()}`}</span>{option.priceMonthlyKrw > 0 ? <span className="text-sm text-muted-foreground"> / 월</span> : null}</div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm font-medium">자동화 {option.automationLimit}개 · 월 {option.monthlyRunLimit}회</p>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {option.features.map((feature) => <li key={feature} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{feature}</li>)}
                  </ul>
                </CardContent>
                <CardFooter>
                  {isCurrent ? (
                    <Button className="w-full" disabled variant="outline">현재 이용 중</Button>
                  ) : option.id === "FREE" ? (
                    <form action={cancelSubscriptionAction} className="w-full">
                      <BillingSubmitButton className="w-full" variant="outline" pendingLabel="변경 중..." confirmMessage="구독을 취소하고 Free 플랜으로 변경하시겠습니까?">
                        <ArrowDownRight /> Free로 다운그레이드
                      </BillingSubmitButton>
                    </form>
                  ) : (
                    <form action={startCheckout.bind(null, option.id)} className="w-full">
                      <BillingSubmitButton className="w-full" variant={isUpgrade ? "default" : "outline"} pendingLabel="결제 준비 중...">
                        {isUpgrade ? <ArrowUpRight /> : <ArrowDownRight />}
                        {isUpgrade ? `${option.name}로 업그레이드` : `${option.name}로 변경`}
                      </BillingSubmitButton>
                    </form>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </section>

      {isPaid ? (
        <section aria-labelledby="cancel-heading">
          <Card className="border-red-200">
            <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 id="cancel-heading" className="font-semibold">Cancel subscription</h2>
                <p className="mt-1 text-sm text-muted-foreground">취소하면 자동 갱신이 중단되고 Free 플랜 한도가 적용됩니다.</p>
              </div>
              <form action={cancelSubscriptionAction}>
                <BillingSubmitButton variant="destructive" pendingLabel="취소 중..." confirmMessage="구독을 취소하시겠습니까?">구독 취소</BillingSubmitButton>
              </form>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
