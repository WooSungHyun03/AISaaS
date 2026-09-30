import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays, Clock3, Plus, Store } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page-state";
import type { AutomationSchedule } from "@/types/automation";
import type { AutomationStatus, Json } from "@/types/domain";

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
const STATUS_LABEL: Record<AutomationStatus, string> = {
  DRAFT: "초안",
  ACTIVE: "활성",
  PAUSED: "일시정지",
  ERROR: "확인 필요",
};

type CalendarAutomation = {
  id: string;
  name: string;
  status: AutomationStatus;
  schedule: Json;
  template_id: string;
};

type CalendarEvent = CalendarAutomation & {
  time: string;
  templateName: string;
};

function currentKstMonth() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return { year: Number(parts.find((part) => part.type === "year")?.value), month: Number(parts.find((part) => part.type === "month")?.value) };
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

function readSchedule(value: Json): AutomationSchedule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const frequency = value.frequency;
  const timeOfDay = value.timeOfDay;
  if ((frequency !== "DAILY" && frequency !== "WEEKLY") || typeof timeOfDay !== "string") return null;
  const daysOfWeek = Array.isArray(value.daysOfWeek)
    ? value.daysOfWeek.filter((day): day is number => typeof day === "number" && day >= 0 && day <= 6)
    : undefined;
  return { frequency, timeOfDay, ...(daysOfWeek?.length ? { daysOfWeek } : {}), timezone: typeof value.timezone === "string" ? value.timezone : undefined };
}

function eventLabel(slug: string, fallback: string) {
  if (slug === "blog-marketing") return "네이버 블로그 원고";
  if (slug === "instagram-marketing") return "Instagram 콘텐츠";
  if (slug === "shorts") return "광고 숏폼";
  return fallback;
}

