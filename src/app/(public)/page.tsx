import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  CalendarClock,
  Check,
  Clock3,
  Camera,
  FileText,
  Mail,
  MessageCircle,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DashboardPreview, FeaturePreview } from "@/components/landing/product-preview";
import { ALL_PLANS } from "@/server/billing/plans";
import { AUTOMATION_AVAILABILITY } from "@/types/automation";
import type { AutomationTemplateSlug } from "@/types/domain";

const AUTOMATIONS: Array<{
  slug: AutomationTemplateSlug;
  title: string;
  description: string;
  icon: LucideIcon;
  previewTitle: string;
  previewContent: string;
  previewDetail: string;
}> = [
  {
    slug: "blog-marketing",
    title: "블로그 마케팅",
    description: "사업 정보를 바탕으로 글을 만들고, WordPress가 설정되어 있으면 게시까지 이어집니다.",
    icon: FileText,
    previewTitle: "새 블로그 글 생성 완료",
    previewContent: "우리 동네에서 오래 운동하는 습관을 만드는 방법",
    previewDetail: "월 · 수 · 금 10:00  /  생성 결과와 실행 기록 확인",
  },
  {
    slug: "instagram-marketing",
    title: "Instagram 마케팅",
    description: "브랜드에 맞는 게시물 아이디어와 캡션을 준비하는 자동화입니다.",
    icon: Camera,
    previewTitle: "게시물 아이디어",
    previewContent: "이번 주 회원들의 운동 루틴을 소개해 보세요",
    previewDetail: "캡션 · 해시태그 · 게시 일정",
  },
  {
    slug: "newsletter",
    title: "Newsletter",
    description: "고객에게 보낼 소식과 프로모션을 정기적으로 준비하는 자동화입니다.",
    icon: Mail,
    previewTitle: "이번 주 뉴스레터",
    previewContent: "회원님을 위한 9월 운동 소식과 새 프로그램",
    previewDetail: "제목 · 본문 · 발송 일정",
  },
  {
    slug: "customer-support",
    title: "고객 응대",
    description: "반복되는 고객 문의에 대한 답변 초안을 만드는 자동화입니다.",
    icon: MessageCircle,
    previewTitle: "문의 응답 초안",
    previewContent: "수업 시간과 체험 신청 방법을 안내해 드릴게요",
    previewDetail: "자주 묻는 질문 · 답변 초안",
  },
];

const STEPS = [
  {
    number: "01",
    icon: Building2,
    title: "사업 정보를 입력하세요",
    description: "업종, 고객, 브랜드 톤과 키워드를 등록하면 AI가 참고할 맥락이 만들어집니다.",
  },
  {
    number: "02",
    icon: CalendarClock,
    title: "업무와 시간을 정하세요",
    description: "자동화 유형을 고르고 매일 또는 원하는 요일과 시간을 설정합니다.",
  },
  {
    number: "03",
    icon: Sparkles,
    title: "결과를 확인하세요",
    description: "예약 실행이나 Run Now로 생성한 콘텐츠와 실행 기록을 한곳에서 확인합니다.",
  },
];

