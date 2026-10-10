import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ChannelsError, deltaPercent, latestBefore } from "./summary";
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

export const GROWTH_METRIC_LABEL: Record<string, string> = {
  subscriberCount: "구독자 수",
  viewCount: "조회수",
  matchedPostCount: "검색된 글 수",
  postsLast30Days: "최근 30일 게시 수",
  postCount: "게시글 수",
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
}

export interface ChannelGrowthSeries {
  channelId: string;
  platform: ChannelPlatform;
  externalId: string;
  url: string;
  metrics: GrowthMetricSeries[];
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

function buildMetricSeries(metric: string, rows: Array<{ value: number; recorded_at: string; source: string }>, nowMs: number, days: number): GrowthMetricSeries {
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
  };
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

  const since = new Date(nowMs - days * 2 * DAY_MS).toISOString();
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

  const result: ChannelGrowthSeries[] = channels.map((channel) => ({
    channelId: channel.id,
    platform: channel.platform,
    externalId: channel.external_id,
    url: channel.url,
    metrics: ALLOWED_GROWTH_METRICS[channel.platform].map((metric) =>
      buildMetricSeries(metric, byChannelMetric.get(`${channel.id}:${metric}`) ?? [], nowMs, days),
    ),
  }));

  const hasAnyData = result.some((channel) => channel.metrics.some((metric) => metric.current !== null || metric.points.some((point) => point.value !== null)));
  return { businessId, days, channels: result, hasAnyData };
}
