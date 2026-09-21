import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Check,
  Clock3,
  Headphones,
  Layers3,
  Settings2,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SetupRequestDialog } from "@/components/pricing/setup-request-dialog";
import { ALL_PLANS } from "@/server/billing/plans";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env/server";
import { startCheckout } from "@/app/(app)/billing/actions";
import type { PlanConfig } from "@/types/billing";
import type { SubscriptionPlan } from "@/types/domain";

const PLAN_COPY: Record<SubscriptionPlan, { description: string; eyebrow: string }> = {
  FREE: {
    eyebrow: "먼저 경험해보기",
    description: "AI 도구를 탐색하고 블로그 자동화를 가볍게 체험해보세요.",
  },
  STARTER: {
    eyebrow: "꾸준히 자동화하기",
    description: "개인 사용자와 1인 사업자의 반복 업무를 정기적으로 실행합니다.",
  },
  PRO: {
    eyebrow: "더 많이 운영하기",
    description: "여러 자동화를 자주 실행하는 팀과 성장 중인 사업자를 위한 플랜입니다.",
  },
};

function formatPrice(plan: PlanConfig) {
  return plan.priceMonthlyKrw === 0 ? "₩0" : `₩${plan.priceMonthlyKrw.toLocaleString()}`;
}

function formatLimit(value: number | null, suffix: string) {
  return value === null ? "무제한" : `${value.toLocaleString()}${suffix}`;
}

function PlanAction({
  plan,
  currentPlan,
  isAuthenticated,
}: {
  plan: PlanConfig;
  currentPlan: SubscriptionPlan;
  isAuthenticated: boolean;
}) {
  if (plan.id === "FREE") {
    return (
      <Button asChild variant="outline" className="h-11 w-full rounded-lg border-stone-300 bg-white">
        <Link href={isAuthenticated && currentPlan !== "FREE" ? "/billing" : isAuthenticated ? "/dashboard" : "/signup"}>
          {isAuthenticated && currentPlan !== "FREE" ? "현재 플랜 관리" : isAuthenticated ? "무료 플랜으로 계속하기" : "무료로 시작하기"}
          <ArrowRight className="ml-1 h-4 w-4" />
        </Link>
      </Button>
    );
  }

  if (plan.id === currentPlan) {
    return (
      <Button asChild variant="outline" className="h-11 w-full rounded-lg border-stone-300 bg-white">
        <Link href="/billing">현재 플랜 관리</Link>
      </Button>
    );
  }

  if (!isAuthenticated) {
    return (
      <Button asChild className="h-11 w-full rounded-lg bg-blue-600 text-white hover:bg-blue-700">
        <Link href={`/login?redirectTo=${encodeURIComponent(`/billing?plan=${plan.id}`)}`}>
          로그인 후 {plan.name} 선택 <ArrowRight className="ml-1 h-4 w-4" />
        </Link>
      </Button>
    );
  }

  return (
    <form action={startCheckout.bind(null, plan.id as "STARTER" | "PRO")} className="w-full">
      <Button type="submit" className="h-11 w-full rounded-lg bg-blue-600 text-white hover:bg-blue-700">
        {plan.name} 선택하고 결제 진행 <ArrowRight className="ml-1 h-4 w-4" />
      </Button>
    </form>
  );
}

