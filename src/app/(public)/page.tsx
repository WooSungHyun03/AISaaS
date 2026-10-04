import { PLAN_LABEL, planFeatures } from "@/components/billing/plan-copy";
import Link from "next/link";
import { ArrowRight, Check, TrendingUp, Video } from "lucide-react";
import { Mascot } from "@/components/brand/mascot";
import { BlogDraftPreview, CalendarPreview, DiagnosisPreview } from "@/components/landing/product-preview";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ALL_PLANS } from "@/server/billing/plans";

const STEPS = [
  { title: "주소를 넣어요", description: "홈페이지나 인스타그램 주소를 입력하세요. 주소가 없으면 가게 정보를 직접 적어도 돼요." },
  { title: "무료로 진단받아요", description: "지금 마케팅이 몇 점인지, 어떤 채널이 비어 있는지 바로 알려드려요." },
  { title: "한 달 계획을 세워요", description: "가게 정보에 맞춰 날짜별로 어떤 콘텐츠를 올릴지 캘린더로 짜드려요." },
  { title: "콘텐츠를 만들어요", description: "정해진 날짜의 블로그 글과 숏폼 영상을 만들어 확인하실 수 있게 드려요." },
];

const COMING_FEATURES = [
  { title: "숏폼 영상 제작", description: "후킹 문장, 대본, 자막까지 갖춘 9:16 영상을 만들어요.", icon: Video },
  { title: "성장 리포트", description: "한 달 동안 무엇을 만들고 얼마나 실행했는지 정리해요.", icon: TrendingUp },
];

const FAQS = [
  {
    q: "만든 콘텐츠가 저절로 SNS나 블로그에 올라가나요?",
    a: "아니요. Easy Marketing은 콘텐츠를 만들어 드리는 데까지만 해요. 사장님이 확인하고, 필요하면 고친 뒤 원하는 곳에 직접 올려주세요. 마음대로 게시되는 일은 없어요.",
  },
  {
    q: "AI가 우리 가게 정보를 마음대로 정하진 않나요?",
    a: "주소에서 읽어온 내용은 ‘제안’일 뿐이에요. 사장님이 확인하고 고쳐서 저장해야 사업 정보로 반영돼요. 확인되지 않은 내용은 자동으로 확정하지 않아요.",
  },
  {
    q: "홈페이지나 SNS가 없어도 쓸 수 있나요?",
    a: "네. 업종, 지역, 주요 상품 같은 가게 정보를 직접 적으면 똑같이 진단과 캘린더를 만들 수 있어요.",
  },
  {
    q: "무료로 어디까지 쓸 수 있어요?",
    a: "마케팅 진단과 마케팅 캘린더는 무료예요. 블로그 글과 숏폼 영상은 플랜마다 한 달에 만들 수 있는 횟수가 달라요.",
  },
];

