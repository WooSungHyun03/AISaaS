import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-state";
import { GrowthReportView } from "@/components/growth/growth-report-view";
import { GROWTH_PERIODS, isGrowthPeriod, type GrowthPeriod } from "@/lib/growth/select";
import { buildGrowthReport, type GrowthReport } from "@/server/marketing/growth-report";
import { getGrowthBundle, type GrowthGranularity } from "@/server/channels";
import { isMissingSchemaError } from "@/server/shared/db-errors";

/** loadGrowthNarrative (a short AI call, with retries) runs from this page, like the narratives on /diagnosis. */
export const maxDuration = 60;

const DAY_MS = 86_400_000;
const ROW_LIMIT = 500;
const GRANULARITIES: readonly GrowthGranularity[] = ["day", "week", "month"];

export default async function GrowthReportPage({ searchParams }: { searchParams: Promise<{ business?: string; days?: string; view?: string }> }) {
  const query = await searchParams;
  const requestedDays = Number(query.days);
  const days: GrowthPeriod = isGrowthPeriod(requestedDays) ? requestedDays : 30;
  const granularity = GRANULARITIES.includes(query.view as GrowthGranularity) ? (query.view as GrowthGranularity) : null;

  const user = await getAuthUser();
  if (!user) redirect("/login");
  const supabase = await createClient();

  const { data: businesses, error: businessError } = await supabase.from("businesses").select("id,name,industry").eq("owner_id", user.id).order("created_at");
  if (businessError) throw new Error("사업체 정보를 불러오지 못했습니다.", { cause: businessError });
  const business = businesses?.find((item) => item.id === query.business) ?? businesses?.[0];

  const heading = (
    <PageHeader
      title="성장 리포트"
      description="등록한 채널의 공개 통계(구독자·조회수·게시 활동)를 매일 오전 6시에 모아 변화를 보여드리고, 아래에 서비스 안의 제작·캘린더 기록도 함께 보여드려요."
    />
  );
  if (!business) {
    return (
      <div className="mx-auto max-w-5xl space-y-8">
        {heading}
        <EmptyState mascot="welcome" title="사업 정보를 먼저 등록해주세요" description="사업 정보가 있어야 만든 콘텐츠와 캘린더 실행을 모아서 보여드릴 수 있어요." action={<Button asChild><Link href="/business">사업 정보 등록</Link></Button>} />
      </div>
    );
  }

  const now = new Date();
  // Every period (7 / 30 / 90 days) is prepared in one go, so choosing one afterwards needs no request. The widest
  // window is twice the longest period (this period and the one before it, for the comparison).
  const widest = Math.max(...GROWTH_PERIODS);
  const since = new Date(now.getTime() - widest * 2 * DAY_MS);
  const sinceDate = new Date(since.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);

  // Almost nothing here depends on anything else, so everything starts at once. The only chain is automations → their runs,
  // and it runs alongside the channel bundle instead of after it.
  const automationsPromise = supabase.from("automations").select("id").eq("user_id", user.id).eq("business_id", business.id);
  const [bundleResult, automationsResult, contentResult, runsResult, calendarResult] = await Promise.all([
    getGrowthBundle(business.id, now).then(
      (bundle) => ({ bundle, unavailable: false }),
      (error: unknown) => {
        if (!isMissingSchemaError(error)) throw error;
        return { bundle: { businessId: business.id, aiNarratives: false, generatedAtMs: now.getTime(), channels: [], hasAnyData: false }, unavailable: true };
      },
    ),
    automationsPromise,
    supabase.from("content_history").select("content_type,topic,created_at").eq("business_id", business.id).gte("created_at", since.toISOString()).order("created_at", { ascending: false }).limit(ROW_LIMIT),
    (async () => {
      const ids = ((await automationsPromise).data ?? []).map((automation) => automation.id);
      if (ids.length === 0) return { data: [] as Array<{ status: string; created_at: string; output: unknown }>, error: null };
      const { data, error } = await supabase.from("automation_runs").select("status,created_at,output").in("automation_id", ids).gte("created_at", since.toISOString()).order("created_at", { ascending: false }).limit(ROW_LIMIT);
      return { data: data ?? [], error };
    })(),
    supabase.from("calendar_items").select("platform,status,planned_date").eq("business_id", business.id).gte("planned_date", sinceDate).order("planned_date", { ascending: false }).limit(ROW_LIMIT),
  ]);
  if (automationsResult.error) throw new Error("만들기 설정을 불러오지 못했습니다.", { cause: automationsResult.error });
  const readError = contentResult.error || runsResult.error || calendarResult.error;
  if (readError) throw new Error("성장 리포트 데이터를 불러오지 못했습니다.", { cause: readError });

  const runs = (runsResult.data ?? []).map((run) => ({ status: run.status, created_at: run.created_at, publishedCount: 0 }));
  const internal = Object.fromEntries(
    GROWTH_PERIODS.map((period) => [period, buildGrowthReport({ now, days: period, content: contentResult.data ?? [], runs, calendar: calendarResult.data ?? [] })]),
  ) as Record<GrowthPeriod, GrowthReport>;
  const truncated = (contentResult.data?.length ?? 0) >= ROW_LIMIT || runs.length >= ROW_LIMIT;

  const businessLinks = (businesses?.length ?? 0) > 1 ? (
    <nav className="flex flex-wrap gap-2" aria-label="사업체 선택">
      {businesses?.map((item) => (
        <Button key={item.id} asChild size="sm" variant={item.id === business.id ? "default" : "outline"}>
          <Link href={`/growth-report?business=${item.id}&days=${days}`} aria-current={item.id === business.id ? "page" : undefined}>{item.name}</Link>
        </Button>
      ))}
    </nav>
  ) : <span className="text-sm font-semibold">{business.name}</span>;

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      {heading}
      <GrowthReportView
        // a different business is a different page: start its state fresh
        key={business.id}
        bundle={bundleResult.bundle}
        internal={internal}
        truncated={truncated}
        channelsUnavailable={bundleResult.unavailable}
        initialDays={days}
        initialGranularity={granularity}
        leading={businessLinks}
      />
    </div>
  );
}
