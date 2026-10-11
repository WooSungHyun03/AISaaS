import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getConnection } from "@/server/connectors/integrations";
import type { MetricSource } from "@/server/marketing/growth-report";
import { ChannelsError, deltaPercent, latestBefore } from "./summary";
import { hasYouTubeAnalyticsScope } from "./youtube-analytics-scope";
import type { ChannelPlatform } from "./platform";

const DAY_MS = 86_400_000;

/**
 * Single source of truth for "which metrics this platform is allowed to
 * show in the growth chart" — ticket 1-7's structural guard. Every real
 * collector (raw-metrics.ts) already only ever writes these metric names
 * per platform, so this list should never need to filter anything out in
 * practice; it exists so a future platform/collector change can't
 * accidentally surface a view/visitor-style metric for naver_blog/tistory
 * just by writing a differently-named snapshot row — growth-series.ts
 * only ever reads metrics that appear here, nothing else.
 */
export const ALLOWED_GROWTH_METRICS: Record<ChannelPlatform, readonly string[]> = {
  youtube: ["subscriberCount", "viewCount"],
  naver_blog: ["matchedPostCount", "postsLast30Days"],
  tistory: ["postCount"],
};

/**
 * Ticket 1-10: NOT part of ALLOWED_GROWTH_METRICS above — that list is
 * static and platform-wide, but these two must only appear for a YouTube
 * channel whose business owner currently has a CONNECTED,
 * yt-analytics.readonly-scoped integration (see the
 * youtubeAnalyticsConnected check in getChannelGrowthSeries). Appending
 * them to ALLOWED_GROWTH_METRICS would show an empty/"측정 불가" row for
 * every unconnected YouTube channel instead of omitting the metric
 * entirely.
 */
const YOUTUBE_ANALYTICS_METRICS: readonly string[] = [
  "yt_analytics.views",
  "yt_analytics.estimatedMinutesWatched",
  "yt_analytics.netSubscribers",
  "yt_analytics.averageViewDuration",
];

/**
 * Analytics rows are one value *per day* (a flow), unlike subscriberCount/viewCount (a running
 * total). A period is therefore the sum of its days (the mean for an average), never "the latest
 * value" — comparing one day to another day would say nothing about growth.
 */
const ANALYTICS_AGGREGATION: Record<string, "sum" | "mean"> = {
  "yt_analytics.views": "sum",
  "yt_analytics.estimatedMinutesWatched": "sum",
  "yt_analytics.netSubscribers": "sum",
  "yt_analytics.averageViewDuration": "mean",
};

/** The API reports a day 48–72h late, so a period ends this many days before today to compare full days with full days. */
export const ANALYTICS_LAG_DAYS = 3;

export const GROWTH_METRIC_LABEL: Record<string, string> = {
  subscriberCount: "구독자 수",
  viewCount: "조회수",
  matchedPostCount: "검색된 글 수",
  postsLast30Days: "최근 30일 게시 수",
  postCount: "게시글 수",
  "yt_analytics.views": "조회수 (기간 합계)",
  "yt_analytics.estimatedMinutesWatched": "시청 시간 (기간 합계, 분)",
  "yt_analytics.netSubscribers": "구독자 증감 (기간 합계)",
  "yt_analytics.averageViewDuration": "평균 시청 지속시간 (초)",
};

/** Below this many snapshots in the current period, there isn't enough history to call it a trend yet. */
const MIN_SNAPSHOTS_FOR_TREND = 2;

export interface GrowthSeriesPoint {
  /** KST calendar date (YYYY-MM-DD). */
  date: string;
  /** The most recent known value as of this date (latestBefore) — null if nothing was collected yet by then. */
  value: number | null;
}

