import {
  Activity,
  CalendarDays,
  Camera,
  Check,
  CircleAlert,
  CircleUserRound,
  FileText,
  Globe2,
  LayoutGrid,
  Sparkles,
  TrendingUp,
  Video,
} from "lucide-react";

const DIAGNOSIS_ITEMS = [
  { label: "사업 정보", detail: "6개 항목 입력", ready: true },
  { label: "홈페이지", detail: "주소 등록 완료", ready: true },
  { label: "Instagram", detail: "연결 필요", ready: false },
];

const CALENDAR_ITEMS = [
  { day: "23", weekday: "수", title: "네이버 블로그 원고", time: "09:00", status: "활성" },
  { day: "25", weekday: "금", title: "Instagram 콘텐츠", time: "14:00", status: "베타" },
  { day: "28", weekday: "월", title: "네이버 블로그 원고", time: "09:00", status: "활성" },
];

function PreviewSidebar({ active }: { active: "diagnosis" | "results" }) {
  return (
    <aside className="hidden w-[116px] shrink-0 border-r border-stone-200 bg-stone-50/80 px-3 py-5 sm:block">
      <p className="px-2 text-sm font-black tracking-tight text-stone-950">AutoBiz</p>
      <div className="mt-8 space-y-2 text-[10px] font-semibold">
        <p className="flex items-center gap-2 px-2 py-2.5 text-stone-500"><LayoutGrid className="h-3.5 w-3.5" /> 홈</p>
        <p className={`flex items-center gap-2 rounded-lg px-2 py-2.5 ${active === "diagnosis" ? "bg-blue-600 text-white" : "text-stone-500"}`}><Activity className="h-3.5 w-3.5" /> 마케팅</p>
        <p className="flex items-center gap-2 px-2 py-2.5 text-stone-500"><CalendarDays className="h-3.5 w-3.5" /> 캘린더</p>
        <p className={`flex items-center gap-2 rounded-lg px-2 py-2.5 ${active === "results" ? "bg-blue-600 text-white" : "text-stone-500"}`}><Sparkles className="h-3.5 w-3.5" /> 결과함</p>
      </div>
    </aside>
  );
}

