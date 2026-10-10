import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { StatCard, StatGroup } from "@/components/dashboard/stat-card";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-state";
import { buildGrowthReport, SOURCE_LABEL, type Comparison, type MetricSource, type Rate, type RunRow } from "@/server/marketing/growth-report";
import { getChannelGrowthSeries, getOrCreateGrowthNarrative } from "@/server/channels";
import { ChannelGrowthCard } from "@/components/channels/channel-growth-card";
import { cn } from "@/lib/utils";

const PERIODS = [7, 30, 90] as const;
const DAY_MS = 86_400_000;
const ROW_LIMIT = 500;

function publishedCount(output: unknown): number {
  if (!output || typeof output !== "object" || Array.isArray(output)) return 0;
  const results = (output as Record<string, unknown>).publicationResults;
  if (!results || typeof results !== "object" || Array.isArray(results)) return 0;
  return Object.values(results).filter((value) => value && typeof value === "object" && typeof (value as Record<string, unknown>).externalId === "string").length;
}

function SourceBadge({ source }: { source: MetricSource }) {
  return <Badge variant={source === "UNAVAILABLE" ? "secondary" : source === "ESTIMATED" ? "warning" : "outline"}>{SOURCE_LABEL[source]}</Badge>;
}

function Delta({ comparison, unit = "건", days }: { comparison: Comparison; unit?: string; days: number }) {
  const { delta, deltaPercent } = comparison;
  const Icon = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : Minus;
  const tone = delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1", tone)}>
      <Icon className="size-3.5" aria-hidden="true" />
      <span>이전 {days}일 {comparison.previous}{unit} 대비 {delta > 0 ? "+" : ""}{delta}{unit}{deltaPercent !== null ? ` (${deltaPercent > 0 ? "+" : ""}${deltaPercent}%)` : ""}</span>
    </span>
  );
}

function rateHint(rate: Rate | null, days: number) {
  if (!rate) return "아직 집계할 기록이 없어요.";
  const done = Math.round((rate.current / 100) * rate.currentOf);
  return (
    <>
      {rate.currentOf}건 중 {done}건
      {rate.previousOf > 0 ? <> · 이전 {days}일 {rate.previous}% ({rate.delta > 0 ? "+" : ""}{rate.delta}%p)</> : null}
    </>
  );
}