export interface GrowthMetricSeries {
  metric: string;
  label: string;
  /** "COLLECTING" when fewer than 2 snapshots landed in the current period — too little to call it a trend. */
  status: "OK" | "COLLECTING";
  /** Most recent value as of now. Null if this platform/channel never collected this metric (e.g. a YouTube channel with hidden subscriber count) — the metric still appears in the list, just unavailable, per ticket 1-7. */
  current: number | null;
  /** Most recent value as of `days` ago. */
  previous: number | null;
  /** current - previous, only when both are known — never a partial/misleading delta. */
  absoluteDelta: number | null;
  /** (current-previous)/previous*100, rounded; null when previous is null or zero. */
  deltaPercent: number | null;
  /** One point per day across the selected period only (ticket 1-7: the chart does not extend into the previous period). */
  points: GrowthSeriesPoint[];
  /** True if any snapshot behind this metric came from scripts/seed-growth-demo.sql — the UI must show a "데모 데이터" badge. */
  hasDemoSeedData: boolean;
  /**
   * Ticket 1-10: set only for yt_analytics.* metrics (always "EXTERNAL_VERIFIED",
   * since they only ever appear when a real OAuth-connected scope confirmed
   * them) — undefined for every other metric, which keeps their display
   * unchanged. Reuses growth-report.ts's MetricSource rather than inventing
   * a second source-classification type.
   */
  source?: MetricSource;
}

/** What the owner has to do (or wait for) before YouTube Analytics numbers appear; null when nothing is needed. */
export type YouTubeAnalyticsNoticeKind = "CONNECT" | "RECONNECT" | "CHANNEL_MISMATCH" | "API_DISABLED" | "QUOTA" | "WAITING";

export interface YouTubeAnalyticsNotice {
  kind: YouTubeAnalyticsNoticeKind;
  message: string;
}

export interface ChannelGrowthSeries {
  channelId: string;
  platform: ChannelPlatform;
  externalId: string;
  url: string;
  metrics: GrowthMetricSeries[];
  /** YouTube channels only: why owner-only Analytics numbers are missing, with the fix. */
  analyticsNotice?: YouTubeAnalyticsNotice | null;
}

export interface GrowthSeriesResult {
  businessId: string;
  days: number;
  channels: ChannelGrowthSeries[];
  hasAnyData: boolean;
}

type SnapshotRow = { channel_id: string; metric: string; value: number; recorded_at: string; source: string };

/** KST (UTC+9) calendar date for an instant. Exported for reuse by growth-narrative.ts's "already generated today" cache check. */
export function kstDate(timeMs: number): string {
  return new Date(timeMs + 9 * 3_600_000).toISOString().slice(0, 10);
}

function buildMetricSeries(metric: string, rows: Array<{ value: number; recorded_at: string; source: string }>, nowMs: number, days: number, metricSource?: MetricSource): GrowthMetricSeries {
  const currentPeriodStart = nowMs - days * DAY_MS;
  const rowsInCurrentPeriod = rows.filter((row) => Date.parse(row.recorded_at) >= currentPeriodStart);

  const current = latestBefore(rows, nowMs);
  const previous = latestBefore(rows, currentPeriodStart);
  const absoluteDelta = current !== null && previous !== null ? current - previous : null;

  const points: GrowthSeriesPoint[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const boundary = nowMs - offset * DAY_MS;
    points.push({ date: kstDate(boundary), value: latestBefore(rows, boundary) });
  }

  return {
    metric,
    label: GROWTH_METRIC_LABEL[metric] ?? metric,
    status: rowsInCurrentPeriod.length < MIN_SNAPSHOTS_FOR_TREND ? "COLLECTING" : "OK",
    current,
    previous,
    absoluteDelta,
    deltaPercent: deltaPercent(current, previous),
    points,
    hasDemoSeedData: rows.some((row) => row.source === "DEMO_SEED"),
    source: metricSource,
  };
}

function aggregate(values: number[], mode: "sum" | "mean"): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return mode === "sum" ? total : Math.round((total / values.length) * 10) / 10;
}