export default function LandingPage() {
  const paidPlans = ALL_PLANS.filter((plan) => plan.id !== "FREE");

  return (
    <div className="overflow-hidden">
      <section className="relative border-b bg-gradient-to-br from-slate-50 via-white to-indigo-50/70">
        <div className="pointer-events-none absolute -right-40 -top-48 h-[34rem] w-[34rem] rounded-full bg-indigo-200/30 blur-3xl" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[0.88fr_1.12fr] lg:gap-16 lg:py-24">
          <div className="max-w-2xl space-y-7">
            <Badge variant="secondary" className="border border-indigo-100 bg-indigo-50 px-3 py-1 text-indigo-700">
              반복 업무를 맡기는 가장 간단한 방법
            </Badge>
            <div className="space-y-5">
              <h1 className="text-4xl leading-[1.18] font-bold tracking-tight text-slate-950 sm:text-5xl lg:text-[clamp(2.25rem,3.3vw,3rem)]">
                사업 정보만 입력하세요.
                <br />
                <span className="text-indigo-600">마케팅 업무는 AI가</span>
                <br />
                정해진 때 실행합니다.
              </h1>
              <p className="max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
                AutoBiz에 사업체를 등록하고 자동화와 실행 시간을 선택하세요. AI가 콘텐츠를 만들고, 실행 결과를 기록합니다.
                블로그는 WordPress를 설정하면 게시까지 이어집니다.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button asChild size="lg" className="h-12 px-6">
                <Link href="/signup">무료로 시작하기 <ArrowRight className="ml-1 h-4 w-4" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 border-slate-300 bg-white/80 px-6">
                <Link href="#automations">자동화 둘러보기</Link>
              </Button>
              <Button asChild size="lg" variant="ghost" className="h-12 justify-start px-3 text-slate-700">
                <Link href="/pricing#setup-service">구축 대행 요청 <ArrowUpRight className="ml-1 h-4 w-4" /></Link>
              </Button>
            </div>
            <p className="flex items-start gap-2 text-sm text-slate-600">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
              현재 블로그 자동화 이용 가능 · Instagram, Newsletter, 고객 응대는 출시 예정
            </p>
          </div>
          <DashboardPreview />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-24" aria-labelledby="how-it-works">
        <div className="mb-10 max-w-2xl space-y-3">
          <p className="text-sm font-semibold tracking-wide text-indigo-600">HOW IT WORKS</p>
          <h2 id="how-it-works" className="text-3xl font-bold tracking-tight sm:text-4xl">한 번 설정하면, 다음 실행은 자동으로</h2>
          <p className="text-muted-foreground">사업의 맥락과 반복할 업무를 연결해 두면 매번 처음부터 시작할 필요가 없습니다.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <div key={step.number} className="rounded-2xl border bg-card p-6 shadow-sm">
                <div className="mb-8 flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Icon className="h-5 w-5" /></div>
                  <span className="text-sm font-semibold text-slate-300">{step.number}</span>
                </div>
                <h3 className="text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section id="automations" className="scroll-mt-20 bg-slate-50/80 py-20 lg:py-24" aria-labelledby="automations-title">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl space-y-3">
              <p className="text-sm font-semibold tracking-wide text-indigo-600">AUTOMATION PREVIEW</p>
              <h2 id="automations-title" className="text-3xl font-bold tracking-tight sm:text-4xl">이런 업무를 자동화할 수 있습니다</h2>
              <p className="text-muted-foreground">블로그 자동화는 현재 사용 가능합니다. 다른 화면은 출시 예정 기능의 미리보기입니다.</p>
            </div>
            <Button asChild variant="outline" className="self-start bg-white">
              <Link href="/pricing">요금제 보기 <ArrowRight className="ml-1 h-4 w-4" /></Link>
            </Button>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            {AUTOMATIONS.map((automation) => {
              const availability = AUTOMATION_AVAILABILITY[automation.slug];
              const available = availability === "AVAILABLE" || availability === "BETA";
              const Icon = automation.icon;
              return (
                <article key={automation.slug} className="flex flex-col overflow-hidden rounded-3xl border bg-white shadow-sm">
                  <div className="flex flex-1 flex-col gap-4 p-6 sm:p-7">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700"><Icon className="h-5 w-5" /></div>
                      <Badge variant={available ? "default" : "outline"}>{available ? "지금 사용 가능" : "Coming Soon"}</Badge>
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold">{automation.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{automation.description}</p>
                    </div>
                  </div>
                  <FeaturePreview
                    title={automation.title}
                    previewTitle={automation.previewTitle}
                    previewContent={automation.previewContent}
                    previewDetail={automation.previewDetail}
                    available={available}
                  />
                  <div className="flex min-h-16 items-center justify-between gap-4 px-6 py-4 sm:px-7">
                    <p className="text-xs text-muted-foreground">{available ? "블로그 글 생성 · WordPress 설정 시 게시" : "출시 예정 기능의 예시 화면"}</p>
                    {available ? (
                      <Link href="/signup" className="inline-flex shrink-0 items-center text-sm font-semibold text-indigo-600 hover:underline">
                        무료로 시작 <ArrowRight className="ml-1 h-4 w-4" />
                      </Link>
                    ) : (
                      <span className="shrink-0 text-sm font-medium text-muted-foreground">준비 중</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_0.85fr] lg:items-center lg:py-24">
        <div className="max-w-2xl space-y-5">
          <p className="text-sm font-semibold tracking-wide text-indigo-600">START SIMPLE, GROW WHEN READY</p>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">무료로 시작하고, 필요한 만큼 확장하세요</h2>
          <p className="leading-7 text-muted-foreground">
            Free 플랜에서 블로그 자동화를 체험할 수 있습니다. 더 많은 자동화와 월 실행 횟수가 필요하면 유료 플랜을 선택하세요.
            출시 예정인 자동화는 플랜과 관계없이 아직 사용할 수 없습니다.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg"><Link href="/signup">무료로 시작하기</Link></Button>
            <Button asChild size="lg" variant="outline"><Link href="/pricing">플랜 자세히 보기</Link></Button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {paidPlans.map((plan) => (
            <div key={plan.id} className="rounded-2xl border bg-card p-6 shadow-sm">
              <p className="text-sm font-semibold text-muted-foreground">{plan.name}</p>
              <p className="mt-3 text-3xl font-bold tracking-tight">₩{plan.priceMonthlyKrw.toLocaleString()}<span className="ml-1 text-sm font-normal text-muted-foreground">/월</span></p>
              <div className="mt-6 space-y-3 border-t pt-5 text-sm">
                <p className="flex items-center gap-2"><Check className="h-4 w-4 text-indigo-600" /> 자동화 최대 {plan.automationLimit}개</p>
                <p className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-indigo-600" /> 월 {plan.monthlyRunLimit}회 실행</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:pb-24">
        <div className="flex flex-col items-start gap-6 rounded-3xl bg-slate-950 px-7 py-10 text-white sm:px-10 lg:flex-row lg:items-center lg:justify-between lg:px-14 lg:py-12">
          <div className="max-w-2xl space-y-2">
            <p className="text-sm font-semibold text-indigo-300">설정이 막막하다면</p>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">우리 사업에 맞는 자동화, 함께 설정해 드릴게요.</h2>
            <p className="text-sm leading-6 text-slate-300">필요한 업무와 예산을 알려주시면 구축 대행 상담을 요청할 수 있습니다.</p>
          </div>
          <Button asChild size="lg" variant="secondary" className="shrink-0">
            <Link href="/pricing#setup-service">구축 대행 요청 <ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