export default async function PricingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: subscription } = user
    ? await supabase.from("subscriptions").select("plan, status").eq("user_id", user.id).maybeSingle()
    : { data: null };

  const currentPlan: SubscriptionPlan = subscription?.status === "ACTIVE" ? subscription.plan : "FREE";

  return (
    <div className="bg-[#fbfaf7] text-stone-950">
      <section className="border-b border-stone-200">
        <div className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6 lg:py-24">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Simple, predictable pricing</p>
          <h1 className="mx-auto mt-5 max-w-4xl text-4xl leading-tight font-black tracking-[-0.045em] sm:text-6xl">
            무료로 시작하고,<br className="sm:hidden" /> 필요한 만큼 자동화하세요.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-stone-600 sm:text-lg">
            가격과 사용 한도는 실제 플랜 정책을 그대로 반영합니다. 무료로 시작한 뒤 현재 업무량에 맞춰 플랜을 선택하세요.
          </p>
          <div className="mx-auto mt-8 flex max-w-2xl flex-wrap items-center justify-center gap-x-6 gap-y-3 border-y border-stone-200 py-4 text-sm text-stone-600">
            <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-blue-600" /> 무료 플랜 제공</span>
            <span className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-blue-600" /> 월 단위 이용</span>
            <span className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-blue-600" /> 구축 대행 별도 신청</span>
          </div>
        </div>
      </section>

      <section className="border-b border-stone-200 bg-white py-16 lg:py-20" aria-labelledby="plans-title">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-9 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Plans</p>
              <h2 id="plans-title" className="mt-3 text-3xl font-black tracking-[-0.035em] sm:text-4xl">플랜을 한눈에 비교하세요.</h2>
            </div>
            {user ? (
              <p className="inline-flex self-start rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 sm:self-auto">
                현재 플랜 · {currentPlan}
              </p>
            ) : (
              <p className="text-sm text-stone-500">유료 플랜 선택 시 로그인 후 결제로 이어집니다.</p>
            )}
          </div>

          <div className="grid border border-stone-200 lg:grid-cols-3">
            {ALL_PLANS.map((plan) => {
              const recommended = plan.id === "STARTER";
              const active = user && plan.id === currentPlan;
              const copy = PLAN_COPY[plan.id];

              return (
                <article
                  key={plan.id}
                  className={`relative flex min-w-0 flex-col p-6 sm:p-8 ${plan.id !== "PRO" ? "border-b border-stone-200 lg:border-r lg:border-b-0" : ""} ${recommended ? "bg-blue-50/45" : "bg-white"}`}
                >
                  <div className="flex min-h-8 items-start justify-between gap-4">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-stone-500">{copy.eyebrow}</p>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {recommended ? <span className="rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-bold text-white">추천</span> : null}
                      {active ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-700">현재 플랜</span> : null}
                    </div>
                  </div>

                  <div className="mt-4">
                    <h3 className="text-2xl font-black tracking-tight">{plan.name}</h3>
                    <p className="mt-3 text-4xl font-black tracking-[-0.04em]">
                      {formatPrice(plan)}
                      <span className="ml-1 text-sm font-medium tracking-normal text-stone-400">/월</span>
                    </p>
                    <p className="mt-4 min-h-12 text-sm leading-6 text-stone-500">{copy.description}</p>
                  </div>

                  <div className="mt-6 grid grid-cols-2 border-y border-stone-200 py-5">
                    <div className="border-r border-stone-200 pr-4">
                      <span className="flex items-center gap-1.5 text-xs text-stone-400"><Layers3 className="h-3.5 w-3.5" /> 자동화</span>
                      <strong className="mt-2 block text-lg font-black text-stone-900">{formatLimit(plan.automationLimit, "개")}</strong>
                    </div>
                    <div className="pl-4">
                      <span className="flex items-center gap-1.5 text-xs text-stone-400"><Clock3 className="h-3.5 w-3.5" /> 월 실행</span>
                      <strong className="mt-2 block text-lg font-black text-stone-900">{formatLimit(plan.monthlyRunLimit, "회")}</strong>
                    </div>
                  </div>

                  <ul className="mt-6 flex-1 space-y-3 text-sm leading-6 text-stone-700">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5">
                        <Check className="mt-1 h-4 w-4 shrink-0 text-blue-600" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-8">
                    <PlanAction plan={plan} currentPlan={currentPlan} isAuthenticated={Boolean(user)} />
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mt-5 flex flex-col gap-2 text-xs leading-5 text-stone-500 sm:flex-row sm:items-center sm:justify-between">
            <p>자동화 수와 월 실행 한도는 서버에서 확인됩니다.{serverEnv.BILLING_PROVIDER === "mock" ? " 현재 결제는 테스트용 모의 결제로 실제 요금이 청구되지 않습니다." : ""}</p>
            <Link href="/billing" className="inline-flex items-center font-bold text-blue-600 hover:underline">내 플랜과 사용량 확인 <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
          </div>
        </div>
      </section>

      <section className="border-b border-stone-200 py-16 lg:py-20" aria-labelledby="flow-title">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
            <div className="max-w-lg">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">How billing works</p>
              <h2 id="flow-title" className="mt-3 text-3xl font-black tracking-[-0.035em] sm:text-4xl">선택한 플랜은<br />바로 이용 흐름으로 연결됩니다.</h2>
              <p className="mt-4 text-sm leading-6 text-stone-500">로그인한 사용자가 STARTER 또는 PRO를 선택하면 결제 화면으로 이동하고, 결제 확인 후 플랜 한도가 적용됩니다.</p>
            </div>
            <ol className="grid border border-stone-200 bg-white md:grid-cols-3">
              {[
                { number: "01", icon: BadgeCheck, title: "플랜 선택", text: "자동화 수와 월 실행 횟수를 비교해 선택합니다." },
                { number: "02", icon: ShieldCheck, title: "결제 확인", text: "선택한 플랜과 금액을 결제 단계에서 다시 확인합니다." },
                { number: "03", icon: Sparkles, title: "한도 적용", text: "결제가 완료되면 새로운 플랜으로 자동화를 실행합니다." },
              ].map(({ number, icon: Icon, title, text }, index) => (
                <li key={number} className={`p-6 sm:p-7 ${index < 2 ? "border-b border-stone-200 md:border-r md:border-b-0" : ""}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-600">{number}</span>
                    <Icon className="h-5 w-5 text-stone-400" />
                  </div>
                  <h3 className="mt-8 text-lg font-black">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-stone-500">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section id="setup-service" className="scroll-mt-20 bg-[#0b1220] py-16 text-white lg:py-20" aria-labelledby="setup-title">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:gap-16">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-300">Setup service</p>
            <h2 id="setup-title" className="mt-4 text-3xl font-black tracking-[-0.035em] sm:text-5xl">직접 설정이 어렵다면,<br />구축을 요청하세요.</h2>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-300">필요한 업무와 현재 사용 중인 도구를 알려주시면 자동화 구성과 초기 설정을 함께 진행합니다. 구독 플랜과 별도 견적으로 운영됩니다.</p>
            <div className="mt-8">
              <SetupRequestDialog isAuthenticated={Boolean(user)} />
            </div>
          </div>

          <div className="grid border border-slate-700 bg-slate-900/60 sm:grid-cols-2">
            {[
              { icon: Headphones, title: "요구사항 상담", text: "반복 업무와 목표를 함께 정리합니다." },
              { icon: WandSparkles, title: "자동화 구성", text: "업무에 맞는 설정과 실행 주기를 구성합니다." },
              { icon: Settings2, title: "초기 연결", text: "필요한 계정과 도구 연결을 안내합니다." },
              { icon: ShieldCheck, title: "검수와 인계", text: "실행 결과를 확인하고 사용 방법을 전달합니다." },
            ].map(({ icon: Icon, title, text }, index) => (
              <div key={title} className={`p-6 sm:p-7 ${index % 2 === 0 ? "sm:border-r sm:border-slate-700" : ""} ${index < 2 ? "border-b border-slate-700" : index === 2 ? "border-b border-slate-700 sm:border-b-0" : ""}`}>
                <Icon className="h-5 w-5 text-blue-300" />
                <h3 className="mt-5 font-bold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
