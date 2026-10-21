import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ChannelsError, deltaPercent, latestBefore } from "./summary";
import { nextDailyCollectionAt } from "./schedule";
import type { ChannelPlatform } from "./platform";
import { bucketPoints } from "@/lib/growth/select";

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
  youtube: ["subscriberCount", "viewCount", "viewCountDaily", "videoCount"],
  naver_blog: ["matchedPostCount", "postsLast7Days", "postsLast30Days"],
  tistory: ["postCount", "postsLast7Days", "postsLast30Days"],
};

/**
 * Metrics that are computed from the stored snapshots at read time instead of being stored themselves:
 * `viewCountDaily` is the day-over-day increase of the channel's public running view total. It is NOT YouTube
 * Analytics' daily views (those are owner-only and are not collected), and it only exists for days that have a
 * snapshot on both ends.
 */
const DERIVED_FLOW_METRICS: Record<string, { source: string }> = {
  viewCountDaily: { source: "viewCount" },
};

export const GROWTH_METRIC_LABEL: Record<string, string> = {
  subscriberCount: "구독자 수",
  viewCount: "채널 누적 조회수",
  viewCountDaily: "일별 조회수 증가량 (누적 조회수의 차이)",
  videoCount: "공개 영상 수",
  matchedPostCount: "확인된 공개 글 수 (피드 기준)",
  postsLast7Days: "최근 7일 게시 수",
  postsLast30Days: "최근 30일 게시 수",
  postCount: "확인된 공개 글 수 (피드 기준)",
};

/** Below this many snapshots in the current period, there isn't enough history to call it a trend yet. */
const MIN_SNAPSHOTS_FOR_TREND = 2;

export interface GrowthSeriesPoint {
  /** KST calendar date (YYYY-MM-DD). */
  date: string;
  /** The most recent known value as of this date (latestBefore) — null if nothing was collected yet by then. */
  value: number | null;
  /** True when a snapshot was really taken on this day; false means the value is carried over from an earlier day. */
  measured?: boolean;
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
  /** True if a snapshot came from the mock provider (CHANNEL_DATA_PROVIDER=mock): sample numbers, never real performance. */
  hasSampleData: boolean;
  /** "SUM" metrics (flows, e.g. a day's increase) add up inside a week/month bucket; running totals keep the last value. */
  kind: "TOTAL" | "FLOW";
}

export type CollectionState = "SUCCESS" | "FAILED" | "QUOTA_EXCEEDED" | "UNAVAILABLE" | "PENDING";

/** Where the daily collection of one channel stands, for the "마지막 갱신" line and the failure / baseline messages. */
export interface ChannelCollectionInfo {
  state: CollectionState;
  /** ISO time of the last attempt (success or not). Null before the first collection. */
  lastCollectedAt: string | null;
  /** The next scheduled 06:00 KST collection, or null when the channel is paused. */
  nextCollectionAt: string | null;
  /** How many different KST days have a real snapshot: 1 means "baseline only", the trend starts with the second. */
  measuredDays: number;
  /** Paused (the channel was confirmed gone for days): it is probed once a week and resumes by itself when it answers again. */
  paused: boolean;
  /** The last time a collection really measured something (a failed attempt does not move it), or null. */
  lastSuccessAt: string | null;
  /** Why the last attempt measured nothing or failed (CHANNEL_NOT_FOUND, ROBOTS_DISALLOWED, FEED_TRANSIENT, …), for the owner's message. */
  errorCode: string | null;
}

export type GrowthGranularity = "day" | "week" | "month";

export interface ChannelGrowthSeries {
  channelId: string;
  platform: ChannelPlatform;
  externalId: string;
  url: string;
  displayName: string | null;
  thumbnailUrl: string | null;
  collection: ChannelCollectionInfo;
  metrics: GrowthMetricSeries[];
}

export interface GrowthSeriesResult {
  businessId: string;
  days: number;
  granularity: GrowthGranularity;
  channels: ChannelGrowthSeries[];
  hasAnyData: boolean;
}

export type SnapshotRow = { channel_id: string; metric: string; value: number; recorded_at: string; source: string };

/** PostgREST returns at most 1,000 rows per request; a longer window than that (90 days x several metrics) must be read page by page or the oldest points silently vanish. */
const SNAPSHOT_PAGE_SIZE = 1_000;
/** Safety stop: 50 pages is 50,000 snapshots, far more than any business collects in the longest window. */
const MAX_SNAPSHOT_PAGES = 50;

type SnapshotClient = Awaited<ReturnType<typeof createClient>>;

