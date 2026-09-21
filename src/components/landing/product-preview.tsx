import { CalendarDays, Check, FileText, LayoutDashboard, Play, Sparkles } from "lucide-react";

function WindowBar({ label }: { label: string }) {
  return (
    <div className="flex h-10 items-center gap-3 border-b bg-slate-50 px-4 text-[11px] text-slate-500">
      <div className="flex gap-1.5" aria-hidden="true">
        <span className="h-2 w-2 rounded-full bg-rose-300" />
        <span className="h-2 w-2 rounded-full bg-amber-300" />
        <span className="h-2 w-2 rounded-full bg-emerald-300" />
      </div>
      <span className="mx-auto rounded-md border bg-white px-4 py-1 font-medium">{label}</span>
    </div>
  );
}

export function DashboardPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[640px] lg:max-w-none" aria-label="블로그 자동화 대시보드 제품 화면 예시">
      <div className="absolute -inset-3 rounded-[2rem] bg-indigo-200/35 blur-2xl" />
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10">
        <WindowBar label="AutoBiz / Dashboard · 데모 화면" />
        <div className="flex min-h-[390px]">
          <div className="hidden w-36 shrink-0 border-r bg-slate-50/80 p-4 sm:block">
            <p className="mb-8 text-sm font-bold tracking-tight text-slate-900">AutoBiz</p>
            <div className="space-y-2 text-[11px]">
              <p className="flex items-center gap-2 rounded-lg bg-slate-900 px-2 py-2.5 font-semibold text-white">
                <LayoutDashboard className="h-3.5 w-3.5" /> Dashboard
              </p>
              <p className="flex items-center gap-2 px-2 py-2.5 text-slate-500"><Sparkles className="h-3.5 w-3.5" /> Automations</p>
              <p className="flex items-center gap-2 px-2 py-2.5 text-slate-500"><FileText className="h-3.5 w-3.5" /> History</p>
            </div>
          </div>
          <div className="min-w-0 flex-1 p-4 sm:p-6">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">Overview</p>
                <h2 className="mt-1 text-lg font-bold text-slate-900 sm:text-xl">내 자동화 현황</h2>
              </div>
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-semibold text-indigo-700">화면 예시</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <div className="rounded-xl border p-3">
                <p className="text-[10px] text-slate-500">실행 중인 자동화</p>
                <p className="mt-2 text-xl font-bold text-slate-900">1<span className="ml-1 text-xs font-normal text-slate-400">개</span></p>
              </div>
              <div className="rounded-xl border p-3">
                <p className="text-[10px] text-slate-500">이번 달 실행</p>
                <p className="mt-2 text-xl font-bold text-slate-900">2<span className="ml-1 text-xs font-normal text-slate-400">회</span></p>
              </div>
              <div className="col-span-2 rounded-xl border p-3 sm:col-span-1">
                <p className="text-[10px] text-slate-500">다음 예약</p>
                <p className="mt-2 flex items-center gap-1 text-sm font-bold text-slate-900"><CalendarDays className="h-4 w-4 text-indigo-600" /> 월요일 10:00</p>
              </div>
            </div>
            <div className="mt-3 rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"><FileText className="h-4 w-4" /></span>
                  <div>
                    <p className="text-xs font-semibold text-slate-900">블로그 마케팅</p>
                    <p className="text-[10px] text-slate-500">피트니스 스튜디오 · 월/수/금 10:00</p>
                  </div>
                </div>
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">실행 중</span>
              </div>
              <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
                <span className="flex items-center gap-1.5 text-[11px] text-slate-600"><Check className="h-3.5 w-3.5 text-emerald-600" /> 최근 글 생성 완료</span>
                <span className="flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-[10px] font-medium text-white"><Play className="h-2.5 w-2.5" /> Run Now</span>
              </div>
            </div>
            <p className="mt-3 text-[10px] text-slate-400">예시 데이터이며 실제 고객 계정의 실행 기록이 아닙니다.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FeaturePreview({
  title,
  previewTitle,
  previewContent,
  previewDetail,
  available,
}: {
  title: string;
  previewTitle: string;
  previewContent: string;
  previewDetail: string;
  available: boolean;
}) {
  return (
    <div className="border-y bg-slate-100/70 px-4 py-5 sm:px-7" aria-label={`${title} ${available ? "제품 화면 예시" : "출시 예정 화면 예시"}`}>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-md shadow-slate-900/5">
        <WindowBar label={`AutoBiz / ${title}`} />
        <div className="grid min-h-[220px] grid-cols-[72px_1fr] sm:grid-cols-[105px_1fr]">
          <div className="border-r bg-slate-50 p-2.5 sm:p-3">
            <div className="mb-5 h-2.5 w-9 rounded bg-slate-300" />
            <div className="mb-2 h-5 rounded bg-slate-200" />
            <div className="mb-2 h-5 rounded bg-slate-100" />
            <div className="h-5 rounded bg-slate-100" />
          </div>
          <div className="min-w-0 p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] text-slate-400">자동화 / {title}</p>
                <p className="mt-1 text-sm font-bold text-slate-900">{title} 실행 결과</p>
              </div>
              <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${available ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                {available ? "사용 가능" : "출시 예정"}
              </span>
            </div>
            <div className="rounded-lg border bg-white p-3.5">
              <p className="text-[10px] font-medium text-indigo-600">{previewTitle}</p>
              <p className="mt-2 text-xs font-semibold leading-5 text-slate-800 sm:text-sm">{previewContent}</p>
              <div className="mt-3 h-1.5 w-11/12 rounded-full bg-slate-100" />
              <div className="mt-1.5 h-1.5 w-8/12 rounded-full bg-slate-100" />
            </div>
            <p className="mt-3 text-[10px] text-slate-500">{previewDetail}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