export function DailyBriefPreview() {
  return (
    <div className="min-w-0 w-full max-w-full" aria-label="AutoBiz 마케팅 진단과 캘린더 제품 화면 예시">
      <div className="overflow-hidden rounded-xl border border-stone-300 bg-white shadow-[0_24px_70px_-32px_rgba(20,35,70,0.35)]">
        <div className="flex h-11 items-center justify-between border-b border-stone-200 px-4">
          <span className="text-[11px] font-black tracking-tight sm:hidden">AutoBiz</span>
          <span className="text-[10px] font-medium text-stone-400">제품 화면 예시</span>
          <CircleUserRound className="h-4 w-4 text-stone-500" />
        </div>
        <div className="flex min-h-[420px]">
          <PreviewSidebar active="diagnosis" />
          <div className="min-w-0 flex-1 p-4 sm:p-5">
            <div className="mb-4">
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-blue-600">Free marketing check</p>
              <h2 className="mt-1 text-lg font-black tracking-tight text-stone-950">마케팅 진단</h2>
            </div>
            <div className="grid gap-3 lg:grid-cols-[0.8fr_1.2fr]">
              <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
                <p className="text-[10px] font-bold text-stone-700">현재 마케팅 점수</p>
                <p className="mt-2 text-3xl font-black text-stone-950">68<span className="ml-1 text-[10px] font-medium text-stone-400">/ 100</span></p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white"><div className="h-full w-[68%] rounded-full bg-blue-600" /></div>
                <p className="mt-3 text-[9px] leading-4 text-stone-500">핵심 채널을 조금 더 채워보세요.</p>
              </div>
              <div className="rounded-xl border border-stone-200 p-3.5">
                <p className="text-[10px] font-bold text-stone-900">채널 준비 상태</p>
                <div className="mt-2 divide-y divide-stone-100">
                  {DIAGNOSIS_ITEMS.map((item) => (
                    <div key={item.label} className="flex items-center gap-2 py-2">
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full ${item.ready ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>{item.ready ? <Check className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />}</span>
                      <span className="min-w-0 flex-1"><span className="block text-[9px] font-bold text-stone-800">{item.label}</span><span className="block truncate text-[8px] text-stone-400">{item.detail}</span></span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-stone-200 p-3.5">
              <div className="flex items-center justify-between"><p className="text-[10px] font-bold text-stone-900">이번 주 마케팅 계획</p><span className="text-[8px] font-bold text-blue-600">캘린더 보기</span></div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {CALENDAR_ITEMS.map((item) => (
                  <div key={`${item.day}-${item.title}`} className="rounded-lg bg-stone-50 p-2.5">
                    <div className="flex items-center justify-between"><span className="text-[9px] font-black text-stone-700">{item.day}일 · {item.weekday}</span><span className="text-[7px] font-bold text-blue-600">{item.status}</span></div>
                    <p className="mt-2 truncate text-[9px] font-bold text-stone-800">{item.title}</p>
                    <p className="mt-0.5 text-[8px] text-stone-400">{item.time} KST</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-[10px] text-stone-400">점수와 일정은 제품 이해를 위한 예시입니다.</p>
    </div>
  );
}

const RESULT_ITEMS = [
  { title: "네이버 블로그용 원고", detail: "우리 가게가 사랑받는 이유 5가지", time: "오늘 09:12", icon: FileText, color: "bg-blue-50 text-blue-600", status: "원고 완료" },
  { title: "Instagram 콘텐츠", detail: "브랜드 캡션과 마케팅 카드", time: "오늘 14:05", icon: Camera, color: "bg-pink-50 text-pink-600", status: "게시 완료" },
  { title: "광고 숏폼 제작", detail: "제작·예약·자동 게시", time: "출시 예정", icon: Video, color: "bg-violet-50 text-violet-600", status: "준비 중" },
  { title: "성장 리포트", detail: "채널별 성과와 다음 액션", time: "출시 예정", icon: TrendingUp, color: "bg-emerald-50 text-emerald-600", status: "준비 중" },
];

export function ResultsInboxPreview() {
  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-stone-300 bg-white shadow-[0_22px_60px_-36px_rgba(20,35,70,0.4)]" aria-label="AutoBiz 마케팅 결과함 제품 화면 예시">
      <div className="flex min-h-[370px]">
        <PreviewSidebar active="results" />
        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <div><p className="text-[9px] font-bold uppercase tracking-[0.16em] text-blue-600">Marketing results</p><h3 className="mt-1 text-base font-black text-stone-950">콘텐츠 결과함</h3></div>
            <span className="rounded-full bg-blue-50 px-2 py-1 text-[8px] font-bold text-blue-600">새 결과 2</span>
          </div>
          <div className="mb-3 flex gap-1.5 overflow-hidden">
            {["전체", "블로그", "SNS", "리포트"].map((label, index) => <span key={label} className={`shrink-0 rounded-md px-2.5 py-1.5 text-[8px] font-semibold ${index === 0 ? "bg-blue-600 text-white" : "bg-stone-100 text-stone-500"}`}>{label}</span>)}
          </div>
          <div className="divide-y divide-stone-100 rounded-xl border border-stone-200 px-3">
            {RESULT_ITEMS.map(({ title, detail, time, icon: Icon, color, status }) => (
              <div key={title} className="flex items-center gap-3 py-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${color}`}><Icon className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1"><p className="truncate text-[10px] font-bold text-stone-800">{title}</p><p className="mt-0.5 truncate text-[8px] text-stone-400">{detail}</p></div>
                <div className="shrink-0 text-right"><p className="text-[8px] text-stone-400">{time}</p><p className={`mt-1 text-[8px] font-bold ${status.includes("완료") ? "text-emerald-600" : "text-stone-400"}`}>{status}</p></div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 text-[8px] text-stone-400"><Globe2 className="h-3 w-3" /> 네이버 블로그는 게시 없이 복사 가능한 원고로 제공합니다.</div>
        </div>
      </div>
    </div>
  );
}
