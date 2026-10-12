import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMarketingCalendarPageData } from "@/server/marketing/calendar";
import { CalendarItemDialog } from "@/components/marketing/calendar-item-dialog";
import { CalendarWorkspaceLoader } from "@/components/calendar/calendar-loader";
import { currentKstDate } from "./kst-date";
import { PageHeader } from "@/components/layout/page-header";

/** Server Actions on this page call the AI / render provider; give them room beyond the 10s default. */
export const maxDuration = 60;

function monthRange(today: string) {
  const [year, month] = today.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const value = `${year}-${String(month).padStart(2, "0")}`;
  return { startDate: `${value}-01`, endDate: `${value}-${String(last).padStart(2, "0")}` };
}

/** The owner's calendar: an ordinary schedule anyone can use without a business profile or any setup. */
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
      <PageHeader title="캘린더" description="일정을 자유롭게 추가하고, 옮기고, 반복해서 관리해요." />

      <CalendarWorkspaceLoader />

      {selectedBusiness && todayItems.length > 0 ? (
        <section aria-labelledby="today-title">
          <h2 id="today-title" className="text-lg font-bold tracking-[-0.02em]">오늘 만들 콘텐츠</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {todayItems.map((item) => <CalendarItemDialog key={item.id} item={item} variant="card" />)}
          </div>
        </section>
      ) : null}
    </div>
  );
}