export default async function GrowthReportPage({ searchParams }: { searchParams: Promise<{ business?: string; days?: string }> }) {
  const query = await searchParams;
  const requestedDays = Number(query.days);
  const days = (PERIODS as readonly number[]).includes(requestedDays) ? requestedDays : 30;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: businesses, error: businessError } = await supabase.from("businesses").select("id,name,industry").eq("owner_id", user.id).order("created_at");
  if (businessError) throw new Error("사업체 정보를 불러오지 못했습니다.", { cause: businessError });
  const business = businesses?.find((item) => item.id === query.business) ?? businesses?.[0];

  const heading = (
    <PageHeader
      title="성장 리포트"
      description="채널별 구독자·게시 활동이 어떻게 변하고 있는지 먼저 보여드리고, 아래에 서비스 내부 제작·캘린더 기록도 함께 보여드려요. 조회수 같은 외부 성과는 확인할 수 있을 때만 보여드려요."
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
  const since = new Date(now.getTime() - days * 2 * DAY_MS);
  const sinceDate = new Date(since.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);

  const growthSeries = await getChannelGrowthSeries(business.id, { days, now });
  const channelNarratives = await Promise.all(
    growthSeries.channels.map((channel) =>
      getOrCreateGrowthNarrative({ id: channel.channelId, business_id: business.id }, channel, business, days, now),
    ),
  );

  const { data: automations, error: automationError } = await supabase.from("automations").select("id").eq("user_id", user.id).eq("business_id", business.id);
  if (automationError) throw new Error("만들기 설정을 불러오지 못했습니다.", { cause: automationError });
  const automationIds = (automations ?? []).map((automation) => automation.id);

  const [contentResult, runsResult, calendarResult] = await Promise.all([
    supabase.from("content_history").select("content_type,topic,created_at").eq("business_id", business.id).gte("created_at", since.toISOString()).order("created_at", { ascending: false }).limit(ROW_LIMIT),
    automationIds.length
      ? supabase.from("automation_runs").select("status,created_at,output").in("automation_id", automationIds).gte("created_at", since.toISOString()).order("created_at", { ascending: false }).limit(ROW_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("calendar_items").select("platform,status,planned_date").eq("business_id", business.id).gte("planned_date", sinceDate).order("planned_date", { ascending: false }).limit(ROW_LIMIT),
  ]);
  const readError = contentResult.error || runsResult.error || calendarResult.error;
  if (readError) throw new Error("성장 리포트 데이터를 불러오지 못했습니다.", { cause: readError });

  const runs: RunRow[] = (runsResult.data ?? []).map((run) => ({ status: run.status, created_at: run.created_at, publishedCount: publishedCount(run.output) }));
  const report = buildGrowthReport({ now, days, content: contentResult.data ?? [], runs, calendar: calendarResult.data ?? [] });
  const maxWeekly = Math.max(1, ...report.weekly.map((week) => week.count));
  const truncated = (contentResult.data?.length ?? 0) >= ROW_LIMIT || runs.length >= ROW_LIMIT;

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      {heading}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-2" aria-label="사업체 선택">
          {(businesses?.length ?? 0) > 1 ? businesses?.map((item) => (
            <Button key={item.id} asChild size="sm" variant={item.id === business.id ? "default" : "outline"}>
              <Link href={`/growth-report?business=${item.id}&days=${days}`} aria-current={item.id === business.id ? "page" : undefined}>{item.name}</Link>
            </Button>
          )) : <span className="text-sm font-semibold">{business.name}</span>}
        </nav>
        <nav className="flex gap-1 rounded-lg bg-muted p-1" aria-label="기간 선택">
          {PERIODS.map((period) => (
            <Link
              key={period}
              href={`/growth-report?business=${business.id}&days=${period}`}
              aria-current={period === days ? "page" : undefined}
              className={cn("rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", period === days ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              최근 {period}일
            </Link>
          ))}
        </nav>
      </div>

      <section aria-labelledby="channel-growth-title" className="space-y-5">
        <div>
          <h2 id="channel-growth-title" className="text-lg font-extrabold tracking-[-0.03em]">채널 성장 <span className="text-sm font-medium text-muted-foreground">· 최근 {days}일</span></h2>
          <p className="mt-1 text-[15px] text-muted-foreground">
            이 기간 동안 콘텐츠 <strong className="tabular">{report.contentCount.current}건</strong>을 만들었어요 (<Delta comparison={report.contentCount} days={days} />).
          </p>
        </div>

        {growthSeries.channels.length === 0 ? (
          <EmptyState
            mascot="guide"
            title="아직 추적 중인 채널이 없어요"
            description="유튜브·네이버 블로그·티스토리 채널을 추가하면 구독자·게시 활동 변화를 여기서 볼 수 있어요."
            action={<Button asChild><Link href="/diagnosis">채널 진단으로 가기 <ArrowRight aria-hidden="true" /></Link></Button>}
          />
        ) : (
          <div className="space-y-4">
            {growthSeries.channels.map((channel, index) => (
              <ChannelGrowthCard key={channel.channelId} channel={channel} narrative={channelNarratives[index].narrative} days={days} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="internal-report-title" className="space-y-8 border-t border-border pt-8">
        <h2 id="internal-report-title" className="text-lg font-extrabold tracking-[-0.03em]">서비스 내부 기록 <span className="text-sm font-medium text-muted-foreground">(보조 — 콘텐츠 제작·캘린더 실행 통계)</span></h2>

        {!report.hasAnyData ? (
          <EmptyState
            mascot="guide"
            title="아직 비교할 기록이 없어요"
            description="콘텐츠를 만들고 캘린더를 실행하면 여기에 변화가 쌓여요. 캘린더에서 첫 콘텐츠를 만들어 보세요."
            action={<Button asChild><Link href="/calendar">마케팅 캘린더로 가기 <ArrowRight aria-hidden="true" /></Link></Button>}
          />
        ) : (
          <>
          <section aria-labelledby="summary-title" className="space-y-3">
            <h2 id="summary-title" className="text-lg font-extrabold tracking-[-0.03em]">한눈에 보기 <span className="text-sm font-medium text-muted-foreground">· 최근 {days}일</span></h2>
            <StatGroup>
              <StatCard label="만든 콘텐츠" value={`${report.contentCount.current}건`} hint={<Delta comparison={report.contentCount} days={days} />} />
              <StatCard label="제작 성공률" value={report.successRate ? `${report.successRate.current}%` : "-"} hint={rateHint(report.successRate, days)} />
              <StatCard label="캘린더 수행률" value={report.calendarCompletion ? `${report.calendarCompletion.current}%` : "-"} hint={rateHint(report.calendarCompletion, days)} />
              <StatCard label="플랫폼 게시 확인" value={`${report.publications.current}건`} hint={<Delta comparison={report.publications} days={days} />} />
            </StatGroup>
            <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
              <SourceBadge source="INTERNAL" /> 위 숫자는 이 서비스에 남은 제작·캘린더 기록으로 계산했어요. 게시 확인은 유튜브·인스타그램이 돌려준 응답이 있을 때만 세요.
              {truncated ? " 기록이 많아 최근 500건까지만 반영했어요." : ""}
            </p>
          </section>

          {report.suggestions.length > 0 ? (
            <section aria-labelledby="suggest-title" className="space-y-3">
              <h2 id="suggest-title" className="text-lg font-extrabold tracking-[-0.03em]">이렇게 해보세요</h2>
              <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
                {report.suggestions.map((suggestion) => <li key={suggestion} className="px-5 py-3.5 text-[15px] leading-7">{suggestion}</li>)}
              </ul>
              <p className="text-[13px] text-muted-foreground">제안은 위 숫자에서 바로 계산한 규칙으로 만들었어요. 숫자에 없는 성과를 가정하지 않아요.</p>
            </section>
          ) : null}

          <section aria-labelledby="weekly-title" className="space-y-3">
            <h2 id="weekly-title" className="text-lg font-extrabold tracking-[-0.03em]">주별 제작 추이</h2>
            <div className="rounded-2xl border bg-card px-5 py-5">
              <ol className="flex h-40 items-end gap-2 sm:gap-3">
                {report.weekly.map((week) => (
                  <li key={week.label} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5 text-center">
                    <span className="tabular text-xs font-bold">{week.count}</span>
                    <span className="block w-full rounded-t-md bg-primary/80" style={{ height: `${Math.max(week.count === 0 ? 2 : 6, (week.count / maxWeekly) * 100)}%` }} aria-hidden="true" />
                    <span className="truncate text-[11px] text-muted-foreground">{week.label}</span>
                  </li>
                ))}
              </ol>
              <p className="sr-only">{report.weekly.map((week) => `${week.label} ${week.count}건`).join(", ")}</p>
            </div>
          </section>

          <div className="grid gap-8 lg:grid-cols-2">
            <section aria-labelledby="type-title" className="space-y-3">
              <h2 id="type-title" className="text-lg font-extrabold tracking-[-0.03em]">종류별 제작</h2>
              {report.byType.length === 0 ? <p className="rounded-2xl bg-muted px-5 py-6 text-sm text-muted-foreground">아직 만든 콘텐츠가 없어요.</p> : (
                <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
                  {report.byType.map((entry) => (
                    <li key={entry.type} className="flex items-center justify-between gap-3 px-5 py-3.5">
                      <span className="font-semibold">{entry.label}</span>
                      <span className="tabular text-sm"><strong>{entry.current}건</strong> <span className="text-muted-foreground">· 이전 {days}일 {entry.previous}건</span></span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="calendar-title" className="space-y-3">
              <h2 id="calendar-title" className="text-lg font-extrabold tracking-[-0.03em]">캘린더 진행</h2>
              {report.calendar.planned === 0 ? (
                <p className="rounded-2xl bg-muted px-5 py-6 text-sm text-muted-foreground">이 기간에 계획한 항목이 없어요. <Link href="/calendar" className="font-semibold text-primary underline underline-offset-2">캘린더 만들기</Link></p>
              ) : (
                <div className="space-y-3 rounded-2xl border bg-card px-5 py-4">
                  <p className="tabular text-sm"><strong>{report.calendar.done}건 제작</strong> · {report.calendar.open}건 남음{report.calendar.skipped ? ` · ${report.calendar.skipped}건 건너뜀` : ""}</p>
                  <ul className="space-y-1.5 text-sm">
                    {report.calendar.byPlatform.map((platform) => (
                      <li key={platform.platform} className="flex items-center justify-between gap-3"><span>{platform.label}</span><span className="tabular text-muted-foreground">{platform.done}/{platform.total}건 제작</span></li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </div>

          {report.topTopics.length > 0 ? (
            <section aria-labelledby="topic-title" className="space-y-3">
              <h2 id="topic-title" className="text-lg font-extrabold tracking-[-0.03em]">최근 만든 주제</h2>
              <ul className="flex flex-wrap gap-2">
                {report.topTopics.map((entry) => <li key={entry.topic}><Badge variant="brand" className="h-auto whitespace-normal py-1">{entry.topic}{entry.count > 1 ? ` ×${entry.count}` : ""}</Badge></li>)}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <section aria-labelledby="external-title" className="space-y-3">
        <h2 id="external-title" className="flex items-center gap-2 text-lg font-extrabold tracking-[-0.03em]">외부 성과 지표 <SourceBadge source="UNAVAILABLE" /></h2>
        <p className="text-[15px] leading-7 text-muted-foreground">아래 값은 지금 가져올 수 없어서 비워 뒀어요. 대신 추정한 숫자를 보여드리지 않아요.</p>
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {report.unavailable.map((entry) => (
            <li key={entry.key} className="grid gap-1 px-5 py-3.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
              <span className="font-semibold">{entry.label}</span>
              <span className="text-sm leading-6 text-muted-foreground">{entry.reason}</span>
            </li>
          ))}
        </ul>
      </section>
      </section>
    </div>
  );
}
