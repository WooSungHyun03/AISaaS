import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMarketingCalendarPageData } from "@/server/marketing/calendar";
import { CalendarItemDialog } from "@/components/marketing/calendar-item-dialog";
import { CalendarPlanGenerator } from "@/components/marketing/calendar-plan-generator";
import { StatCard, StatGroup } from "@/components/dashboard/stat-card";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
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

/** Server Actions on this page call the AI / render provider; give them room beyond the 10s default. */
export const maxDuration = 60;

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
          mascot="guide"
          title="계획을 세울 가게가 아직 없어요"
          description="가게 정보를 등록하고 마케팅 진단을 받으면 2~4주치 콘텐츠 계획을 만들어드려요."
          action={<Button asChild><Link href="/onboarding">가게 정보 입력하기</Link></Button>}
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
  const doneCount = data.items.filter((item) => item.status === "GENERATED" || item.status === "PUBLISHED").length;
  const today = currentKstDate();
  const todayItems = data.items.filter((item) => item.planned_date === today && item.status === "PLANNED");
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
              <Link href={calendarHref(monthValue, business.id)} aria-current={business.id === selectedBusiness.id ? "page" : undefined}>{business.name}</Link>
            </Button>
          ))}
        </nav>
      ) : null}

      <section aria-labelledby="plan-generator-title" className="rounded-2xl bg-brand-soft px-6 py-6 sm:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <h2 id="plan-generator-title" className="text-xl font-extrabold tracking-[-0.03em]">{selectedBusiness.name}의 다음 콘텐츠 계획 만들기</h2>
            <p className="mt-2 text-[15px] leading-7 text-muted-foreground">
              사업 정보와 최근 마케팅 진단을 바탕으로 블로그, 릴스, 쇼츠 주제와 행동 유도 문구(CTA)를 한 번에 짜드려요.
            </p>
            {!data.hasDiagnosis ? (
              <p className="mt-3 flex items-start gap-2 text-sm font-semibold text-warning" role="status">
                <CircleAlert className="mt-1 size-4 shrink-0" aria-hidden="true" />
                <span>먼저 마케팅 진단이 필요해요. <Link className="underline underline-offset-4" href={`/marketing/diagnosis?business=${selectedBusiness.id}`}>진단하러 가기</Link></span>
              </p>
            ) : (
              <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-success"><CheckCircle2 className="size-4" aria-hidden="true" /> 진단 결과를 바탕으로 계획을 만들 수 있어요.</p>
            )}
          </div>
          <CalendarPlanGenerator businessId={selectedBusiness.id} disabled={!data.hasDiagnosis} />
        </div>
      </section>

      <StatGroup columns={3}>
        <StatCard label="이번 달 계획" value={<>{data.items.length}<span className="ml-1 text-sm font-semibold text-muted-foreground">건</span></>} />
        <StatCard label="오늘 할 콘텐츠" value={<>{todayCount}<span className="ml-1 text-sm font-semibold text-muted-foreground">건</span></>} />
        <StatCard label="제작 완료" value={<>{doneCount}<span className="ml-1 text-sm font-semibold text-muted-foreground">건</span></>} />
      </StatGroup>

      {todayItems.length > 0 ? (
        <section aria-labelledby="today-title">
          <h2 id="today-title" className="text-lg font-bold tracking-[-0.02em]">오늘 만들 콘텐츠</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {todayItems.map((item) => <CalendarItemDialog key={item.id} item={item} variant="card" />)}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="month-title" className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-6">
          <Button asChild variant="outline" size="icon-sm" aria-label="이전 달">
            <Link href={calendarHref(shiftMonth(year, month, -1), selectedBusiness.id)}><ArrowLeft aria-hidden="true" /></Link>
          </Button>
          <h2 id="month-title" className="text-lg font-extrabold tracking-[-0.03em]">{monthTitle}</h2>
          <Button asChild variant="outline" size="icon-sm" aria-label="다음 달">
            <Link href={calendarHref(shiftMonth(year, month, 1), selectedBusiness.id)}><ArrowRight aria-hidden="true" /></Link>
          </Button>
        </div>
        {data.items.length === 0 ? (
          <EmptyState
            className="m-5"
            mascot="present"
            title={`${monthTitle}에는 계획이 없어요`}
            description={data.hasDiagnosis ? "위에서 기간을 고르고 ‘계획 만들기’를 누르면 날짜별 콘텐츠 계획이 만들어져요." : "마케팅 진단을 먼저 받으면 계획을 만들 수 있어요."}
          />
        ) : (
          <>
            <div className="hidden xl:block">
              <div className="grid grid-cols-7 border-b border-border bg-muted/50">
                {WEEKDAYS.map((weekday, index) => (
                  <div key={weekday} className={`px-2 py-2.5 text-center text-[13px] font-semibold ${index >= 5 ? "text-destructive/80" : "text-muted-foreground"}`}>{weekday}</div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {Array.from({ length: leadingDays }, (_, index) => <div key={`empty-${index}`} className="min-h-32 border-b border-r border-border bg-muted/30" />)}
                {Array.from({ length: daysInMonth }, (_, index) => index + 1).map((day) => (
                  <CalendarDay key={day} day={day} dateKey={`${monthValue}-${String(day).padStart(2, "0")}`} items={itemsByDay.get(day) ?? []} today={today} />
                ))}
              </div>
            </div>

            <div className="divide-y divide-border xl:hidden">
              {Array.from(itemsByDay.entries()).sort((a, b) => a[0] - b[0]).map(([day, items]) => {
                const weekday = WEEKDAYS[(new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7];
                return (
                  <section key={day} className="p-4" aria-labelledby={`calendar-day-${day}`}>
                    <p id={`calendar-day-${day}`} className="text-sm font-bold">{month}월 {day}일 · {weekday}요일</p>
                    <div className="mt-3 space-y-3">{items.map((item) => <CalendarItemDialog key={item.id} item={item} variant="card" />)}</div>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function PageHeading() {
  return (
    <PageHeader
      title="마케팅 캘린더"
      description="날짜별 계획을 열어 주제와 목표를 확인하고, 오늘 항목은 바로 콘텐츠로 만들어보세요."
    />
  );
}

function CalendarDay({ day, dateKey, items, today }: { day: number; dateKey: string; items: CalendarItem[]; today: string }) {
  const isToday = dateKey === today;
  return (
    <div className={`min-h-32 border-b border-r border-border p-2 ${isToday ? "bg-brand-soft/60" : ""}`}>
      <p className={`tabular inline-flex size-6 items-center justify-center rounded-full text-[13px] font-semibold ${isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
        {day}
        {isToday ? <span className="sr-only"> (오늘)</span> : null}
      </p>
      <div className="mt-1.5 space-y-1.5">
        {items.slice(0, 3).map((item) => (
          <CalendarItemDialog key={item.id} item={item} />
        ))}
        {items.length > 3 ? <p className="px-1 text-[11px] font-medium text-muted-foreground">+{items.length - 3}개 더 있어요</p> : null}
      </div>
    </div>
  );
}
