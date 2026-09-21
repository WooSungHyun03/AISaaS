import {
  Bell,
  Bookmark,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  CircleUserRound,
  Code2,
  FileText,
  FolderSearch2,
  LayoutGrid,
  Mic2,
  Newspaper,
  Play,
  Presentation,
  Search,
  Sparkles,
  Video,
} from "lucide-react";

const DISCOVERY_CATEGORIES = [
  { label: "PPT", icon: Presentation, color: "bg-orange-50 text-orange-600" },
  { label: "프로그래밍", icon: Code2, color: "bg-blue-50 text-blue-600" },
  { label: "영상 제작", icon: Video, color: "bg-violet-50 text-violet-600" },
  { label: "Voice", icon: Mic2, color: "bg-emerald-50 text-emerald-600" },
];

const TRENDING_SKILLS = [
  { rank: "01", name: "PPT 자동 생성", detail: "기획안을 발표 자료로", icon: Presentation, color: "bg-orange-50 text-orange-600" },
  { rank: "02", name: "유튜브 쇼츠 스크립트", detail: "주제를 짧은 대본으로", icon: Video, color: "bg-violet-50 text-violet-600" },
  { rank: "03", name: "데이터 분석", detail: "엑셀 데이터를 인사이트로", icon: LayoutGrid, color: "bg-emerald-50 text-emerald-600" },
];

const TODAY_AUTOMATIONS = [
  { time: "08:00", title: "블로그 글 자동 작성", detail: "AI가 새 글을 작성 중입니다", status: "완료", active: true },
  { time: "10:00", title: "관심주제 기사 수집", detail: "오늘의 주요 기사 5개", status: "예정", active: false },
  { time: "14:00", title: "채용공고 매칭 알림", detail: "새 공고를 탐색합니다", status: "예정", active: false },
  { time: "18:00", title: "유튜브 쇼츠 제작", detail: "스크립트부터 영상까지", status: "예정", active: false },
];

function Sidebar({ active }: { active: "home" | "results" }) {
  return (
    <aside className="hidden w-[116px] shrink-0 border-r border-stone-200 bg-stone-50/80 px-3 py-5 sm:block">
      <p className="px-2 text-sm font-black tracking-tight text-stone-950">AutoBiz</p>
      <div className="mt-8 space-y-2 text-[10px] font-semibold">
        <p className={`flex items-center gap-2 rounded-lg px-2 py-2.5 ${active === "home" ? "bg-blue-600 text-white" : "text-stone-500"}`}>
          <LayoutGrid className="h-3.5 w-3.5" /> 홈
        </p>
        <p className="flex items-center gap-2 px-2 py-2.5 text-stone-500"><Search className="h-3.5 w-3.5" /> AI 발견</p>
        <p className="flex items-center gap-2 px-2 py-2.5 text-stone-500"><Sparkles className="h-3.5 w-3.5" /> 자동화</p>
        <p className={`flex items-center gap-2 rounded-lg px-2 py-2.5 ${active === "results" ? "bg-blue-600 text-white" : "text-stone-500"}`}>
          <FolderSearch2 className="h-3.5 w-3.5" /> 내 결과함
        </p>
      </div>
    </aside>
  );
}