/** Period totals for a per-day metric: this period vs the one before it, ending ANALYTICS_LAG_DAYS ago. */
function buildFlowSeries(metric: string, rows: Array<{ value: number; recorded_at: string; source: string }>, nowMs: number, days: number): GrowthMetricSeries {
  const mode = ANALYTICS_AGGREGATION[metric] ?? "sum";
  const endMs = nowMs - ANALYTICS_LAG_DAYS * DAY_MS;
  const currentStart = endMs - days * DAY_MS;
  const previousStart = currentStart - days * DAY_MS;
  const time = (row: { recorded_at: string }) => Date.parse(row.recorded_at);
  const inCurrent = rows.filter((row) => time(row) > currentStart && time(row) <= endMs + DAY_MS);
  const inPrevious = rows.filter((row) => time(row) > previousStart && time(row) <= currentStart);

  const current = aggregate(inCurrent.map((row) => row.value), mode);
  const previous = aggregate(inPrevious.map((row) => row.value), mode);
  const byDate = new Map(inCurrent.map((row) => [kstDate(time(row)), row.value]));
  const points: GrowthSeriesPoint[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = kstDate(endMs - offset * DAY_MS);
    points.push({ date, value: byDate.get(date) ?? null });
  }

  return {
    metric,
    label: GROWTH_METRIC_LABEL[metric] ?? metric,
    status: inCurrent.length < MIN_SNAPSHOTS_FOR_TREND ? "COLLECTING" : "OK",
    current,
    previous,
    absoluteDelta: current !== null && previous !== null ? Math.round((current - previous) * 10) / 10 : null,
    deltaPercent: deltaPercent(current, previous),
    points,
    hasDemoSeedData: rows.some((row) => row.source === "DEMO_SEED"),
    source: "EXTERNAL_VERIFIED",
  };
}

/** Plain-language state of YouTube Analytics for one business, from what the connection and the last collection recorded. */
export function describeYouTubeAnalyticsState(
  connection: { status: string; metadata: unknown } | null,
): YouTubeAnalyticsNotice | null {
  if (!connection || connection.status !== "CONNECTED") {
    return { kind: "CONNECT", message: "YouTube 계정을 연결하고 Analytics 권한을 허용하면 조회수·시청 시간·구독자 증감을 정확히 볼 수 있어요." };
  }
  if (!hasYouTubeAnalyticsScope({ metadata: connection.metadata as never })) {
    return { kind: "RECONNECT", message: "Analytics 권한이 아직 없어요. 설정에서 YouTube를 다시 연결하고 ‘YouTube Analytics 보고서 보기’를 허용해주세요." };
  }
  const metadata = connection.metadata && typeof connection.metadata === "object" && !Array.isArray(connection.metadata) ? (connection.metadata as Record<string, unknown>) : {};
  const analytics = metadata.analytics && typeof metadata.analytics === "object" ? (metadata.analytics as Record<string, unknown>) : null;
  switch (analytics?.status) {
    case "TOKEN_REVOKED":
    case "SCOPE_MISSING":
      return { kind: "RECONNECT", message: "YouTube 연결이 만료됐거나 권한이 바뀌었어요. 설정에서 다시 연결해주세요." };
    case "CHANNEL_MISMATCH":
      return { kind: "CHANNEL_MISMATCH", message: "연결한 구글 계정의 채널과 추적 중인 채널이 달라요. 채널 주인 계정으로 다시 연결해주세요." };
    case "API_DISABLED":
    case "NOT_CONFIGURED":
      return { kind: "API_DISABLED", message: "서비스 쪽 YouTube Analytics 설정이 아직 끝나지 않았어요. 관리자에게 문의해주세요." };
    case "QUOTA":
      return { kind: "QUOTA", message: "YouTube 조회 한도에 걸려 잠시 쉬고 있어요. 곧 다시 수집해요." };
    case "WAITING_FOR_DATA":
      return { kind: "WAITING", message: "아직 받을 데이터가 없어요. YouTube Analytics는 보통 2~3일 늦게 집계돼요." };
    default:
      return null;
  }
}

/**
 * Per-channel, per-metric time series for the growth report (ticket 1-7):
 * current value, vs.-previous-period comparison, and a chart-ready series
 * for the selected period only. Reuses getGrowthSummary's exact "gap day"
 * rule (latestBefore) and null-handling (deltaPercent) rather than
 * reimplementing them — see summary.ts.
 *
 * Every platform's metric list comes from ALLOWED_GROWTH_METRICS, not
 * "whichever metrics this channel happens to have snapshots for": a
 * YouTube channel with a hidden subscriber count still gets a
 * `subscriberCount` entry (current/previous both null, no points), so the
 * screen can show "측정 불가" instead of silently omitting it — and a
 * naver_blog/tistory channel can never surface a metric outside its own
 * allowed list, no matter what ends up in the snapshots table.
 */
