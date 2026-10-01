import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Camera,
  Check,
  CircleAlert,
  FilePenLine,
  Globe2,
  Sparkles,
  TrendingUp,
  Video,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DailyBriefPreview, ResultsInboxPreview } from "@/components/landing/product-preview";
import { ALL_PLANS } from "@/server/billing/plans";

const FREE_FEATURES: Array<{ title: string; description: string; icon: LucideIcon; href: string }> = [
  {
    title: "마케팅 진단",
    description: "저장한 사업 정보, 홈페이지 등록, SNS 연결과 콘텐츠 운영 상태를 점수와 체크리스트로 확인합니다.",
    icon: Activity,
    href: "/marketing/diagnosis",
  },
  {
    title: "마케팅 캘린더",
    description: "설정한 자동화 주기를 날짜별 콘텐츠 계획으로 확인하고, 활성·일시정지 상태를 함께 관리합니다.",
    icon: CalendarDays,
    href: "/calendar",
  },
];

const PAID_FEATURES: Array<{
  title: string;
  description: string;
  status: "AVAILABLE" | "BETA" | "COMING_SOON";
  note: string;
  icon: LucideIcon;
}> = [
  {
    title: "네이버 블로그용 포스팅 원고",
    description: "사업 정보와 키워드를 바탕으로 제목과 본문을 생성합니다.",
    status: "AVAILABLE",
    note: "게시 없이 복사 가능한 원고로 제공",
    icon: FilePenLine,
  },
  {
    title: "Instagram 콘텐츠 제작·게시",
    description: "브랜드 톤에 맞는 캡션과 마케팅 카드를 만들고 연결 계정에 게시합니다.",
    status: "BETA",
    note: "Professional 계정 연결 필요",
    icon: Camera,
  },
  {
    title: "광고 숏폼 제작·게시",
    description: "광고성 숏폼 제작부터 예약 게시와 자동 게시까지 준비하고 있습니다.",
    status: "COMING_SOON",
    note: "현재 생성 및 게시 불가",
    icon: Video,
  },
  {
    title: "성장 리포트",
    description: "채널별 운영 결과와 다음 마케팅 액션을 정리하는 기능을 준비하고 있습니다.",
    status: "COMING_SOON",
    note: "성과 데이터 연결 준비 중",
    icon: TrendingUp,
  },
];

const STATUS_STYLE = {
  AVAILABLE: { label: "사용 가능", className: "bg-emerald-100 text-emerald-700" },
  BETA: { label: "베타", className: "bg-blue-100 text-blue-700" },
  COMING_SOON: { label: "출시 예정", className: "bg-stone-200 text-stone-600" },
};