export default function LandingPage() {
  return (
    <div className="text-foreground">
      {/* Hero */}
      <section className="overflow-hidden bg-brand-soft" aria-labelledby="hero-title">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-14 pt-12 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-6 lg:pb-20 lg:pt-16">
          <div className="max-w-xl">
            <h1 id="hero-title" className="text-[2.25rem] font-extrabold leading-[1.22] tracking-[-0.045em] sm:text-5xl lg:text-[3.4rem]">
              내 가게 마케팅,
              <br />
              어디서부터 할지
              <br />
              막막하셨죠?
            </h1>
            <p className="mt-6 max-w-lg text-[17px] leading-8 text-muted-foreground">
              홈페이지나 SNS 주소만 넣어보세요. 지금 마케팅이 얼마나 되고 있는지 점수로 알려드리고, 이번 달에 뭘 올리면 좋을지 계획까지 짜드려요.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/signup">
                  무료로 마케팅 진단받기 <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/pricing">요금제 보기</Link>
              </Button>
            </div>
            <p className="mt-5 text-sm text-muted-foreground">카드 등록 없이 시작해요 · 진단과 캘린더는 계속 무료예요</p>
          </div>

          <div className="relative mx-auto w-full max-w-md lg:max-w-none">
            <Mascot pose="hero" size={440} priority className="relative z-10 mx-auto w-[min(72vw,340px)] lg:ml-auto lg:mr-4 lg:w-[400px]" />
            <div className="relative z-20 -mt-14 sm:-mt-20 lg:absolute lg:-bottom-2 lg:left-0 lg:mt-0 lg:w-[300px]">
              <div aria-hidden="true" className="rounded-2xl border border-border bg-card p-4 shadow-[0_18px_44px_-18px_rgb(14_30_69/0.35)]">
                <p className="text-xs font-semibold text-muted-foreground">오늘의 마케팅 점수 (예시)</p>
                <div className="mt-2 flex items-end justify-between">
                  <p className="tabular text-4xl font-extrabold tracking-[-0.04em]">
                    68<span className="ml-1 text-sm font-medium text-muted-foreground">/ 100</span>
                  </p>
                  <span className="rounded-full bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning">블로그가 비어 있어요</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-[68%] rounded-full bg-primary" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 이용 방법 */}
      <section id="how" className="scroll-mt-20 border-b border-border bg-card" aria-labelledby="how-title">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <h2 id="how-title" className="max-w-xl text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">
            주소 하나로 시작해서
            <br />
            콘텐츠까지 이어져요
          </h2>
          <ol className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="relative">
                {index < STEPS.length - 1 ? (
                  <span aria-hidden="true" className="absolute left-12 right-[-2rem] top-[18px] hidden h-px bg-border lg:block" />
                ) : null}
                <span className="relative z-10 flex size-9 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">{index + 1}</span>
                <h3 className="mt-5 text-lg font-bold">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-7 text-muted-foreground">{step.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 기능 */}
      <section id="features" className="scroll-mt-20" aria-labelledby="features-title">
        <div className="mx-auto max-w-6xl space-y-20 px-4 py-16 sm:px-6 lg:space-y-28 lg:py-24">
          <h2 id="features-title" className="sr-only">Easy Marketing이 해주는 일</h2>

          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <Badge variant="success">무료</Badge>
              <h3 className="mt-4 text-3xl font-extrabold tracking-[-0.04em]">지금 내 마케팅 상태를 점수로 확인해요</h3>
              <p className="mt-4 text-base leading-8 text-muted-foreground">
                홈페이지와 SNS가 얼마나 채워져 있는지, 콘텐츠를 꾸준히 올리고 있는지 살펴보고 가장 먼저 고치면 좋은 것부터 알려드려요. 읽어온 내용으로 가게 정보 입력도 도와드리고요.
              </p>
              <ul className="mt-6 space-y-2.5 text-[15px]">
                {["마케팅 점수와 부족한 채널", "콘텐츠 운영 상태와 SNS 활성도", "바로 해볼 수 있는 개선 방법"].map((item) => (
                  <li key={item} className="flex items-center gap-2.5">
                    <Check className="size-4 shrink-0 text-success" strokeWidth={3} aria-hidden="true" /> {item}
                  </li>
                ))}
              </ul>
            </div>
            <DiagnosisPreview />
          </div>

          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <CalendarPreview className="order-2 lg:order-1" />
            <div className="order-1 lg:order-2">
              <Badge variant="success">무료</Badge>
              <h3 className="mt-4 text-3xl font-extrabold tracking-[-0.04em]">이번 달 뭘 올릴지 날짜별로 정해드려요</h3>
              <p className="mt-4 text-base leading-8 text-muted-foreground">
                진단 결과와 가게 정보를 바탕으로 날짜, 채널, 주제, 목표까지 한 달 계획을 짭니다. 이 계획이 그대로 블로그 글과 숏폼 영상의 주제가 돼요.
              </p>
            </div>
          </div>

          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <Badge variant="brand">유료 · 이용 가능</Badge>
              <h3 className="mt-4 text-3xl font-extrabold tracking-[-0.04em]">우리 가게 이야기로 블로그 글을 써드려요</h3>
              <p className="mt-4 text-base leading-8 text-muted-foreground">
                업종, 지역, 단골 손님을 반영해서 광고 티가 덜 나는 자연스러운 글로 써요. 제목, 소제목, 검색 키워드, 사진 넣을 위치까지 챙기고, 마음에 안 들면 다시 만들 수 있어요.
              </p>
              <p className="mt-4 rounded-lg bg-muted px-4 py-3 text-sm leading-6 text-muted-foreground">
                만든 글은 확인하고 직접 올려주세요. 자동으로 게시되지 않아요.
              </p>
            </div>
            <BlogDraftPreview />
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <h3 className="text-xl font-extrabold tracking-[-0.03em]">곧 만나요</h3>
            <ul className="mt-5 grid gap-5 sm:grid-cols-2">
              {COMING_FEATURES.map((feature) => (
                <li key={feature.title} className="flex gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <feature.icon className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="flex flex-wrap items-center gap-2 font-bold">
                      {feature.title} <Badge variant="secondary" className="bg-muted text-muted-foreground">준비 중</Badge>
                    </p>
                    <p className="mt-1 text-[15px] leading-7 text-muted-foreground">{feature.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 요금제 */}
      <section className="border-y border-border bg-card" aria-labelledby="pricing-title">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="max-w-xl">
            <h2 id="pricing-title" className="text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">무료로 먼저 써보고, 필요할 때 넓히세요</h2>
            <p className="mt-3 text-base leading-7 text-muted-foreground">플랜마다 한 달에 만들 수 있는 콘텐츠 수가 달라요. 언제든 바꿀 수 있어요.</p>
          </div>
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {ALL_PLANS.map((plan) => {
              const recommended = plan.id === "STARTER";
              return (
                <article
                  key={plan.id}
                  className={`relative flex flex-col rounded-2xl border p-7 ${recommended ? "border-primary bg-brand-soft/50 shadow-[0_0_0_1px_var(--primary)]" : "border-border bg-card"}`}
                >
                  {recommended ? <Badge className="absolute right-6 top-6">가장 많이 선택</Badge> : null}
                  <h3 className="text-lg font-bold">{PLAN_LABEL[plan.id]}</h3>
                  <p className="tabular mt-4 text-4xl font-extrabold tracking-[-0.04em]">
                    {plan.priceMonthlyKrw === 0 ? "무료" : `${plan.priceMonthlyKrw.toLocaleString()}원`}
                    {plan.priceMonthlyKrw === 0 ? null : <span className="ml-1 text-sm font-medium text-muted-foreground">/월</span>}
                  </p>
                  <ul className="mt-6 flex-1 space-y-3 border-t border-border pt-6 text-[15px]">
                    {planFeatures(plan).slice(0, 5).map((feature) => (
                      <li key={feature} className="flex gap-2.5">
                        <Check className="mt-1 size-4 shrink-0 text-primary" strokeWidth={3} aria-hidden="true" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Button asChild variant={recommended ? "default" : "outline"} size="lg" className="mt-8">
                    <Link href={plan.id === "FREE" ? "/signup" : `/signup?redirectTo=${encodeURIComponent(`/billing?plan=${plan.id}`)}`}>
                      {plan.id === "FREE" ? "무료로 시작하기" : `${PLAN_LABEL[plan.id]} 시작하기`}
                    </Link>
                  </Button>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:py-20" aria-labelledby="faq-title">
        <h2 id="faq-title" className="text-3xl font-extrabold tracking-[-0.04em]">자주 묻는 질문</h2>
        <Accordion type="single" collapsible className="mt-8 divide-y divide-border border-y border-border">
          {FAQS.map((faq) => (
            <AccordionItem key={faq.q} value={faq.q} className="border-0">
              <AccordionTrigger className="py-5 text-left text-base font-bold hover:no-underline">{faq.q}</AccordionTrigger>
              <AccordionContent className="pb-5 text-[15px] leading-7 text-muted-foreground">{faq.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      {/* 마무리 CTA */}
      <section className="bg-ink text-white" aria-labelledby="cta-title">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 px-4 py-14 sm:px-6 md:flex-row md:justify-between lg:py-16">
          <div className="max-w-xl text-center md:text-left">
            <h2 id="cta-title" className="text-3xl font-extrabold leading-snug tracking-[-0.04em] sm:text-4xl">
              오늘 가게 주소를 알려주세요.
              <br />
              마케팅 점수부터 확인해드려요.
            </h2>
            <Button asChild variant="spark" size="lg" className="mt-7">
              <Link href="/signup">
                무료로 시작하기 <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
          <Mascot pose="welcome" size={220} className="w-[180px] shrink-0 md:w-[220px]" />
        </div>
      </section>
    </div>
  );
}
