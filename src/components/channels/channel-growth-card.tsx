import Link from "next/link";
import { AlertCircle, ArrowDownRight, ArrowRight, ArrowUpRight, CircleCheck, Clock, ExternalLink, Info, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { GrowthLineChart } from "@/components/channels/growth-line-chart";
import { PLATFORM_LABEL } from "@/server/channels/platform";
import type { ChannelContentReport } from "@/server/channels/growth-content";
import type { ChannelCollectionInfo, ChannelGrowthSeries, GrowthGranularity, GrowthMetricSeries } from "@/server/channels/growth-series";
import { cn } from "@/lib/utils";

/** What one unit of each metric is, so a chart never shows a bare number. */
const METRIC_UNIT: Record<string, string> = {
  subscriberCount: "명",
  viewCount: "회",
  viewCountDaily: "회",
  videoCount: "개",
  matchedPostCount: "개",
  postsLast7Days: "개",
  postsLast30Days: "개",
  postCount: "개",
};

// 24-hour clock: the AM/PM wording differs between server and browser ICU data, which breaks hydration.
const KST_TIME = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const KST_DATE = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric" });
const number = (value: number | null) => (value === null ? "-" : value.toLocaleString("ko-KR"));

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
        {absoluteDelta.toLocaleString("ko-KR")}
        {deltaPercent !== null ? ` (${deltaPercent > 0 ? "+" : ""}${deltaPercent}%)` : ""}
      </span>
    </span>
  );
}

function MetricCard({ metric, days, granularity }: { metric: GrowthMetricSeries; days: number; granularity: GrowthGranularity }) {
  const unit = METRIC_UNIT[metric.metric] ?? "";
  const periodTotal = metric.kind === "FLOW";
  return (
    <div className="space-y-2 rounded-xl border border-border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold">{metric.label}</p>
        <p className="tabular text-lg font-bold">{metric.current === null ? "측정 불가" : `${metric.current.toLocaleString("ko-KR")}${periodTotal ? unit : ""}`}</p>
      </div>
      {periodTotal ? <p className="text-xs text-muted-foreground">최근 {days}일 합계</p> : null}
      <p className="text-[13px]"><MetricDelta metric={metric} days={days} /></p>
      <GrowthLineChart points={metric.points} label={metric.label} unit={unit} granularity={granularity} />
    </div>
  );
}

/** One line (plus an explanation when needed) saying how fresh the numbers are and what to expect next. */
function CollectionStatus({ collection, hasSample }: { collection: ChannelCollectionInfo; hasSample: boolean }) {
  const last = collection.lastCollectedAt ? KST_TIME.format(new Date(collection.lastCollectedAt)) : null;
  const next = collection.nextCollectionAt ? `${KST_DATE.format(new Date(collection.nextCollectionAt))} 오전 6시` : null;
  const problem =
    collection.paused ? "여러 번 연속으로 수집하지 못해 수집을 멈췄어요. 채널이 공개 상태인지 확인한 뒤 진단 화면에서 ‘다시 진단하기’를 누르면 매일 수집이 다시 시작돼요."
    : collection.state === "QUOTA_EXCEEDED" ? "YouTube 조회 한도에 걸려 잠시 쉬고 있어요. 곧 다시 수집해요."
    : collection.state === "FAILED" ? "최근 수집에 실패했어요. 마지막으로 성공한 데이터를 보여드리고 있어요."
    : collection.state === "UNAVAILABLE" ? "공개 데이터를 확인하지 못했어요. 비공개이거나 삭제된 채널일 수 있어요. 마지막으로 확인한 데이터를 보여드려요."
    : null;
  return (
    <div className="space-y-2 text-[13px]">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><Clock className="size-3.5" aria-hidden="true" />{last ? `마지막 갱신 ${last}` : "아직 수집 전이에요"}</span>
        {next ? <span>다음 수집 {next} (한국 시간)</span> : null}
        {hasSample ? <Badge variant="warning">샘플 데이터</Badge> : null}
      </p>
      {problem ? (
        <p role="status" className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 leading-5 text-warning"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{problem}</p>
      ) : collection.measuredDays === 1 ? (
        <p role="status" className="flex items-start gap-2 rounded-lg bg-brand-soft px-3 py-2.5 leading-5 text-secondary-foreground"><Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />오늘은 기준값만 저장했어요. 매일 오전 6시에 수집하고, 다음 수집부터 어제와 비교한 증감을 보여드려요.</p>
      ) : null}
    </div>
  );
}

