import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { GrowthLineChart } from "@/components/channels/growth-line-chart";
import { PLATFORM_LABEL } from "@/server/channels/platform";
import { cn } from "@/lib/utils";
import type { ChannelGrowthSeries, GrowthMetricSeries } from "@/server/channels/growth-series";

function MetricDelta({ metric, days }: { metric: GrowthMetricSeries; days: number }) {
  if (metric.status === "COLLECTING") return <span className="text-muted-foreground">수집 중이에요</span>;
  if (metric.absoluteDelta === null) return <span className="text-muted-foreground">비교할 이전 기간 데이터 없음</span>;

  const { absoluteDelta, deltaPercent } = metric;
  const Icon = absoluteDelta > 0 ? ArrowUpRight : absoluteDelta < 0 ? ArrowDownRight : Minus;
  const tone = absoluteDelta > 0 ? "text-success" : absoluteDelta < 0 ? "text-destructive" : "text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1", tone)}>
      <Icon className="size-3.5" aria-hidden="true" />
      <span>
        이전 {days}일 대비 {absoluteDelta > 0 ? "+" : ""}
        {absoluteDelta}
        {deltaPercent !== null ? ` (${deltaPercent > 0 ? "+" : ""}${deltaPercent}%)` : ""}
      </span>
    </span>
  );
}

function MetricCard({ metric, days }: { metric: GrowthMetricSeries; days: number }) {
  return (
    <div className="space-y-2 rounded-xl border border-border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold">{metric.label}</p>
        <p className="tabular text-lg font-bold">{metric.current === null ? "측정 불가" : metric.current.toLocaleString("ko-KR")}</p>
      </div>
      <p className="text-[13px]"><MetricDelta metric={metric} days={days} /></p>
      <GrowthLineChart points={metric.points} label={metric.label} />
    </div>
  );
}

/** One channel's growth card for /growth-report (ticket 1-7): per-metric current value + period comparison + chart, plus the channel's AI interpretation. */
export function ChannelGrowthCard({ channel, narrative, days }: { channel: ChannelGrowthSeries; narrative: string; days: number }) {
  const hasDemoSeedData = channel.metrics.some((metric) => metric.hasDemoSeedData);

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-bold">{PLATFORM_LABEL[channel.platform]}</h3>
          {hasDemoSeedData ? <Badge variant="secondary">데모 데이터</Badge> : null}
        </div>
        <a href={channel.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
          {channel.externalId} <ArrowRight className="size-3" aria-hidden="true" />
        </a>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {channel.metrics.map((metric) => <MetricCard key={metric.metric} metric={metric} days={days} />)}
      </div>

      <p className="text-[15px] leading-7">{narrative}</p>
    </div>
  );
}