export default function LandingPage() {
  return (
    <div className="overflow-hidden bg-[#fbfaf7] text-stone-950">
      <section className="border-b border-stone-200" aria-labelledby="hero-title">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[0.82fr_1.18fr] lg:gap-14 lg:py-24">
          <div className="min-w-0 max-w-xl">
            <p className="mb-6 text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Marketing operations for small business</p>
            <h1 id="hero-title" className="max-w-full text-[2.35rem] leading-[1.14] font-black tracking-[-0.045em] text-stone-950 sm:text-6xl lg:text-[4.15rem]">
              사업 정보를 입력하면,
              <br />
              마케팅 계획과 콘텐츠가
              <br />
              <span className="text-blue-600">계속 이어집니다.</span>
            </h1>
            <p className="mt-7 max-w-lg text-base leading-7 text-stone-600 sm:text-lg">
              현재 마케팅 상태를 무료로 진단하고 날짜별 계획을 확인하세요. 필요한 콘텐츠는 정해진 시간에 자동으로 생성하고 결과를 한곳에서 관리합니다.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button asChild size="lg" className="h-12 rounded-lg bg-blue-600 px-6 text-white hover:bg-blue-700">
                <Link href="/marketing/diagnosis">무료 마케팅 진단 <ArrowRight className="ml-1 h-4 w-4" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 rounded-lg border-stone-400 bg-transparent px-6">
                <Link href="#marketing-automation">자동화 둘러보기</Link>
              </Button>
              <Button asChild size="lg" variant="ghost" className="h-12 rounded-lg px-4">
                <Link href="/setup-request">구축 대행 요청</Link>
              </Button>
            </div>
            <div className="mt-8 grid gap-3 border-t border-stone-200 pt-5 text-sm text-stone-600 sm:grid-cols-3">
              <p className="flex items-center gap-2"><Activity className="h-4 w-4 text-blue-600" /> 무료 진단</p>
              <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-blue-600" /> 콘텐츠 캘린더</p>
              <p className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-blue-600" /> 반복 실행</p>
            </div>
          </div>
          <DailyBriefPreview />
        </div>
      </section>

      <section className="border-b border-stone-200 bg-white py-20 lg:py-24" aria-labelledby="free-marketing-title">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-10 grid gap-5 md:grid-cols-[1fr_0.75fr] md:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Start free</p>
              <h2 id="free-marketing-title" className="mt-4 text-3xl font-black tracking-[-0.035em] sm:text-5xl">먼저 진단하고,<br />이번 달 계획을 세우세요.</h2>
            </div>
            <p className="max-w-lg text-sm leading-6 text-stone-500 md:justify-self-end">저장한 사업 정보와 실제 연결 상태를 기준으로 준비도를 확인합니다. 자동화 일정은 설정한 주기에 맞춰 캘린더에 표시됩니다.</p>
          </div>

          <div className="grid border border-stone-200 lg:grid-cols-2">
            {FREE_FEATURES.map(({ title, description, icon: Icon, href }, index) => (
              <article key={title} className={`p-6 sm:p-8 ${index === 0 ? "border-b border-stone-200 lg:border-r lg:border-b-0" : ""}`}>
                <div className="flex items-start justify-between gap-5">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Icon className="h-5 w-5" /></span>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-700">무료</span>
                </div>
                <h3 className="mt-7 text-2xl font-black tracking-tight">{title}</h3>
                <p className="mt-3 max-w-lg text-sm leading-6 text-stone-500">{description}</p>
                <Link href={href} className="mt-6 inline-flex items-center text-sm font-bold text-blue-600 hover:underline">화면 확인하기 <ArrowRight className="ml-1 h-4 w-4" /></Link>
              </article>
            ))}
          </div>

          <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>현재 진단은 저장된 홈페이지 주소, 사업 정보, SNS 연결 및 자동화 실행 상태를 사용합니다. 홈페이지·SNS 본문을 읽어 Form을 자동 작성하는 기능은 준비 중입니다.</p>
          </div>
        </div>
      </section>

      <section id="marketing-automation" className="scroll-mt-20 border-b border-stone-200 py-20 lg:py-24" aria-labelledby="automation-title">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[0.92fr_1.08fr] lg:items-center lg:gap-16">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Content automation</p>
            <h2 id="automation-title" className="mt-4 text-3xl font-black tracking-[-0.035em] sm:text-5xl">콘텐츠는 만들고,<br />일정에 맞춰 운영하세요.</h2>
            <p className="mt-5 max-w-lg text-base leading-7 text-stone-600">무료 플랜에서 먼저 체험하고, 더 많은 실행이 필요할 때 유료 플랜으로 확장하세요. 현재 사용할 수 있는 기능과 준비 중인 기능을 명확히 구분했습니다.</p>

            <div className="mt-9 divide-y divide-stone-200 border-y border-stone-200">
              {PAID_FEATURES.map(({ title, description, status, note, icon: Icon }) => {
                const statusCopy = STATUS_STYLE[status];
                return (
                  <div key={title} className="grid grid-cols-[44px_1fr] gap-4 py-5">
                    <span className={`flex h-11 w-11 items-center justify-center border ${status === "COMING_SOON" ? "border-stone-200 bg-white text-stone-500" : "border-blue-200 bg-blue-50 text-blue-600"}`}><Icon className="h-5 w-5" /></span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-stone-900">{title}</h3><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusCopy.className}`}>{statusCopy.label}</span></div>
                      <p className="mt-1 text-sm leading-6 text-stone-500">{description}</p>
                      <p className="mt-1 text-xs font-medium text-stone-400">{note}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild className="rounded-lg bg-blue-600 hover:bg-blue-700"><Link href="/automations/marketplace">자동화 선택하기 <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
              <Button asChild variant="outline" className="rounded-lg bg-transparent"><Link href="/pricing">플랜 비교</Link></Button>
            </div>
          </div>
          <ResultsInboxPreview />
        </div>
      </section>

      <section className="border-b border-stone-200 bg-white py-20 lg:py-24" aria-labelledby="profile-flow-title">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Business profile</p>
            <h2 id="profile-flow-title" className="mt-4 text-3xl font-black tracking-[-0.035em] sm:text-5xl">내 사업을 알려주면<br />콘텐츠 기준이 만들어집니다.</h2>
          </div>
          <ol className="mt-12 grid border border-stone-200 lg:grid-cols-3">
            {[
              { number: "01", title: "사업 정보 입력", description: "업체명, 업종, 설명, 타깃 고객과 브랜드 톤을 입력합니다.", icon: WandSparkles },
              { number: "02", title: "홈페이지·SNS 연결", description: "홈페이지 주소를 저장하고 Instagram 계정을 연결합니다.", icon: Globe2 },
              { number: "03", title: "진단 후 자동화 선택", description: "부족한 채널과 운영 상태를 확인하고 필요한 콘텐츠 자동화를 시작합니다.", icon: Activity },
            ].map(({ number, title, description, icon: Icon }, index) => (
              <li key={number} className={`p-6 sm:p-8 ${index < 2 ? "border-b border-stone-200 lg:border-r lg:border-b-0" : ""}`}>
                <div className="flex items-center justify-between"><span className="text-xs font-black text-blue-600">{number}</span><Icon className="h-5 w-5 text-stone-400" /></div>
                <h3 className="mt-8 text-xl font-black">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-stone-500">{description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-b border-stone-200 py-20 lg:py-24" aria-labelledby="pricing-title">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-10 grid gap-5 md:grid-cols-[1fr_0.7fr] md:items-end">
            <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Pricing</p><h2 id="pricing-title" className="mt-4 text-3xl font-black tracking-[-0.035em] sm:text-5xl">무료로 확인하고,<br />필요한 만큼 실행하세요.</h2></div>
            <p className="max-w-lg text-sm leading-6 text-stone-500 md:justify-self-end">플랜별 자동화 수와 월 실행 한도는 실제 서비스 설정을 그대로 표시합니다.</p>
          </div>
          <div className="grid border border-stone-200 lg:grid-cols-3">
            {ALL_PLANS.map((plan) => {
              const recommended = plan.id === "STARTER";
              return (
                <article key={plan.id} className={`relative flex flex-col p-6 sm:p-8 ${plan.id !== "PRO" ? "border-b border-stone-200 lg:border-r lg:border-b-0" : ""} ${recommended ? "bg-blue-50/40" : "bg-white"}`}>
                  {recommended ? <span className="absolute top-6 right-6 rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-bold text-white">추천</span> : null}
                  <p className="text-sm font-bold text-stone-600">{plan.name}</p>
                  <p className="mt-4 text-4xl font-black tracking-tight">₩{plan.priceMonthlyKrw.toLocaleString()}<span className="ml-1 text-sm font-medium text-stone-400">/월</span></p>
                  <ul className="mt-6 flex-1 space-y-3 border-t border-stone-200 pt-6 text-sm text-stone-700">
                    {plan.features.slice(0, 4).map((feature) => <li key={feature} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />{feature}</li>)}
                  </ul>
                  <Button asChild variant={recommended ? "default" : "outline"} className={`mt-8 rounded-lg ${recommended ? "bg-blue-600 hover:bg-blue-700" : "bg-white"}`}>
                    <Link href={plan.id === "FREE" ? "/signup" : `/signup?redirectTo=${encodeURIComponent(`/billing?plan=${plan.id}`)}`}>{plan.id === "FREE" ? "무료로 시작" : "플랜 선택"}</Link>
                  </Button>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-[#fbfaf7] py-16 lg:py-20">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-7 px-4 sm:px-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl"><p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Start with your business</p><h2 className="mt-4 text-3xl font-black tracking-[-0.035em] sm:text-4xl">오늘 사업 정보를 입력하고<br />첫 마케팅 계획을 확인하세요.</h2></div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="rounded-lg bg-blue-600 hover:bg-blue-700"><Link href="/signup">무료로 시작 <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
            <Button asChild size="lg" variant="outline" className="rounded-lg bg-transparent"><Link href="/setup-request">자동화 구축 맡기기 <ArrowUpRight className="ml-1 h-4 w-4" /></Link></Button>
          </div>
        </div>
      </section>
    </div>
  );
}
