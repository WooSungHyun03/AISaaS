import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mascot } from "@/components/brand/mascot";
import { PLAN_LABEL, PLAN_TAGLINE, planFeatures } from "@/components/billing/plan-copy";
import { ALL_PLANS } from "@/server/billing/plans";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env/server";
import { startCheckout } from "@/app/(app)/billing/actions";
import { cn } from "@/lib/utils";
import type { PlanConfig } from "@/types/billing";
import type { SubscriptionPlan } from "@/types/domain";

export const metadata = { title: "요금제" };

const formatLimit = (value: number | null, unit: string) => (value === null ? "무제한" : `${value.toLocaleString()}${unit}`);

function PlanAction({ plan, currentPlan, isAuthenticated }: { plan: PlanConfig; currentPlan: SubscriptionPlan; isAuthenticated: boolean }) {
  if (plan.id === "FREE") {
    return (
      <Button asChild variant="outline" size="lg" className="w-full">
        <Link href={isAuthenticated && currentPlan !== "FREE" ? "/billing" : isAuthenticated ? "/dashboard" : "/signup"}>
          {isAuthenticated && currentPlan !== "FREE" ? "내 요금제 관리" : isAuthenticated ? "무료로 계속 쓰기" : "무료로 시작하기"}
        </Link>
      </Button>
    );
  }
  if (plan.id === currentPlan) {
    return <Button asChild variant="outline" size="lg" className="w-full"><Link href="/billing">내 요금제 관리</Link></Button>;
  }
  if (!isAuthenticated) {
    return (
      <Button asChild size="lg" className="w-full">
        <Link href={`/login?redirectTo=${encodeURIComponent(`/billing?plan=${plan.id}`)}`}>로그인하고 {PLAN_LABEL[plan.id]} 시작 <ArrowRight aria-hidden="true" /></Link>
      </Button>
    );
  }
  return (
    <form action={startCheckout.bind(null, plan.id as "STARTER" | "PRO")} className="w-full">
      <Button type="submit" size="lg" className="w-full">{PLAN_LABEL[plan.id]} 시작하기 <ArrowRight aria-hidden="true" /></Button>
    </form>
  );
}

export default async function PricingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: subscription } = user
    ? await supabase.from("subscriptions").select("plan, status").eq("user_id", user.id).maybeSingle()
    : { data: null };
  const currentPlan: SubscriptionPlan = subscription?.status === "ACTIVE" ? subscription.plan : "FREE";

  return (
    <>
      <section className="border-b bg-brand-soft/60" aria-labelledby="pricing-title">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-14 text-center sm:px-6 lg:flex-row lg:justify-between lg:py-16 lg:text-left">
          <div className="max-w-2xl">
            <h1 id="pricing-title" className="text-4xl font-extrabold leading-[1.2] tracking-[-0.045em] sm:text-5xl">무료로 시작하고,<br className="hidden sm:block" /> 필요할 때 넓히세요</h1>
            <p className="mt-5 text-base leading-7 text-muted-foreground sm:text-lg">마케팅 진단과 캘린더는 무료로 써볼 수 있어요. 블로그 글과 숏폼을 더 자주 만들고 싶을 때 요금제를 고르면 돼요.</p>
          </div>
          <Mascot pose="present" size={200} priority className="shrink-0" />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:py-16" aria-labelledby="plans-title">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <h2 id="plans-title" className="text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">요금제 비교</h2>
          {user ? <Badge variant="brand">지금 {PLAN_LABEL[currentPlan]} 요금제</Badge> : <p className="text-sm text-muted-foreground">유료 요금제는 로그인한 뒤 결제로 이어져요.</p>}
        </div>

        <div className="grid gap-px overflow-hidden rounded-2xl border bg-border lg:grid-cols-3">
          {ALL_PLANS.map((plan) => {
            const recommended = plan.id === "STARTER";
            return (
              <article key={plan.id} className={cn("flex min-w-0 flex-col gap-6 px-6 py-7 sm:px-8", recommended ? "bg-brand-soft" : "bg-card")}>
                <div>
                  <div className="flex min-h-7 items-center justify-between gap-2">
                    <h3 className="text-xl font-extrabold tracking-[-0.03em]">{PLAN_LABEL[plan.id]}</h3>
                    <span className="flex gap-1.5">
                      {recommended ? <Badge variant="spark">추천</Badge> : null}
                      {user && plan.id === currentPlan ? <Badge variant="success">이용 중</Badge> : null}
                    </span>
                  </div>
                  <p className="mt-1 min-h-12 text-sm leading-6 text-muted-foreground">{PLAN_TAGLINE[plan.id]}</p>
                  <p className="tabular mt-4 flex items-baseline gap-1">
                    <span className="text-4xl font-extrabold tracking-[-0.05em]">{plan.priceMonthlyKrw === 0 ? "0원" : `${plan.priceMonthlyKrw.toLocaleString()}원`}</span>
                    <span className="text-sm text-muted-foreground">/ 월</span>
                  </p>
                </div>

                <dl className="tabular grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border text-sm">
                  <div className="bg-card px-4 py-3"><dt className="text-[13px] text-muted-foreground">만들기 설정</dt><dd className="mt-0.5 text-base font-extrabold">{formatLimit(plan.automationLimit, "개")}</dd></div>
                  <div className="bg-card px-4 py-3"><dt className="text-[13px] text-muted-foreground">한 달 제작</dt><dd className="mt-0.5 text-base font-extrabold">{formatLimit(plan.monthlyRunLimit, "회")}</dd></div>
                </dl>

                <ul className="flex-1 space-y-2.5 text-[15px] leading-6">
                  {planFeatures(plan).map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5"><Check className="mt-1 size-4 shrink-0 text-success" aria-hidden="true" /><span>{feature}</span></li>
                  ))}
                </ul>

                <PlanAction plan={plan} currentPlan={currentPlan} isAuthenticated={Boolean(user)} />
              </article>
            );
          })}
        </div>

        <div className="mt-5 flex flex-col gap-2 text-[13px] leading-6 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>한도는 서버에서 확인해요.{serverEnv.BILLING_PROVIDER === "mock" ? " 지금은 테스트용 모의 결제라 실제로 청구되지 않아요." : ""} 블로그 글과 숏폼은 만들어 드리는 데까지만 해요. 올리는 건 직접 해주세요.</p>
          <Link href="/billing" className="inline-flex shrink-0 items-center gap-1 font-semibold text-primary hover:underline">내 요금제와 사용량 보기 <ArrowRight className="size-3.5" aria-hidden="true" /></Link>
        </div>
      </section>

      <section id="setup-service" className="scroll-mt-20 border-t bg-ink text-white" aria-labelledby="setup-title">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-14 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:py-16">
          <div className="max-w-2xl">
            <h2 id="setup-title" className="text-2xl font-extrabold leading-snug tracking-[-0.03em] sm:text-3xl">직접 설정이 어렵다면, 세팅을 맡겨주세요</h2>
            <p className="mt-3 text-[15px] leading-7 text-white/75">하고 싶은 일과 쓰는 도구를 알려주시면 담당자가 연결과 초기 설정을 도와드려요. 구독 요금과는 따로 견적을 드려요.</p>
          </div>
          <Button asChild variant="spark" size="lg" className="shrink-0"><Link href="/setup-request">세팅 맡기기 <ArrowRight aria-hidden="true" /></Link></Button>
        </div>
      </section>
    </>
  );
}