export async function getChannelGrowthSeries(businessId: string, options: { days?: number; now?: Date } = {}): Promise<GrowthSeriesResult> {
  const days = options.days ?? 30;
  const nowMs = (options.now ?? new Date()).getTime();
  const supabase = await createClient();

  const { data: channelRows, error: channelsError } = await supabase
    .from("tracked_channels")
    .select("id, platform, external_id, url")
    .eq("business_id", businessId);
  if (channelsError) throw new ChannelsError("DATABASE_ERROR", "추적 중인 채널을 불러오지 못했습니다.", { cause: channelsError });

  const channels = (channelRows ?? []) as Array<{ id: string; platform: ChannelPlatform; external_id: string; url: string }>;
  if (channels.length === 0) return { businessId, days, channels: [], hasAnyData: false };

  // Ticket 1-10: yt_analytics.* only ever shows for a currently-connected,
  // correctly-scoped YouTube integration — disconnecting (data preserved,
  // see docs/person1/PLAN_1-10.md) or a scope predating this feature both
  // fall through to false here, which is what hides those rows below.
  let youtubeAnalyticsConnected = false;
  let analyticsNotice: YouTubeAnalyticsNotice | null = null;
  if (channels.some((channel) => channel.platform === "youtube")) {
    const { data: business } = await supabase.from("businesses").select("owner_id").eq("id", businessId).maybeSingle();
    const connection = business?.owner_id ? await getConnection(supabase, business.owner_id, businessId, "youtube") : null;
    youtubeAnalyticsConnected = connection?.status === "CONNECTED" && hasYouTubeAnalyticsScope(connection);
    analyticsNotice = describeYouTubeAnalyticsState(connection);
  }

  const since = new Date(nowMs - (days * 2 + ANALYTICS_LAG_DAYS + 1) * DAY_MS).toISOString();
  const { data: snapshotRows, error: snapshotsError } = await supabase
    .from("marketing_metric_snapshots")
    .select("channel_id, metric, value, recorded_at, source")
    .in("channel_id", channels.map((channel) => channel.id))
    .gte("recorded_at", since);
  if (snapshotsError) throw new ChannelsError("DATABASE_ERROR", "채널 성장 지표를 불러오지 못했습니다.", { cause: snapshotsError });

  const snapshots = (snapshotRows ?? []) as SnapshotRow[];
  const byChannelMetric = new Map<string, SnapshotRow[]>();
  for (const row of snapshots) {
    const key = `${row.channel_id}:${row.metric}`;
    const bucket = byChannelMetric.get(key) ?? [];
    bucket.push(row);
    byChannelMetric.set(key, bucket);
  }

  const result: ChannelGrowthSeries[] = channels.map((channel) => {
    const metricNames: string[] = [...ALLOWED_GROWTH_METRICS[channel.platform]];
    if (channel.platform === "youtube" && youtubeAnalyticsConnected) metricNames.push(...YOUTUBE_ANALYTICS_METRICS);

    return {
      channelId: channel.id,
      platform: channel.platform,
      externalId: channel.external_id,
      url: channel.url,
      metrics: metricNames.map((metric) =>
        YOUTUBE_ANALYTICS_METRICS.includes(metric)
          ? buildFlowSeries(metric, byChannelMetric.get(`${channel.id}:${metric}`) ?? [], nowMs, days)
          : buildMetricSeries(metric, byChannelMetric.get(`${channel.id}:${metric}`) ?? [], nowMs, days),
      ),
      ...(channel.platform === "youtube" ? { analyticsNotice } : {}),
    };
  });

  const hasAnyData = result.some((channel) => channel.metrics.some((metric) => metric.current !== null || metric.points.some((point) => point.value !== null)));
  return { businessId, days, channels: result, hasAnyData };
}
