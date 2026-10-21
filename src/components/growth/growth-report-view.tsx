"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";
import { StatCard, StatGroup } from "@/components/dashboard/stat-card";
import { ChannelGrowthCard } from "@/components/channels/channel-growth-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-state";
import { FormMessage } from "@/components/ui/form-message";
import { loadGrowthNarrative } from "@/app/(app)/growth-report/actions";
import { GROWTH_PERIODS, defaultGranularity, selectChannelSeries, shouldRequestNarrative, type GrowthBundle, type GrowthPeriod } from "@/lib/growth/select";
import { SOURCE_LABEL, type Comparison, type GrowthReport, type MetricSource, type Rate } from "@/server/marketing/growth-report";
import type { GrowthGranularity } from "@/server/channels/growth-series";
import { cn } from "@/lib/utils";

const GRANULARITIES: Array<{ value: GrowthGranularity; label: string }> = [
  { value: "day", label: "일별" },
  { value: "week", label: "주별" },
  { value: "month", label: "월별" },
];

function SourceBadge({ source }: { source: MetricSource }) {
  return <Badge variant={source === "ESTIMATED" ? "warning" : "outline"}>{SOURCE_LABEL[source]}</Badge>;
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

/** Segmented control: the pressed state is shown the moment it is clicked, before any content below has re-rendered. */
function Segmented<T extends string | number>({ label, options, value, onChange }: { label: string; options: Array<{ value: T; text: string }>; value: T; onChange: (next: T) => void }) {
  return (
    <nav className="flex gap-1 rounded-lg bg-muted p-1" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          aria-current={option.value === value ? "page" : undefined}
          onClick={() => onChange(option.value)}
          className={cn("rounded-md px-3 py-1.5 text-sm font-semibold transition-colors", option.value === value ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          {option.text}
        </button>
      ))}
    </nav>
  );
}

export interface GrowthReportViewProps {
  bundle: GrowthBundle;
  /** The service-internal report (content made, success rate, calendar) for each period, computed on the server. */
  internal: Record<GrowthPeriod, GrowthReport>;
  truncated: boolean;
  /** The channel-growth tables are not migrated yet: say so instead of an empty report. */
  channelsUnavailable: boolean;
  initialDays: GrowthPeriod;
  initialGranularity: GrowthGranularity | null;
  /** Business-switch links and the like, rendered by the page next to the period controls. */
  leading?: React.ReactNode;
}

/**
 * The growth report below the page heading. The server sent everything for all three periods once; the period and the
 * day / week / month view are state here, so choosing one is instant and makes no request (the URL is kept in sync
 * with history.replaceState so a link to the page shows the same view).
 */
export function GrowthReportView({ bundle, internal, truncated, channelsUnavailable, initialDays, initialGranularity, leading }: GrowthReportViewProps) {
  const [days, setDays] = useState<GrowthPeriod>(initialDays);
  const [granularity, setGranularity] = useState<GrowthGranularity | null>(initialGranularity);
  const view = granularity ?? defaultGranularity(days);
  // The buttons repaint at once; the heavy content (charts) follows with the deferred value, so rapid clicks never queue up.
  const shownDays = useDeferredValue(days);
  const shownView = useDeferredValue(view);
  const [aiNarratives, setAiNarratives] = useState<Record<string, string>>({});
  const requested = useRef(new Set<string>());

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("days", String(days));
    if (granularity) url.searchParams.set("view", granularity);
    else url.searchParams.delete("view");
    window.history.replaceState(window.history.state, "", url);
  }, [days, granularity]);

  // The AI reading is written in the background for the period being looked at; until it arrives the rule-based summary of the same numbers is shown.
  useEffect(() => {
    for (const channel of bundle.channels) {
      const key = `${channel.channelId}:${days}`;
      if (!shouldRequestNarrative({ aiNarratives: bundle.aiNarratives, aiUsed: channel.narratives[days].aiUsed, alreadyRequested: requested.current.has(key) })) continue;
      requested.current.add(key);
      loadGrowthNarrative(channel.channelId, days)
        .then((result) => {
          if (result.narrative && result.aiUsed) setAiNarratives((current) => ({ ...current, [key]: result.narrative as string }));
        })
        .catch(() => undefined);
    }
  }, [bundle.channels, bundle.aiNarratives, days]);

  const series = useMemo(
    () => bundle.channels.map((channel) => ({ channel, series: selectChannelSeries(channel, shownDays, shownView) })),
    [bundle.channels, shownDays, shownView],
  );
  const report = internal[days];
  const maxWeekly = Math.max(1, ...report.weekly.map((week) => week.count));
  const busy = shownDays !== days || shownView !== view;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">{leading}</div>
        <Segmented label="기간 선택" value={days} onChange={setDays} options={GROWTH_PERIODS.map((period) => ({ value: period, text: `최근 ${period}일` }))} />
        <Segmented label="보기 단위" value={view} onChange={setGranularity} options={GRANULARITIES.map((item) => ({ value: item.value, text: item.label }))} />
      </div>

      <section aria-labelledby="channel-growth-title" aria-busy={busy} className="space-y-5">
        <div>
          <h2 id="channel-growth-title" className="text-lg font-extrabold tracking-[-0.03em]">채널 성장 <span className="text-sm font-medium text-muted-foreground">· 최근 {shownDays}일</span></h2>
          <p className="mt-1 text-[15px] text-muted-foreground">
            이 기간 동안 콘텐츠 <strong className="tabular">{report.contentCount.current}건</strong>을 만들었어요 (<Delta comparison={report.contentCount} days={days} />).
          </p>
        </div>

        {channelsUnavailable ? (
          <FormMessage variant="info">채널 성장 기능을 준비하는 중이에요. 서비스 관리자가 데이터베이스 업데이트를 마치면 구독자·게시 활동 변화를 볼 수 있어요. 아래 서비스 내부 기록은 지금도 볼 수 있어요.</FormMessage>
        ) : bundle.channels.length === 0 ? (
          <EmptyState
            mascot="guide"
            title="아직 추적 중인 채널이 없어요"
            description="유튜브·네이버 블로그·티스토리 채널 주소를 추가하면 매일 오전 6시에 공개 통계를 모아 변화를 여기서 보여드려요."
            action={<Button asChild><Link href="/diagnosis">채널 진단으로 가기 <ArrowRight aria-hidden="true" /></Link></Button>}
          />
        ) : (
          <div className={cn("space-y-4 transition-opacity", busy && "opacity-70")}>
            {series.map(({ channel, series: channelSeries }) => (
              <ChannelGrowthCard
                key={channel.channelId}
                channel={channelSeries}
                narrative={aiNarratives[`${channel.channelId}:${shownDays}`] ?? channel.narratives[shownDays].text}
                days={shownDays}
                granularity={shownView}
                content={channel.content[shownDays] ?? undefined}
              />
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
              </StatGroup>
              <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                <SourceBadge source="INTERNAL" /> 위 숫자는 이 서비스에 남은 제작·캘린더 기록으로 계산했어요.
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
      </section>
    </div>
  );
}
