import { createClient } from "@/lib/supabase/server";
import { getPeriodKey } from "@/lib/utils/date";
import { ALL_PLANS, getPlanConfig } from "@/server/billing/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cancelSubscriptionAction, startCheckout } from "./actions";

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  const { plan: requestedPlan } = await searchParams;
  const selectedPlan = requestedPlan === "STARTER" || requestedPlan === "PRO" ? requestedPlan : null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: subscription }, { data: usage }, { count: automationCount }] = await Promise.all([
    supabase.from("subscriptions").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("usage").select("*").eq("user_id", user.id).eq("period", getPeriodKey()).maybeSingle(),
    supabase.from("automations").select("id", { count: "exact", head: true }).eq("user_id", user.id),
  ]);

  const plan = subscription?.status === "ACTIVE" ? subscription.plan : "FREE";
  const planConfig = getPlanConfig(plan);
  const monthlyRuns = usage?.automation_runs ?? 0;
  const isPaid = plan !== "FREE";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">현재 플랜과 사용량을 확인하고 관리하세요.</p>
      </div>

      {selectedPlan ? (
        <Card className="border border-blue-200 bg-blue-50/50 ring-0">
          <CardHeader>
            <CardTitle className="text-lg font-bold">선택한 {getPlanConfig(selectedPlan).name} 플랜</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              월 ₩{getPlanConfig(selectedPlan).priceMonthlyKrw.toLocaleString()} · 자동화 {getPlanConfig(selectedPlan).automationLimit}개 · 월 {getPlanConfig(selectedPlan).monthlyRunLimit}회 실행
            </p>
            {plan === selectedPlan ? (
              <Badge>현재 이용 중</Badge>
            ) : (
              <form action={startCheckout.bind(null, selectedPlan)}>
                <Button type="submit" className="w-full bg-blue-600 text-white hover:bg-blue-700 sm:w-auto">
                  {getPlanConfig(selectedPlan).name} 결제 계속하기
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            현재 플랜: {planConfig.name}
            <Badge variant={subscription?.status === "ACTIVE" ? "default" : "secondary"}>{subscription?.status ?? "ACTIVE"}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>자동화 개수</span>
              <span>
                {automationCount ?? 0} / {planConfig.automationLimit ?? "무제한"}
              </span>
            </div>
            {planConfig.automationLimit ? (
              <Progress value={Math.min(100, ((automationCount ?? 0) / planConfig.automationLimit) * 100)} />
            ) : null}
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>이번 달 실행 횟수</span>
              <span>
                {monthlyRuns} / {planConfig.monthlyRunLimit ?? "무제한"}
              </span>
            </div>
            {planConfig.monthlyRunLimit ? (
              <Progress value={Math.min(100, (monthlyRuns / planConfig.monthlyRunLimit) * 100)} />
            ) : null}
          </div>
        </CardContent>
        {isPaid ? (
          <CardFooter>
            <form action={cancelSubscriptionAction}>
              <Button type="submit" variant="outline">
                구독 취소
              </Button>
            </form>
          </CardFooter>
        ) : null}
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        {ALL_PLANS.map((planOption) => (
          <Card key={planOption.id}>
            <CardHeader>
              <CardTitle className="flex items-baseline justify-between">
                <span>{planOption.name}</span>
                <span className="text-xl font-bold">
                  {planOption.priceMonthlyKrw === 0 ? "무료" : `₩${planOption.priceMonthlyKrw.toLocaleString()}`}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              자동화 최대 {planOption.automationLimit ?? "무제한"}개 · 월 {planOption.monthlyRunLimit ?? "무제한"}회 실행
            </CardContent>
            <CardFooter>
              {planOption.id === plan ? (
                <Button className="w-full" disabled variant="outline">
                  현재 플랜
                </Button>
              ) : planOption.id === "FREE" ? (
                <Button className="w-full" disabled variant="outline">
                  다운그레이드는 구독 취소로 진행됩니다
                </Button>
              ) : (
                <form action={startCheckout.bind(null, planOption.id as "STARTER" | "PRO")} className="w-full">
                  <Button type="submit" className="w-full">
                    이 플랜으로 변경
                  </Button>
                </form>
              )}
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
