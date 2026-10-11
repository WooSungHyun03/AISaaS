import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMarketingCalendarPageData } from "@/server/marketing/calendar";
import { CalendarItemDialog } from "@/components/marketing/calendar-item-dialog";
import { CalendarPlanGenerator } from "@/components/marketing/calendar-plan-generator";
import { CalendarWorkspaceLoader } from "@/components/calendar/calendar-loader";
import { currentKstDate } from "./kst-date";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";

/** Server Actions on this page call the AI / render provider; give them room beyond the 10s default. */
export const maxDuration = 60;

function monthRange(today: string) {
  const [year, month] = today.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const value = `${year}-${String(month).padStart(2, "0")}`;
  return { startDate: `${value}-01`, endDate: `${value}-${String(last).padStart(2, "0")}` };
}

/**
 * The owner's calendar. It is an ordinary schedule first — anyone can add, move and repeat events without a
 * business profile or a diagnosis — and the AI marketing plan is an optional layer on top of it: plan items are
 * drawn in the same grid, and the planner below only appears once there is a business to plan for.
 */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ business?: string }> }) {
  const query = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const today = currentKstDate();
  const data = await getMarketingCalendarPageData(user.id, { businessId: query.business, ...monthRange(today) }).catch(() => null);
  const selectedBusiness = data?.selectedBusiness ?? null;
  const todayItems = (data?.items ?? []).filter((item) => item.planned_date === today && item.status === "PLANNED");

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader title="캘린더" description="내 일정을 자유롭게 관리하고, 마케팅 계획도 한 화면에서 확인해요." />

      <CalendarWorkspaceLoader />

      {selectedBusiness ? (
        <>
          {todayItems.length > 0 ? (
            <section aria-labelledby="today-title">
              <h2 id="today-title" className="text-lg font-bold tracking-[-0.02em]">오늘 만들 콘텐츠</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {todayItems.map((item) => <CalendarItemDialog key={item.id} item={item} variant="card" />)}
              </div>
            </section>
          ) : null}

          {(data?.businesses.length ?? 0) > 1 ? (
            <nav className="flex flex-wrap gap-2" aria-label="마케팅 계획을 만들 사업체 선택">
              {data?.businesses.map((business) => (
                <Button key={business.id} asChild size="sm" variant={business.id === selectedBusiness.id ? "default" : "outline"}>
                  <Link href={`/calendar?business=${business.id}`} aria-current={business.id === selectedBusiness.id ? "page" : undefined}>{business.name}</Link>
                </Button>
              ))}
            </nav>
          ) : null}

          <section aria-labelledby="plan-generator-title" className="rounded-2xl bg-brand-soft px-6 py-6 sm:px-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <h2 id="plan-generator-title" className="text-xl font-extrabold tracking-[-0.03em]">{selectedBusiness.name}의 다음 콘텐츠 계획 만들기</h2>
                <p className="mt-2 text-[15px] leading-7 text-muted-foreground">
                  사업 정보를 바탕으로 블로그, 유튜브 쇼츠 주제와 행동 유도 문구(CTA)를 한 번에 짜서 위 캘린더에 올려드려요.
                </p>
                {!data?.hasDiagnosis ? (
                  <p className="mt-3 flex items-start gap-2 text-sm font-semibold text-muted-foreground" role="status">
                    <CircleAlert className="mt-1 size-4 shrink-0" aria-hidden="true" />
                    <span>지금도 계획을 만들 수 있어요. <Link className="underline underline-offset-4" href={`/diagnosis?business=${selectedBusiness.id}`}>마케팅 진단</Link>을 받으면 더 정확한 주제를 짜드려요.</span>
                  </p>
                ) : (
                  <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-success"><CheckCircle2 className="size-4" aria-hidden="true" /> 진단 결과를 바탕으로 계획을 만들 수 있어요.</p>
                )}
              </div>
              <CalendarPlanGenerator businessId={selectedBusiness.id} />
            </div>
          </section>
        </>
      ) : (
        <section className="rounded-2xl border border-dashed bg-card px-6 py-6 text-sm leading-7 text-muted-foreground">
          홍보할 가게·상품·서비스를 등록하면 AI가 주제별 마케팅 계획도 짜서 이 캘린더에 올려드려요. 일정은 등록 없이도 지금 바로 쓸 수 있어요.{" "}
          <Link href="/onboarding" className="font-semibold text-primary underline underline-offset-2">홍보 대상 등록하기</Link>
        </section>
      )}
    </div>
  );
}