function ContentSection({ content, days }: { content: ChannelContentReport; days: number }) {
  const videos = content.kind === "VIDEOS";
  const maxWeekly = Math.max(1, ...content.weekly.map((week) => week.count));
  return (
    <section aria-label={videos ? "영상별 성과" : "최근 게시글"} className="space-y-3">
      <h4 className="text-sm font-bold">{videos ? "영상별 성과" : "최근 게시글"} <span className="font-normal text-muted-foreground">· 확인된 {content.observedItems}개</span></h4>
      {content.items.length === 0 ? <p className="text-sm text-muted-foreground">아직 확인된 {videos ? "영상" : "게시글"}이 없어요.</p> : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">{videos ? "영상" : "제목"}</th>
                <th scope="col" className="px-3 py-2 font-semibold">게시일</th>
                {videos ? <><th scope="col" className="px-3 py-2 text-right font-semibold">조회수</th><th scope="col" className="px-3 py-2 text-right font-semibold">최근 {days}일 증가</th><th scope="col" className="px-3 py-2 text-right font-semibold">좋아요</th><th scope="col" className="px-3 py-2 text-right font-semibold">댓글</th></> : null}
              </tr>
            </thead>
            <tbody className="divide-y">
              {content.items.map((item) => (
                <tr key={item.id}>
                  <td className="max-w-[16rem] px-3 py-2">{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 font-medium text-primary hover:underline"><span className="truncate">{item.title ?? "제목 없음"}</span><ExternalLink className="size-3 shrink-0" aria-hidden="true" /></a> : <span className="truncate">{item.title ?? "제목 없음"}</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{item.publishedAt ? KST_DATE.format(new Date(item.publishedAt)) : "-"}</td>
                  {videos ? <>
                    <td className="tabular px-3 py-2 text-right">{number(item.viewCount)}</td>
                    <td className="tabular px-3 py-2 text-right">{item.viewsGained === null ? "-" : `+${item.viewsGained.toLocaleString("ko-KR")}`}</td>
                    <td className="tabular px-3 py-2 text-right">{number(item.likeCount)}</td>
                    <td className="tabular px-3 py-2 text-right">{number(item.commentCount)}</td>
                  </> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {videos ? <p className="text-xs leading-5 text-muted-foreground">‘-’는 공개되지 않았거나 아직 비교할 수집이 부족한 값이에요. 좋아요·댓글이 숨겨진 영상은 0이 아니라 ‘-’로 표시해요.</p> : null}
      {content.weekly.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">주별 게시 수 (최근 {days}일, 확인된 {videos ? "영상" : "글"} 기준)</p>
          <ul className="space-y-1" aria-label="주별 게시 수">
            {content.weekly.map((week) => (
              <li key={week.weekStart} className="flex items-center gap-2 text-xs">
                <span className="w-16 shrink-0 text-muted-foreground">{week.weekStart.slice(5).replace("-", "/")} 주</span>
                <span className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(6, (week.count / maxWeekly) * 100)}%` }} aria-hidden="true" />
                <span className="tabular font-semibold">{week.count}개</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** One channel's growth card for /growth-report: collection status, per-metric current value + period comparison + chart, per-video / per-post performance, and the AI interpretation. */
export function ChannelGrowthCard({ channel, narrative, days, granularity = "day", content }: { channel: ChannelGrowthSeries; narrative: string; days: number; granularity?: GrowthGranularity; content?: ChannelContentReport }) {
  const hasDemoSeedData = channel.metrics.some((metric) => metric.hasDemoSeedData);
  const hasSample = channel.metrics.some((metric) => metric.hasSampleData);
  const hasNothing = channel.metrics.every((metric) => metric.current === null && metric.points.every((point) => point.value === null));

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          {channel.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- the platform's own profile image URL
            <img src={channel.thumbnailUrl} alt="" width={40} height={40} className="size-10 shrink-0 rounded-full bg-muted object-cover" referrerPolicy="no-referrer" loading="lazy" />
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold">{PLATFORM_LABEL[channel.platform]}</h3>
              {hasDemoSeedData ? <Badge variant="secondary">데모 데이터</Badge> : null}
            </div>
            {channel.displayName ? <p className="truncate text-sm font-semibold">{channel.displayName}</p> : null}
          </div>
        </div>
        <a href={channel.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
          {channel.externalId} <ArrowRight className="size-3" aria-hidden="true" />
        </a>
      </div>

      <CollectionStatus collection={channel.collection} hasSample={hasSample} />

      {hasNothing ? (
        <p className="flex items-start gap-2 rounded-xl bg-muted px-4 py-4 text-sm leading-6 text-muted-foreground"><CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />아직 보여드릴 수집 데이터가 없어요. 채널을 등록한 직후에는 첫 수집이 끝나야 숫자가 나와요. 없는 값은 0으로 채우지 않아요. <Link href="/diagnosis" className="font-semibold text-primary underline underline-offset-2">채널 주소 확인하기</Link></p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {channel.metrics.map((metric) => <MetricCard key={metric.metric} metric={metric} days={days} granularity={granularity} />)}
        </div>
      )}

      {content ? <ContentSection content={content} days={days} /> : null}

      <p className="text-[15px] leading-7">{narrative}</p>
    </div>
  );
}
