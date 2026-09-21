import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  FileText,
  Flame,
  FolderSearch2,
  ImageIcon,
  LayoutGrid,
  Mic2,
  Newspaper,
  Play,
  Presentation,
  Search,
  Sparkles,
  Video,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DailyBriefPreview, ResultsInboxPreview } from "@/components/landing/product-preview";
import { ALL_PLANS } from "@/server/billing/plans";

const SKILL_CATEGORIES: Array<{ label: string; count: string; icon: LucideIcon; color: string }> = [
  { label: "PPT & 문서", count: "12개", icon: Presentation, color: "bg-orange-50 text-orange-600" },
  { label: "프로그래밍", count: "18개", icon: Code2, color: "bg-blue-50 text-blue-600" },
  { label: "영상 제작", count: "10개", icon: Video, color: "bg-violet-50 text-violet-600" },
  { label: "Voice & 음성", count: "6개", icon: Mic2, color: "bg-emerald-50 text-emerald-600" },
  { label: "이미지 편집", count: "7개", icon: ImageIcon, color: "bg-rose-50 text-rose-600" },
  { label: "업무 자동화", count: "9개", icon: WandSparkles, color: "bg-amber-50 text-amber-600" },
];

const AI_SERVICES = [
  { name: "ChatGPT", use: "아이디어와 문서 작성", mark: "C", color: "bg-emerald-600" },
  { name: "Claude", use: "긴 문서 분석과 요약", mark: "C", color: "bg-orange-500" },
  { name: "Notion AI", use: "문서와 지식 관리", mark: "N", color: "bg-stone-900" },
  { name: "Runway", use: "AI 영상 제작", mark: "R", color: "bg-violet-600" },
  { name: "ElevenLabs", use: "AI 음성 생성", mark: "E", color: "bg-blue-600" },
];

const TRENDING_SKILLS = [
  { rank: 1, title: "PPT 자동 생성", category: "PPT · 문서", score: "12.5K" },
  { rank: 2, title: "블로그 글 작성", category: "마케팅 · 글쓰기", score: "9.3K" },
  { rank: 3, title: "유튜브 쇼츠 스크립트", category: "영상 · 콘텐츠", score: "7.1K" },
  { rank: 4, title: "엑셀 데이터 분석", category: "데이터 · 업무", score: "5.4K" },
  { rank: 5, title: "AI 이미지 생성", category: "디자인 · 이미지", score: "4.8K" },
];

const AUTOMATIONS: Array<{
  title: string;
  description: string;
  schedule: string;
  available: boolean;
  icon: LucideIcon;
}> = [
  {
    title: "채용공고 매일 탐색",
    description: "원하는 직무와 조건에 맞는 새 공고를 모아 볼 수 있도록 준비하고 있습니다.",
    schedule: "매일 오전 8시",
    available: false,
    icon: BriefcaseBusiness,
  },
  {
    title: "관심주제 기사·글 수집",
    description: "선택한 주제의 새로운 기사와 글을 한곳에 모으는 기능을 준비하고 있습니다.",
    schedule: "매일 오전 10시",
    available: false,
    icon: Newspaper,
  },
  {
    title: "블로그 마케팅 글 작성",
    description: "사업 정보와 키워드를 바탕으로 글을 만들고 WordPress 게시까지 연결합니다.",
    schedule: "원하는 요일과 시간",
    available: true,
    icon: FileText,
  },
  {
    title: "유튜브 쇼츠 매일 제작",
    description: "주제 선정부터 짧은 대본과 영상 제작까지 이어지는 기능을 준비하고 있습니다.",
    schedule: "매일 오후 6시",
    available: false,
    icon: Play,
  },
];