/** `numeric` columns can come back as strings; a value that is not a finite number is dropped, never charted as 0. */
function toSnapshotRow(raw: { channel_id: string; metric: string; value: unknown; recorded_at: string; source: string }): SnapshotRow | null {
  const value = typeof raw.value === "number" ? raw.value : typeof raw.value === "string" && raw.value.trim() !== "" ? Number(raw.value) : NaN;
  return Number.isFinite(value) ? { channel_id: raw.channel_id, metric: raw.metric, value, recorded_at: raw.recorded_at, source: raw.source } : null;
}

/**
 * Every snapshot of one channel from `since` on (oldest first), plus the single latest one BEFORE `since` for each
 * metric: the comparison "value before the period" must still exist when the channel was last collected a while ago.
 */
async function fetchChannelSnapshots(supabase: SnapshotClient, channelId: string, since: string): Promise<SnapshotRow[]> {
  const rows: SnapshotRow[] = [];
  const older = supabase
    .from("marketing_metric_snapshots")
    .select("channel_id, metric, value, recorded_at, source")
    .eq("channel_id", channelId)
    .lt("recorded_at", since)
    .order("recorded_at", { ascending: false })
    .limit(SNAPSHOT_PAGE_SIZE);
  // The page loop and the "before the window" read are independent: they run side by side.
  const olderPromise = Promise.resolve(older);
  for (let page = 0; page < MAX_SNAPSHOT_PAGES; page++) {
    const { data, error } = await supabase
      .from("marketing_metric_snapshots")
      .select("channel_id, metric, value, recorded_at, source")
      .eq("channel_id", channelId)
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: true })
      .range(page * SNAPSHOT_PAGE_SIZE, (page + 1) * SNAPSHOT_PAGE_SIZE - 1);
    if (error) throw new ChannelsError("DATABASE_ERROR", "채널 성장 지표를 불러오지 못했습니다.", { cause: error });
    const batch = (data ?? []) as Array<Parameters<typeof toSnapshotRow>[0]>;
    for (const raw of batch) {
      const row = toSnapshotRow(raw);
      if (row) rows.push(row);
    }
    if (batch.length < SNAPSHOT_PAGE_SIZE) break;
  }

  const { data: before, error: olderError } = await olderPromise;
  if (olderError) throw new ChannelsError("DATABASE_ERROR", "채널 성장 지표를 불러오지 못했습니다.", { cause: olderError });
  const have = new Set(rows.map((row) => `${row.channel_id}:${row.metric}:${row.recorded_at}`));
  const seen = new Set<string>();
  for (const raw of (before ?? []) as Array<Parameters<typeof toSnapshotRow>[0]>) {
    const key = `${raw.channel_id}:${raw.metric}`;
    if (seen.has(key) || have.has(`${key}:${raw.recorded_at}`)) continue;
    seen.add(key);
    const row = toSnapshotRow(raw);
    if (row) rows.push(row);
  }
  return rows;
}

/** Snapshots of all the channels, one request per channel and all of them at once instead of one long page-by-page read. */
async function fetchSnapshots(supabase: SnapshotClient, channelIds: string[], since: string): Promise<SnapshotRow[]> {
  const perChannel = await Promise.all(channelIds.map((channelId) => fetchChannelSnapshots(supabase, channelId, since)));
  return perChannel.flat();
}

/** KST (UTC+9) calendar date for an instant. Exported for reuse by growth-narrative.ts's "already generated today" cache check. */
export function kstDate(timeMs: number): string {
  return new Date(timeMs + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** The last millisecond of a KST calendar day (YYYY-MM-DD), as a UTC instant. */
export function endOfKstDayMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) + DAY_MS - 1 - 9 * 3_600_000;
}

type SeriesRow = { value: number; recorded_at: string; source: string };

function flags(rows: SeriesRow[]) {
  return { hasDemoSeedData: rows.some((row) => row.source === "DEMO_SEED"), hasSampleData: rows.some((row) => row.source === "mock") };
}

function buildMetricSeries(metric: string, rows: SeriesRow[], nowMs: number, days: number, granularity: GrowthGranularity): GrowthMetricSeries {
  const currentPeriodStart = nowMs - days * DAY_MS;
  const rowsInCurrentPeriod = rows.filter((row) => Date.parse(row.recorded_at) >= currentPeriodStart);

  const current = latestBefore(rows, nowMs);
  const previous = latestBefore(rows, currentPeriodStart);
  const absoluteDelta = current !== null && previous !== null ? current - previous : null;

  // One point per KST calendar day: the value as it stood at the END of that day (today: as of now), so a day
  // with a snapshot shows that snapshot and a quiet day keeps the last known value.
  const measuredDays = new Set(rows.map((row) => kstDate(Date.parse(row.recorded_at))));
  const points: GrowthSeriesPoint[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = kstDate(nowMs - offset * DAY_MS);
    points.push({ date, value: latestBefore(rows, Math.min(nowMs, endOfKstDayMs(date))), measured: measuredDays.has(date) });
  }

  return {
    metric,
    label: GROWTH_METRIC_LABEL[metric] ?? metric,
    status: rowsInCurrentPeriod.length < MIN_SNAPSHOTS_FOR_TREND ? "COLLECTING" : "OK",
    current,
    previous,
    absoluteDelta,
    deltaPercent: deltaPercent(current, previous),
    points: bucketPoints(points, granularity, "TOTAL"),
    ...flags(rows),
    kind: "TOTAL",
  };
}

