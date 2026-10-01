import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Building2, CalendarDays, CheckCircle2, CircleAlert, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMarketingCalendarPageData } from "@/server/marketing/calendar";
import { CalendarItemDialog } from "@/components/marketing/calendar-item-dialog";
import { CalendarPlanGenerator } from "@/components/marketing/calendar-plan-generator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";
import type { CalendarItem } from "@/types/domain";

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];

function currentKstMonth() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
  };
}

function parseMonth(value?: string) {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return currentKstMonth();
  const [year, month] = value.split("-").map(Number);
  return { year, month };
}

function shiftMonth(year: number, month: number, amount: number) {
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function calendarHref(month: string, businessId?: string) {
  const params = new URLSearchParams({ month });
  if (businessId) params.set("business", businessId);
  return `/calendar?${params.toString()}`;
}

function currentKstDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; business?: string }>;
}) {
  const query = await searchParams;
  const { year, month } = parseMonth(query.month);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthValue = `${year}-${String(month).padStart(2, "0")}`;
  const startDate = `${monthValue}-01`;
  const endDate = `${monthValue}-${String(daysInMonth).padStart(2, "0")}`;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const data = await getMarketingCalendarPageData(user.id, {
    businessId: query.business,
    startDate,
    endDate,
  });

  if (!data.selectedBusiness) {
    return (
      <div className="mx-auto max-w-6xl space-y-8">
        <PageHeading />
        <EmptyState
          icon={<Building2 className="size-5" />}
          title="계획을 만들 사업체가 없습니다"
          description="업체명과 기본 마케팅 정보를 등록한 뒤 진단을 완료하면 2~4주 콘텐츠 계획을 만들 수 있습니다."
          action={<Button asChild><Link href="/onboarding">사업 정보 입력하기</Link></Button>}
        />
      </div>
    );
  }

  const selectedBusiness = data.selectedBusiness;
  const itemsByDay = new Map<number, CalendarItem[]>();
  for (const item of data.items) {
    const day = Number(item.planned_date.slice(8, 10));
    itemsByDay.set(day, [...(itemsByDay.get(day) ?? []), item]);
  }
  const leadingDays = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const publishedCount = data.items.filter((item) => item.status === "PUBLISHED").length;
  const today = currentKstDate();
  const todayCount = data.items.filter((item) => item.planned_date === today).length;
  const monthTitle = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    timeZone: "Asia/Seoul",
  }).format(new Date(Date.UTC(year, month - 1, 1)));

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeading />

      {data.businesses.length > 1 ? (
        <nav className="flex flex-wrap gap-2" aria-label="캘린더 사업체 선택">
          {data.businesses.map((business) => (
            <Button key={business.id} asChild size="sm" variant={business.id === selectedBusiness.id ? "default" : "outline"}>
              <Link href={calendarHref(monthValue, business.id)}>{business.name}</Link>
            </Button>
          ))}
        </nav>
      ) : null}

      <Card className="border-blue-200 bg-blue-50/60 ring-0">
        <CardContent className="flex flex-col gap-5 pt-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-800"><Sparkles className="size-4" /> AI 자동 계획</div>
            <h2 className="mt-2 text-xl font-semibold text-slate-950">{selectedBusiness.name}의 다음 콘텐츠를 계획하세요</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              저장된 Business Profile과 최신 마케팅 진단을 바탕으로 블로그, 릴스, 쇼츠 주제와 CTA를 한 번에 만듭니다.
            </p>
            {!data.hasDiagnosis ? (
              <p className="mt-3 flex items-start gap-2 text-sm font-medium text-amber-800" role="status">
                <CircleAlert className="mt-0.5 size-4 shrink-0" /> 먼저 최신 마케팅 진단 결과가 필요합니다.
                <Link className="underline underline-offset-4" href={`/marketing/diagnosis?business=${selectedBusiness.id}`}>진단하러 가기</Link>
              </p>
            ) : (
              <p className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-700"><CheckCircle2 className="size-4" /> 최신 진단 결과를 사용할 준비가 됐습니다.</p>
            )}
          </div>
          <CalendarPlanGenerator businessId={selectedBusiness.id} disabled={!data.hasDiagnosis} />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="이번 달 콘텐츠 계획" value={`${data.items.length}건`} />
        <SummaryCard label="오늘의 콘텐츠" value={`${todayCount}건`} />
        <SummaryCard label="게시 완료" value={`${publishedCount}건`} />
      </div>

      <Card className="overflow-hidden ring-0">
        <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-slate-100">
          <Button asChild variant="outline" size="icon" aria-label="이전 달">
            <Link href={calendarHref(shiftMonth(year, month, -1), selectedBusiness.id)}><ArrowLeft className="size-4" /></Link>
          </Button>
          <div className="text-center"><CardTitle className="text-lg">{monthTitle}</CardTitle><p className="mt-1 text-xs text-slate-500">{selectedBusiness.name}</p></div>
          <Button asChild variant="outline" size="icon" aria-label="다음 달">
            <Link href={calendarHref(shiftMonth(year, month, 1), selectedBusiness.id)}><ArrowRight className="size-4" /></Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {data.items.length === 0 ? (
            <EmptyState
              icon={<CalendarDays className="size-5" />}
              title={`${monthTitle} 계획이 없습니다`}
              description={data.hasDiagnosis ? "위에서 기간을 선택하고 자동 계획 생성을 누르면 날짜별 콘텐츠 계획이 저장됩니다." : "마케팅 진단을 완료한 뒤 자동 계획을 생성할 수 있습니다."}
              className="m-5"
            />
          ) : (
            <>
              <div className="hidden md:block">
                <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50">
                  {WEEKDAYS.map((weekday) => <div key={weekday} className="px-2 py-3 text-center text-xs font-semibold text-slate-500">{weekday}</div>)}
                </div>
                <div className="grid grid-cols-7">
                  {Array.from({ length: leadingDays }, (_, index) => <div key={`empty-${index}`} className="min-h-36 border-r border-b border-slate-100 bg-slate-50/40" />)}
                  {Array.from({ length: daysInMonth }, (_, index) => index + 1).map((day) => (
                    <CalendarDay key={day} day={day} items={itemsByDay.get(day) ?? []} today={today} />
                  ))}
                </div>
              </div>

              <div className="divide-y divide-slate-100 md:hidden">
                {Array.from(itemsByDay.entries()).map(([day, items]) => {
                  const weekday = WEEKDAYS[(new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7];
                  return (
                    <section key={day} className="p-4" aria-labelledby={`calendar-day-${day}`}>
                      <p id={`calendar-day-${day}`} className="text-sm font-semibold text-slate-900">{month}월 {day}일 · {weekday}요일</p>
                      <div className="mt-3 space-y-3">{items.map((item) => <CalendarItemDialog key={item.id} item={item} isToday={item.planned_date === today} variant="card" />)}</div>
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PageHeading() {
  return (
    <div className="max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-blue-700">Marketing plan</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">마케팅 캘린더</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">날짜별 계획을 열어 주제와 목표를 확인하고, 오늘 항목을 실제 콘텐츠 생성으로 연결하세요.</p>
    </div>
  );
}

function CalendarDay({ day, items, today }: { day: number; items: CalendarItem[]; today: string }) {
  return (
    <div className="min-h-36 border-r border-b border-slate-100 p-2 last:border-r-0">
      <p className="text-xs font-semibold text-slate-500">{day}</p>
      <div className="mt-2 space-y-1.5">
        {items.slice(0, 3).map((item) => (
          <CalendarItemDialog key={item.id} item={item} isToday={item.planned_date === today} />
        ))}
        {items.length > 3 ? <p className="px-1 text-[10px] text-slate-400">+{items.length - 3}개 계획</p> : null}
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="ring-0">
      <CardContent className="pt-6"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-2 text-xl font-semibold text-slate-950">{value}</p></CardContent>
    </Card>
  );
}