export function DailyBriefPreview() {
  return (
    <div className="min-w-0 w-full max-w-full" aria-label="AutoBiz 오늘의 브리핑 제품 화면 예시">
      <div className="overflow-hidden rounded-xl border border-stone-300 bg-white shadow-[0_24px_70px_-32px_rgba(20,35,70,0.35)]">
        <div className="flex h-11 items-center justify-between border-b border-stone-200 px-4">
          <span className="text-[11px] font-black tracking-tight sm:hidden">AutoBiz</span>
          <span className="text-[10px] font-medium text-stone-400">화면 예시</span>
          <div className="flex items-center gap-3 text-stone-500">
            <Search className="h-3.5 w-3.5" />
            <Bell className="h-3.5 w-3.5" />
            <CircleUserRound className="h-4 w-4" />
          </div>
        </div>
        <div className="flex min-h-[420px]">
          <Sidebar active="home" />
          <div className="min-w-0 flex-1 p-4 sm:p-5">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600">Daily workspace</p>
                <h2 className="mt-1 text-lg font-black tracking-tight text-stone-950">오늘의 브리핑</h2>
              </div>
              <p className="text-[10px] text-stone-400">9월 21일 월요일</p>
            </div>
            <div className="grid gap-3 lg:grid-cols-[1.08fr_0.92fr]">
              <div className="space-y-3">
                <div className="rounded-xl border border-stone-200 p-3.5">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-bold text-stone-900">무료로 먼저 탐색해보세요</p>
                    <span className="text-[9px] font-bold text-blue-600">전체 보기</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {DISCOVERY_CATEGORIES.map(({ label, icon: Icon, color }) => (
                      <div key={label} className="flex min-w-0 flex-col items-center gap-1.5 rounded-lg bg-stone-50 px-1 py-2.5 text-center">
                        <span className={`flex h-7 w-7 items-center justify-center rounded-md ${color}`}><Icon className="h-3.5 w-3.5" /></span>
                        <span className="truncate text-[8px] font-semibold text-stone-600">{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-stone-200 p-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-bold text-stone-900">지금 많이 찾는 AI 스킬</p>
                    <span className="rounded-full bg-orange-50 px-2 py-1 text-[8px] font-bold text-orange-600">이번 주</span>
                  </div>
                  <div className="divide-y divide-stone-100">
                    {TRENDING_SKILLS.map(({ rank, name, detail, icon: Icon, color }) => (
                      <div key={rank} className="flex items-center gap-2.5 py-2">
                        <span className="w-4 text-[9px] font-bold text-stone-300">{rank}</span>
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${color}`}><Icon className="h-3.5 w-3.5" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[10px] font-bold text-stone-800">{name}</p>
                          <p className="truncate text-[8px] text-stone-400">{detail}</p>
                        </div>
                        <ChevronRight className="h-3 w-3 text-stone-300" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-stone-200 p-3.5">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-bold text-stone-900">내 자동화 일정</p>
                  <span className="text-[9px] font-bold text-blue-600">전체 보기</span>
                </div>
                <div className="relative space-y-4 before:absolute before:bottom-3 before:left-[46px] before:top-3 before:w-px before:bg-blue-100">
                  {TODAY_AUTOMATIONS.map((item) => (
                    <div key={item.time} className="relative grid grid-cols-[36px_12px_1fr] items-start gap-2">
                      <span className="pt-0.5 text-[8px] font-medium text-stone-400">{item.time}</span>
                      <span className={`relative z-10 mt-1 h-2.5 w-2.5 rounded-full border-2 border-white ${item.active ? "bg-blue-600" : "bg-orange-300"}`} />
                      <div className="min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-[10px] font-bold text-stone-800">{item.title}</p>
                          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[7px] font-bold ${item.active ? "bg-emerald-50 text-emerald-600" : "bg-stone-100 text-stone-400"}`}>{item.status}</span>
                        </div>
                        <p className="mt-0.5 truncate text-[8px] text-stone-400">{item.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-[10px] text-stone-400">제품 이해를 위한 예시 데이터입니다.</p>
    </div>
  );
}

const RESULT_ITEMS = [
  { title: "블로그 마케팅 글이 도착했어요", detail: "생성형 AI를 활용하는 7가지 실무 팁", time: "오늘 08:12", icon: FileText, color: "bg-blue-50 text-blue-600", status: "완료" },
  { title: "관심주제 기사 수집", detail: "AI 산업 최신 동향 외 5건", time: "출시 예정", icon: Newspaper, color: "bg-emerald-50 text-emerald-600", status: "예정" },
  { title: "새 채용공고 매칭", detail: "프로덕트 디자이너 외 8건", time: "출시 예정", icon: BriefcaseBusiness, color: "bg-orange-50 text-orange-600", status: "예정" },
  { title: "유튜브 쇼츠 초안", detail: "60초 영상 구성과 내레이션", time: "출시 예정", icon: Play, color: "bg-violet-50 text-violet-600", status: "예정" },
];

export function ResultsInboxPreview() {
  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-stone-300 bg-white shadow-[0_22px_60px_-36px_rgba(20,35,70,0.4)]" aria-label="AutoBiz 내 결과함 제품 화면 예시">
      <div className="flex min-h-[370px]">
        <Sidebar active="results" />
        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600">Results inbox</p>
              <h3 className="mt-1 text-base font-black text-stone-950">내 결과함</h3>
            </div>
            <span className="rounded-full bg-blue-50 px-2 py-1 text-[8px] font-bold text-blue-600">새 결과 1</span>
          </div>
          <div className="mb-3 flex gap-1.5 overflow-hidden">
            {["전체 12", "블로그 4", "기사 3", "영상 2"].map((label, index) => (
              <span key={label} className={`shrink-0 rounded-md px-2.5 py-1.5 text-[8px] font-semibold ${index === 0 ? "bg-blue-600 text-white" : "bg-stone-100 text-stone-500"}`}>{label}</span>
            ))}
          </div>
          <div className="divide-y divide-stone-100 rounded-xl border border-stone-200 px-3">
            {RESULT_ITEMS.map(({ title, detail, time, icon: Icon, color, status }) => (
              <div key={title} className="flex items-center gap-3 py-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${color}`}><Icon className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] font-bold text-stone-800">{title}</p>
                  <p className="mt-0.5 truncate text-[8px] text-stone-400">{detail}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[8px] text-stone-400">{time}</p>
                  <p className={`mt-1 inline-flex items-center gap-1 text-[8px] font-bold ${status === "완료" ? "text-emerald-600" : "text-stone-400"}`}>
                    {status === "완료" ? <Check className="h-2.5 w-2.5" /> : null}{status}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 text-[8px] text-stone-400">
            <Bookmark className="h-3 w-3" /> 결과물은 자동으로 모이고 실행 기록과 함께 보관됩니다.
          </div>
        </div>
      </div>
    </div>
  );
}