export default function LandingPage() {
  const plans = ALL_PLANS;

  return (
    <div className="overflow-hidden bg-[#fbfaf7] text-stone-950">
      <section className="border-b border-stone-200" aria-labelledby="hero-title">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[0.82fr_1.18fr] lg:gap-14 lg:py-24">
          <div className="min-w-0 max-w-xl">
            <p className="mb-6 text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Your daily AI workspace</p>
            <h1 id="hero-title" className="max-w-full text-[2.35rem] leading-[1.14] font-black tracking-[-0.045em] text-stone-950 sm:text-6xl lg:text-[4.25rem]">
              오늘 필요한 AI를 찾고,
              <br />
              내일 할 일은
              <br />
              <span className="text-blue-600">미리 맡기세요.</span>
            </h1>
            <p className="mt-7 max-w-lg text-base leading-7 text-stone-600 sm:text-lg">
              검증된 AI 스킬과 서비스를 무료로 탐색하고, 반복되는 업무는 자동으로 처리하세요.
              AutoBiz가 발견부터 실행까지 한곳에서 연결합니다.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button asChild size="lg" className="h-12 rounded-lg bg-blue-600 px-6 text-white hover:bg-blue-700">
                <Link href="/directory">AI 도구 무료 탐색 <ArrowRight className="ml-1 h-4 w-4" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 rounded-lg border-stone-400 bg-transparent px-6">
                <Link href="#automations">반복 업무 맡기기</Link>
              </Button>
            </div>
            <div className="mt-8 grid gap-3 border-t border-stone-200 pt-5 text-sm text-stone-600 sm:grid-cols-3">
              <p className="flex items-center gap-2"><Search className="h-4 w-4 text-blue-600" /> 무료 AI 탐색</p>
              <p className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-blue-600" /> 블로그 자동화</p>
              <p className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-blue-600" /> 실행 기록 관리</p>
            </div>
          </div>
          <DailyBriefPreview />
        </div>
      </section>

      <section id="explore" className="scroll-mt-20 border-b border-stone-200 bg-white py-20 lg:py-24" aria-labelledby="explore-title">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Explore for free</p>
              <h2 id="explore-title" className="mt-4 text-3xl font-black tracking-[-0.035em] sm:text-5xl">무료 라이브러리에서<br />필요한 AI를 발견하세요.</h2>
            </div>
            <div className="max-w-md md:text-right">
              <p className="text-sm leading-6 text-stone-500">업무 목적에 맞춰 AI 스킬과 서비스를 비교하고, 지금 주목받는 활용법까지 확인할 수 있습니다.</p>
              <Button asChild variant="outline" className="mt-4 rounded-lg bg-white">
                <Link href="/directory">전체 AI 서비스 보기 <ArrowRight className="ml-1 h-4 w-4" /></Link>
              </Button>
            </div>
          </div>

          <div className="grid border border-stone-200 lg:grid-cols-3">
            <article className="p-6 lg:border-r lg:border-stone-200 lg:p-8">
              <div className="mb-7 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold text-blue-600">01</p>
                  <h3 className="mt-2 text-xl font-black">카테고리별 AI 스킬</h3>
                  <p className="mt-2 text-sm leading-6 text-stone-500">업무에 맞는 활용법을 빠르게 찾아보세요.</p>
                </div>
                <LayoutGrid className="h-5 w-5 text-stone-400" />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {SKILL_CATEGORIES.map(({ label, count, icon: Icon, color }) => (
                  <Link key={label} href="/guides" className="group flex min-h-24 flex-col justify-between border border-stone-200 p-3.5 transition-colors hover:border-blue-300 hover:bg-blue-50/30">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}><Icon className="h-4 w-4" /></span>
                    <span>
                      <span className="block text-sm font-bold text-stone-800 group-hover:text-blue-700">{label}</span>
                      <span className="mt-0.5 block text-xs text-stone-400">{count}</span>
                    </span>
                  </Link>
                ))}
              </div>
              <Link href="/guides" className="mt-6 inline-flex items-center text-sm font-bold text-blue-600 hover:underline">전체 카테고리 보기 <ChevronRight className="h-4 w-4" /></Link>
            </article>

            <article className="border-t border-stone-200 p-6 lg:border-t-0 lg:border-r lg:p-8">
              <div className="mb-7 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold text-blue-600">02</p>
                  <h3 className="mt-2 text-xl font-black">AI 서비스 디렉토리</h3>
                  <p className="mt-2 text-sm leading-6 text-stone-500">검증된 서비스를 용도별로 비교하세요.</p>
                </div>
                <FolderSearch2 className="h-5 w-5 text-stone-400" />
              </div>
              <div className="mb-3 flex items-center gap-2 border border-stone-200 bg-stone-50 px-3 py-2.5 text-xs text-stone-400">
                <Search className="h-4 w-4" /> AI 서비스, 스킬 검색
              </div>
              <div className="divide-y divide-stone-100 border-y border-stone-200">
                {AI_SERVICES.map((service) => (
                  <Link href="/directory" key={service.name} className="group flex items-center gap-3 py-3">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-black text-white ${service.color}`}>{service.mark}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-stone-800 group-hover:text-blue-700">{service.name}</span>
                      <span className="block truncate text-xs text-stone-400">{service.use}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-stone-300" />
                  </Link>
                ))}
              </div>
              <Link href="/directory" className="mt-6 inline-flex items-center text-sm font-bold text-blue-600 hover:underline">더 많은 서비스 보기 <ChevronRight className="h-4 w-4" /></Link>
            </article>

            <article className="border-t border-stone-200 p-6 lg:border-t-0 lg:p-8">
              <div className="mb-7 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold text-blue-600">03</p>
                  <h3 className="mt-2 text-xl font-black">이번 주 뜨는 스킬</h3>
                  <p className="mt-2 text-sm leading-6 text-stone-500">최근 관심이 높아진 활용법을 확인하세요.</p>
                </div>
                <Flame className="h-5 w-5 text-orange-500" />
              </div>
              <div className="flex gap-1.5 border-b border-stone-200 pb-3">
                <span className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">주간 인기</span>
                <span className="rounded-md bg-stone-100 px-3 py-1.5 text-xs font-medium text-stone-500">월간 인기</span>
              </div>
              <div className="divide-y divide-stone-100">
                {TRENDING_SKILLS.map((skill) => (
                  <Link href="/guides" key={skill.rank} className="group flex items-center gap-3 py-3.5">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${skill.rank <= 3 ? "bg-orange-50 text-orange-600" : "bg-stone-100 text-stone-500"}`}>{skill.rank}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-stone-800 group-hover:text-blue-700">{skill.title}</span>
                      <span className="block text-xs text-stone-400">{skill.category}</span>
                    </span>
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-orange-500"><Flame className="h-3 w-3" /> {skill.score}</span>
                  </Link>
                ))}
              </div>
              <Link href="/guides" className="mt-6 inline-flex items-center text-sm font-bold text-blue-600 hover:underline">전체 랭킹 보기 <ChevronRight className="h-4 w-4" /></Link>
            </article>
          </div>
        </div>
      </section>

      <section id="automations" className="scroll-mt-20 border-b border-stone-200 py-20 lg:py-24" aria-labelledby="automations-title">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-16">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Automate your routine</p>
            <h2 id="automations-title" className="mt-4 text-3xl font-black tracking-[-0.035em] sm:text-5xl">반복되는 일은 이제,<br />AutoBiz에게 맡기세요.</h2>
            <p className="mt-5 max-w-lg text-base leading-7 text-stone-600">원하는 업무를 설정하면 정해진 시간에 자동으로 실행되고 결과물이 한곳에 쌓입니다.</p>

            <div className="mt-9 divide-y divide-stone-200 border-y border-stone-200">
              {AUTOMATIONS.map(({ title, description, schedule, available, icon: Icon }) => (
                <div key={title} className="grid grid-cols-[44px_1fr_auto] gap-3 py-5 sm:gap-4">
                  <span className={`flex h-11 w-11 items-center justify-center border ${available ? "border-blue-200 bg-blue-50 text-blue-600" : "border-stone-200 bg-white text-stone-500"}`}><Icon className="h-5 w-5" /></span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-stone-900">{title}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${available ? "bg-emerald-100 text-emerald-700" : "bg-stone-200 text-stone-600"}`}>{available ? "사용 가능" : "출시 예정"}</span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-stone-500">{description}</p>
                    <p className="mt-1 text-xs font-medium text-stone-400">{schedule}</p>
                  </div>
                  <ChevronRight className="mt-3 h-4 w-4 text-stone-300" />
                </div>
              ))}
            </div>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild className="rounded-lg bg-blue-600 hover:bg-blue-700"><Link href="/signup">블로그 자동화 시작 <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
              <Button asChild variant="outline" className="rounded-lg bg-transparent"><Link href="/pricing">플랜 확인하기</Link></Button>
            </div>
          </div>
          <ResultsInboxPreview />
        </div>
      </section>

      <section className="border-b border-stone-200 bg-white py-20 lg:py-24" aria-labelledby="pricing-title">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-10 grid gap-5 md:grid-cols-[1fr_0.7fr] md:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Pricing</p>
              <h2 id="pricing-title" className="mt-4 text-3xl font-black tracking-[-0.035em] sm:text-5xl">무료로 발견하고,<br />필요한 만큼 자동화하세요.</h2>
            </div>
            <p className="max-w-lg text-sm leading-6 text-stone-500 md:justify-self-end">AI 탐색은 무료입니다. 블로그 자동화를 체험한 뒤 더 많은 실행 횟수가 필요할 때 플랜을 확장하세요.</p>
          </div>
          <div className="grid border border-stone-200 lg:grid-cols-3">
            {plans.map((plan) => {
              const recommended = plan.id === "STARTER";
              return (
                <article key={plan.id} className={`relative flex flex-col p-6 sm:p-8 ${plan.id !== "PRO" ? "border-b border-stone-200 lg:border-r lg:border-b-0" : ""} ${recommended ? "bg-blue-50/40" : "bg-white"}`}>
                  {recommended ? <span className="absolute right-6 top-6 rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-bold text-white">추천</span> : null}
                  <p className="text-sm font-bold text-stone-600">{plan.name}</p>
                  <p className="mt-4 text-4xl font-black tracking-tight">₩{plan.priceMonthlyKrw.toLocaleString()}<span className="ml-1 text-sm font-medium text-stone-400">/월</span></p>
                  <p className="mt-3 text-sm leading-6 text-stone-500">{plan.id === "FREE" ? "AI 스킬과 서비스를 둘러보고 자동화를 체험하세요." : plan.id === "STARTER" ? "개인 사용자의 꾸준한 업무 자동화에 적합합니다." : "더 많은 실행이 필요한 팀과 사업자를 위한 플랜입니다."}</p>
                  <ul className="mt-6 flex-1 space-y-3 border-t border-stone-200 pt-6 text-sm text-stone-700">
                    {plan.features.slice(0, 4).map((feature) => <li key={feature} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />{feature}</li>)}
                  </ul>
                  <Button asChild variant={recommended ? "default" : "outline"} className={`mt-8 rounded-lg ${recommended ? "bg-blue-600 hover:bg-blue-700" : "bg-white"}`}>
                    <Link href={plan.id === "FREE" ? "/directory" : "/signup"}>{plan.id === "FREE" ? "무료로 둘러보기" : "지금 시작하기"}</Link>
                  </Button>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-[#fbfaf7] py-16 lg:py-20">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-7 px-4 sm:px-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">A more productive tomorrow</p>
            <h2 className="mt-4 text-3xl font-black tracking-[-0.035em] sm:text-4xl">지금, 더 중요한 일에 집중하세요.</h2>
            <p className="mt-3 leading-7 text-stone-500">AI를 찾는 시간과 반복 업무를 줄이고, 실행 결과만 편하게 확인하세요.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="rounded-lg bg-blue-600 hover:bg-blue-700"><Link href="/directory">무료 AI 탐색하기 <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
            <Button asChild size="lg" variant="outline" className="rounded-lg bg-transparent"><Link href="/pricing#setup-service">구축 대행 요청 <ArrowUpRight className="ml-1 h-4 w-4" /></Link></Button>
          </div>
        </div>
      </section>
    </div>
  );
}
