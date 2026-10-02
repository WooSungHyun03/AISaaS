import { Check, CircleAlert, FileText, Camera, Video } from "lucide-react";
import { ScoreRing } from "@/components/marketing/score-ring";

/*
 * 랜딩 페이지용 "예시 화면". 실제 데이터가 아니며 화면 전체가 장식(aria-hidden)이고,
 * 캡션으로 예시임을 분명히 밝힙니다.
 */

function PreviewFrame({ children, caption, className }: { children: React.ReactNode; caption: string; className?: string }) {
  return (
    <figure className={className}>
      <div aria-hidden="true" className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_18px_50px_-24px_rgb(14_30_69/0.28)]">
        {children}
      </div>
      <figcaption className="mt-3 text-center text-[13px] text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

const DIAGNOSIS_ROWS = [
  { label: "홈페이지", detail: "소개·위치 안내가 잘 되어 있어요", ok: true },
  { label: "블로그", detail: "최근 3개월 동안 올린 글이 없어요", ok: false },
  { label: "인스타그램", detail: "일주일에 한 번도 올리지 않았어요", ok: false },
];

export function DiagnosisPreview({ className }: { className?: string }) {
  return (
    <PreviewFrame caption="예시 화면이에요. 실제 점수와 내용은 사장님의 사업 정보로 계산돼요." className={className}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <p className="text-sm font-bold">마케팅 진단</p>
        <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-primary">해온 카페</span>
      </div>
      <div className="grid gap-6 p-5 sm:grid-cols-[auto_1fr] sm:items-center">
        <ScoreRing score={68} size={132} className="mx-auto" />
        <div>
          <p className="text-base font-bold">조금만 더 채우면 돼요</p>
          <ul className="mt-3 divide-y divide-border">
            {DIAGNOSIS_ROWS.map((row) => (
              <li key={row.label} className="flex items-start gap-3 py-2.5">
                <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${row.ok ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
                  {row.ok ? <Check className="size-3" strokeWidth={3} /> : <CircleAlert className="size-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0 text-sm leading-5">
                  <span className="font-semibold">{row.label}</span>
                  <span className="block text-[13px] text-muted-foreground">{row.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </PreviewFrame>
  );
}

const CALENDAR_DAYS = [
  { day: "3", weekday: "목", platform: "블로그", topic: "단골이 늘어나는 카페 메뉴판 쓰는 법", icon: FileText, tone: "bg-brand-soft text-primary" },
  { day: "5", weekday: "토", platform: "숏폼", topic: "원두 고르는 30초 팁", icon: Video, tone: "bg-warning-soft text-warning" },
  { day: "8", weekday: "화", platform: "블로그", topic: "비 오는 날 매출을 지키는 이벤트", icon: FileText, tone: "bg-brand-soft text-primary" },
  { day: "10", weekday: "목", platform: "숏폼", topic: "오픈 준비 하루 브이로그", icon: Video, tone: "bg-warning-soft text-warning" },
];

export function CalendarPreview({ className }: { className?: string }) {
  return (
    <PreviewFrame caption="예시 화면이에요. 업종·지역·타깃 고객에 맞춰 주제가 달라져요." className={className}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <p className="text-sm font-bold">10월 마케팅 캘린더</p>
        <span className="text-xs font-medium text-muted-foreground">계획 4개</span>
      </div>
      <ul className="divide-y divide-border">
        {CALENDAR_DAYS.map((item) => (
          <li key={item.day} className="flex items-center gap-4 px-5 py-3.5">
            <div className="w-10 shrink-0 text-center">
              <p className="tabular text-xl font-extrabold leading-none">{item.day}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.weekday}</p>
            </div>
            <p className="min-w-0 flex-1 text-sm font-medium leading-5">{item.topic}</p>
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${item.tone}`}>
              <item.icon className="size-3" />
              {item.platform}
            </span>
          </li>
        ))}
      </ul>
    </PreviewFrame>
  );
}

export function BlogDraftPreview({ className }: { className?: string }) {
  return (
    <PreviewFrame caption="예시 화면이에요. 만든 글은 확인하고 고친 뒤 직접 올려요." className={className}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <p className="flex items-center gap-2 text-sm font-bold"><FileText className="size-4 text-primary" /> 블로그 글 초안</p>
        <span className="rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success">제작 완료</span>
      </div>
      <div className="space-y-3 p-5">
        <p className="text-lg font-extrabold leading-snug tracking-[-0.03em]">단골이 먼저 찾아오는 카페 메뉴판, 이렇게 바꿔봤어요</p>
        <p className="text-sm leading-7 text-muted-foreground">
          손님이 메뉴판을 보고 고민하는 시간이 길어질수록 주문은 줄어요. 저희가 가장 먼저 바꾼 건 가장 자신 있는 메뉴 세 가지를 맨 위로 올린 것이었어요…
        </p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {["동네 카페", "메뉴판 디자인", "단골 만들기"].map((tag) => (
            <span key={tag} className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">#{tag}</span>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-brand-soft px-3 py-2.5 text-[13px] text-secondary-foreground">
          <Camera className="size-4 shrink-0" /> 두 번째 문단 아래에 매장 사진을 넣어보세요
        </div>
      </div>
    </PreviewFrame>
  );
}