function statusTone(status: AutomationStatus) {
  if (status === "ACTIVE") return "border-blue-200 bg-blue-50 text-blue-800";
  if (status === "ERROR") return "border-red-200 bg-red-50 text-red-800";
  if (status === "PAUSED") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export default async function MarketingCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthQuery } = await searchParams;
  const { year, month } = parseMonth(monthQuery);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: automations, error: automationError } = await supabase
    .from("automations")
    .select("id, name, status, schedule, template_id")
    .eq("user_id", user.id)
    .order("created_at");
  if (automationError) throw new Error("마케팅 일정을 불러오지 못했습니다.", { cause: automationError });

  const templateIds = [...new Set((automations ?? []).map((automation) => automation.template_id))];
  const templateResult = templateIds.length
    ? await supabase.from("automation_templates").select("id, name, slug").in("id", templateIds)
    : { data: [], error: null };
  if (templateResult.error) throw new Error("자동화 유형을 불러오지 못했습니다.", { cause: templateResult.error });
  const templateMap = new Map((templateResult.data ?? []).map((template) => [template.id, template]));

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const leadingDays = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const eventsByDay = new Map<number, CalendarEvent[]>();

  for (const automation of (automations ?? []) as CalendarAutomation[]) {
    const schedule = readSchedule(automation.schedule);
    if (!schedule) continue;
    const template = templateMap.get(automation.template_id);
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      const scheduled = schedule.frequency === "DAILY" || schedule.daysOfWeek?.includes(dayOfWeek);
      if (!scheduled) continue;
      const item: CalendarEvent = {
        ...automation,
        time: schedule.timeOfDay,
        templateName: eventLabel(template?.slug ?? "", template?.name ?? "마케팅 콘텐츠"),
      };
      eventsByDay.set(day, [...(eventsByDay.get(day) ?? []), item]);
    }
  }

  const scheduledCount = Array.from(eventsByDay.values()).reduce((sum, events) => sum + events.length, 0);
  const activeCount = (automations ?? []).filter((automation) => automation.status === "ACTIVE").length;
  const monthTitle = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", timeZone: "Asia/Seoul" }).format(new Date(Date.UTC(year, month - 1, 1)));

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-blue-700">Marketing plan</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">마케팅 캘린더</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">설정한 자동화 주기를 날짜별 콘텐츠 계획으로 확인하세요. 일시정지·오류 상태도 함께 표시됩니다.</p>
        </div>
        <Button asChild className="bg-blue-600 text-white hover:bg-blue-700"><Link href="/automations/marketplace"><Plus className="size-4" /> 콘텐츠 일정 추가</Link></Button>
      </div>

      {(automations ?? []).length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="size-5" />}
          title="아직 예정된 마케팅 콘텐츠가 없습니다"
          description="자동화를 만들고 발행 주기와 시간을 설정하면 이곳에 날짜별 계획이 표시됩니다."
          action={<Button asChild><Link href="/automations/marketplace"><Store className="size-4" /> 자동화 둘러보기</Link></Button>}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <SummaryCard label="이번 달 콘텐츠 계획" value={`${scheduledCount}건`} />
            <SummaryCard label="활성 자동화" value={`${activeCount}개`} />
            <SummaryCard label="표시 시간대" value="한국 표준시 KST" />
          </div>

          <Card className="overflow-hidden ring-0">
            <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-slate-100">
              <Button asChild variant="outline" size="icon" aria-label="이전 달"><Link href={`/marketing/calendar?month=${shiftMonth(year, month, -1)}`}><ArrowLeft className="size-4" /></Link></Button>
              <CardTitle className="text-lg">{monthTitle}</CardTitle>
              <Button asChild variant="outline" size="icon" aria-label="다음 달"><Link href={`/marketing/calendar?month=${shiftMonth(year, month, 1)}`}><ArrowRight className="size-4" /></Link></Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="hidden md:block">
                <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50">
                  {WEEKDAYS.map((weekday) => <div key={weekday} className="px-2 py-3 text-center text-xs font-semibold text-slate-500">{weekday}</div>)}
                </div>
                <div className="grid grid-cols-7">
                  {Array.from({ length: leadingDays }).map((_, index) => <div key={`empty-${index}`} className="min-h-32 border-r border-b border-slate-100 bg-slate-50/40" />)}
                  {Array.from({ length: daysInMonth }, (_, index) => index + 1).map((day) => {
                    const events = (eventsByDay.get(day) ?? []).sort((a, b) => a.time.localeCompare(b.time));
                    return (
                      <div key={day} className="min-h-32 border-r border-b border-slate-100 p-2 last:border-r-0">
                        <p className="text-xs font-semibold text-slate-500">{day}</p>
                        <div className="mt-2 space-y-1.5">
                          {events.slice(0, 3).map((event) => (
                            <Link key={`${event.id}-${day}`} href={`/automations/${event.id}`} className={`block rounded-md border px-2 py-1.5 text-[11px] leading-4 transition-opacity hover:opacity-80 ${statusTone(event.status)}`}>
                              <span className="block truncate font-semibold">{event.templateName}</span>
                              <span className="block opacity-75">{event.time} · {STATUS_LABEL[event.status]}</span>
                            </Link>
                          ))}
                          {events.length > 3 ? <p className="px-1 text-[10px] text-slate-400">+{events.length - 3}개 일정</p> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="divide-y divide-slate-100 md:hidden">
                {Array.from({ length: daysInMonth }, (_, index) => index + 1).map((day) => {
                  const events = (eventsByDay.get(day) ?? []).sort((a, b) => a.time.localeCompare(b.time));
                  if (!events.length) return null;
                  const weekday = WEEKDAYS[(new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7];
                  return (
                    <section key={day} className="p-4" aria-labelledby={`calendar-day-${day}`}>
                      <p id={`calendar-day-${day}`} className="text-sm font-semibold text-slate-900">{month}월 {day}일 · {weekday}요일</p>
                      <div className="mt-3 space-y-2">
                        {events.map((event) => (
                          <Link key={`${event.id}-${day}`} href={`/automations/${event.id}`} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Clock3 className="size-4" /></span>
                            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{event.templateName}</span><span className="block text-xs text-slate-500">{event.time} · {event.name}</span></span>
                            <Badge variant="outline" className={statusTone(event.status)}>{STATUS_LABEL[event.status]}</Badge>
                          </Link>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="ring-0">
      <CardContent className="pt-6">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="mt-2 text-xl font-semibold text-slate-950">{value}</p>
      </CardContent>
    </Card>
  );
}