/**
 * Day-over-day increase of a running total (viewCount → viewCountDaily). A day only gets a value when it has its own
 * snapshot AND the previous measured day is at most 3 days earlier, so a gap in collection is never smeared into one
 * misleadingly large "day". The period figure is the sum of those increases; there is no comparison with the previous
 * period unless that period has increases of its own.
 */
function buildDailyIncreaseSeries(metric: string, source: SeriesRow[], nowMs: number, days: number, granularity: GrowthGranularity): GrowthMetricSeries {
  const sorted = [...source].sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
  const increases = new Map<string, number>();
  for (let i = 1; i < sorted.length; i++) {
    const day = kstDate(Date.parse(sorted[i].recorded_at));
    const previousDay = kstDate(Date.parse(sorted[i - 1].recorded_at));
    const gapDays = (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${previousDay}T00:00:00Z`)) / DAY_MS;
    if (gapDays < 1 || gapDays > 3) continue;
    const increase = sorted[i].value - sorted[i - 1].value;
    // A running total can drop (a removed video); that is a correction, not a negative number of views.
    if (increase >= 0) increases.set(day, increase);
  }
  const periodStartMs = nowMs - days * DAY_MS;
  const periodDays = new Set<string>();
  for (let offset = days - 1; offset >= 0; offset--) periodDays.add(kstDate(nowMs - offset * DAY_MS));
  const previousStartMs = periodStartMs - days * DAY_MS;
  let current = 0;
  let currentCount = 0;
  let previous = 0;
  let previousCount = 0;
  for (const [day, value] of increases) {
    const dayMs = Date.parse(`${day}T00:00:00Z`) - 9 * 3_600_000;
    if (periodDays.has(day)) {
      current += value;
      currentCount++;
    } else if (dayMs >= previousStartMs && dayMs < periodStartMs) {
      previous += value;
      previousCount++;
    }
  }
  const points: GrowthSeriesPoint[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = kstDate(nowMs - offset * DAY_MS);
    points.push({ date, value: increases.get(date) ?? null, measured: increases.has(date) });
  }
  const hasCurrent = currentCount > 0;
  const hasPrevious = previousCount > 0;
  return {
    metric,
    label: GROWTH_METRIC_LABEL[metric] ?? metric,
    status: currentCount < MIN_SNAPSHOTS_FOR_TREND ? "COLLECTING" : "OK",
    current: hasCurrent ? current : null,
    previous: hasPrevious ? previous : null,
    absoluteDelta: hasCurrent && hasPrevious ? current - previous : null,
    deltaPercent: hasCurrent && hasPrevious ? deltaPercent(current, previous) : null,
    points: bucketPoints(points, granularity, "FLOW"),
    ...flags(source),
    kind: "FLOW",
  };
}

export type ChannelRow = {
  id: string;
  platform: ChannelPlatform;
  external_id: string;
  url: string;
  status: string;
  display_name: string | null;
  thumbnail_url: string | null;
  next_snapshot_at: string | null;
  last_collected_at: string | null;
  last_success_at: string | null;
  last_collection_status: string | null;
  last_error_code: string | null;
};

const CHANNEL_COLUMNS = "id, platform, external_id, url, status, display_name, thumbnail_url, next_snapshot_at, last_collected_at, last_success_at, last_collection_status, last_error_code";

function collectionInfo(channel: ChannelRow, measuredDays: number, nowMs: number): ChannelCollectionInfo {
  const raw = channel.last_collection_status;
  const state: CollectionState = raw === "SUCCESS" || raw === "FAILED" || raw === "QUOTA_EXCEEDED" || raw === "UNAVAILABLE" ? raw : measuredDays > 0 ? "SUCCESS" : "PENDING";
  const paused = channel.status === "PAUSED" || channel.status === "ERROR";
  const scheduled = channel.next_snapshot_at ? Date.parse(channel.next_snapshot_at) : NaN;
  // A retry slot (30 min) is internal: what the owner is told is always the next regular 06:00 KST.
  const nextCollectionAt = paused ? null : (Number.isFinite(scheduled) && scheduled > nowMs + 2 * 3_600_000 ? new Date(scheduled) : nextDailyCollectionAt(new Date(nowMs))).toISOString();
  return { state, lastCollectedAt: channel.last_collected_at, nextCollectionAt, measuredDays, paused, lastSuccessAt: channel.last_success_at ?? (state === "SUCCESS" ? channel.last_collected_at : null), errorCode: channel.last_error_code };
}

/**
 * Per-channel, per-metric time series for the growth report: current value, vs.-previous-period comparison, and a
 * chart-ready series for the selected period (day / week / month buckets). Reuses getGrowthSummary's exact "gap day"
 * rule (latestBefore) and null-handling (deltaPercent) rather than reimplementing them — see summary.ts.
 *
 * Every platform's metric list comes from ALLOWED_GROWTH_METRICS, not "whichever metrics this channel happens to have
 * snapshots for": a YouTube channel with a hidden subscriber count still gets a `subscriberCount` entry (current and
 * previous both null, no points), so the screen can say "측정 불가" instead of silently omitting it — and a blog can
 * never surface a view/visitor metric, no matter what ends up in the snapshots table. Old `yt_analytics.*` snapshots
 * (from the removed OAuth integration) stay in the database but are never read here.
 */
/** The channels of a business in the order they are shown: YouTube, Naver, Tistory. */
export async function loadGrowthChannels(businessId: string): Promise<ChannelRow[]> {
  const supabase = await createClient();
  const { data: channelRows, error: channelsError } = await supabase
    .from("tracked_channels")
    .select(CHANNEL_COLUMNS)
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });
  if (channelsError) throw new ChannelsError("DATABASE_ERROR", "추적 중인 채널을 불러오지 못했습니다.", { cause: channelsError });

  // A stable on-screen order (rows registered together share one created_at).
  const platformRank = (platform: string) => ["youtube", "naver_blog", "tistory"].indexOf(platform);
  return ((channelRows ?? []) as ChannelRow[]).map((channel, index) => ({ channel, index })).sort((a, b) => platformRank(a.channel.platform) - platformRank(b.channel.platform) || a.index - b.index).map(({ channel }) => channel);
}

/** Every snapshot of these channels since `windowDays` (twice, for the comparison period) before `nowMs`. */
export async function loadGrowthSnapshots(channels: ChannelRow[], nowMs: number, windowDays: number): Promise<SnapshotRow[]> {
  if (channels.length === 0) return [];
  const supabase = await createClient();
  const since = new Date(nowMs - (windowDays * 2 + 1) * DAY_MS).toISOString();
  return fetchSnapshots(supabase, channels.map((channel) => channel.id), since);
}

/** The channels of a business with every snapshot in the window (two steps in a row: the snapshots need the channel ids). */
export async function loadGrowthInputs(businessId: string, nowMs: number, windowDays: number): Promise<{ channels: ChannelRow[]; snapshots: SnapshotRow[] }> {
  const channels = await loadGrowthChannels(businessId);
  return { channels, snapshots: await loadGrowthSnapshots(channels, nowMs, windowDays) };
}

/** One channel's series for one period and view, from the snapshots already read. Pure. */
export function buildChannelSeries(channel: ChannelRow, snapshots: SnapshotRow[], nowMs: number, days: number, granularity: GrowthGranularity): ChannelGrowthSeries {
  const own = snapshots.filter((row) => row.channel_id === channel.id);
  const rowsOf = (metric: string) => own.filter((row) => row.metric === metric);
  const measuredDays = new Set(own.map((row) => kstDate(Date.parse(row.recorded_at)))).size;
  return {
    channelId: channel.id,
    platform: channel.platform,
    externalId: channel.external_id,
    url: channel.url,
    displayName: channel.display_name,
    thumbnailUrl: channel.thumbnail_url,
    collection: collectionInfo(channel, measuredDays, nowMs),
    metrics: ALLOWED_GROWTH_METRICS[channel.platform].map((metric) => {
      const derived = DERIVED_FLOW_METRICS[metric];
      return derived ? buildDailyIncreaseSeries(metric, rowsOf(derived.source), nowMs, days, granularity) : buildMetricSeries(metric, rowsOf(metric), nowMs, days, granularity);
    }),
  };
}

export async function getChannelGrowthSeries(businessId: string, options: { days?: number; now?: Date; granularity?: GrowthGranularity } = {}): Promise<GrowthSeriesResult> {
  const days = options.days ?? 30;
  const granularity = options.granularity ?? "day";
  const nowMs = (options.now ?? new Date()).getTime();

  const { channels, snapshots } = await loadGrowthInputs(businessId, nowMs, days);
  if (channels.length === 0) return { businessId, days, granularity, channels: [], hasAnyData: false };

  const result = channels.map((channel) => buildChannelSeries(channel, snapshots, nowMs, days, granularity));
  const hasAnyData = result.some((channel) => channel.metrics.some((metric) => metric.current !== null || metric.points.some((point) => point.value !== null)));
  return { businessId, days, granularity, channels: result, hasAnyData };
}
