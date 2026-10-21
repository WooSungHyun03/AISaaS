/**
 * The pure part of the growth report that runs in the BROWSER as well as on the server: the server sends one bundle
 * (the 90 daily points of every metric, and the figures for each of the three periods); choosing a period or a day /
 * week / month view only slices and buckets what is already there, so the buttons never wait for the network.
 * Types are imported from the server modules as `import type` only: nothing server-only reaches the client bundle.
 */
import type { ChannelCollectionInfo, ChannelGrowthSeries, GrowthGranularity, GrowthMetricSeries, GrowthSeriesPoint } from "@/server/channels/growth-series";
import type { ChannelContentReport } from "@/server/channels/growth-content";
import type { ChannelPlatform } from "@/server/channels/platform";

export const GROWTH_PERIODS = [7, 30, 90] as const;
export type GrowthPeriod = (typeof GROWTH_PERIODS)[number];

const DAY_MS = 86_400_000;

export function isGrowthPeriod(value: number): value is GrowthPeriod {
  return (GROWTH_PERIODS as readonly number[]).includes(value);
}

/** Monday-based week start (KST calendar date) of a YYYY-MM-DD date. */
export function weekStart(date: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  const weekday = (new Date(ms).getUTCDay() + 6) % 7; // Monday = 0
  return new Date(ms - weekday * DAY_MS).toISOString().slice(0, 10);
}

export function bucketKey(date: string, granularity: GrowthGranularity): string {
  if (granularity === "week") return weekStart(date);
  if (granularity === "month") return `${date.slice(0, 7)}-01`;
  return date;
}

/** Folds the day-by-day points into week / month buckets: a running total keeps its last known value, a flow adds up. */
export function bucketPoints(points: GrowthSeriesPoint[], granularity: GrowthGranularity, kind: "TOTAL" | "FLOW"): GrowthSeriesPoint[] {
  if (granularity === "day") return points;
  const buckets = new Map<string, GrowthSeriesPoint[]>();
  for (const point of points) {
    const key = bucketKey(point.date, granularity);
    buckets.set(key, [...(buckets.get(key) ?? []), point]);
  }
  return [...buckets.entries()].map(([date, inside]) => {
    const known = inside.filter((point) => point.value !== null);
    const measured = inside.some((point) => point.measured);
    if (known.length === 0) return { date, value: null, measured };
    return { date, value: kind === "FLOW" ? known.reduce((sum, point) => sum + (point.value ?? 0), 0) : (known[known.length - 1].value as number), measured };
  });
}

/** What changes with the period: the headline value and its comparison with the period before. */
export interface MetricPeriodFigures {
  status: GrowthMetricSeries["status"];
  current: number | null;
  previous: number | null;
  absoluteDelta: number | null;
  deltaPercent: number | null;
}

export interface GrowthBundleMetric {
  metric: string;
  label: string;
  kind: "TOTAL" | "FLOW";
  hasDemoSeedData: boolean;
  hasSampleData: boolean;
  /** One point per KST day for the last 90 days, oldest first. Shorter periods are the tail of this list. */
  points: GrowthSeriesPoint[];
  byDays: Record<GrowthPeriod, MetricPeriodFigures>;
}

export interface GrowthBundleChannel {
  channelId: string;
  platform: ChannelPlatform;
  externalId: string;
  url: string;
  displayName: string | null;
  thumbnailUrl: string | null;
  collection: ChannelCollectionInfo;
  metrics: GrowthBundleMetric[];
  /** Per-video / per-post report for each period (null before anything was collected). */
  content: Record<GrowthPeriod, ChannelContentReport | null>;
  /** The reading under the charts for each period: the cached AI text when there is one from today, else the rule-based summary. */
  narratives: Record<GrowthPeriod, { text: string; aiUsed: boolean }>;
}

export interface GrowthBundle {
  businessId: string;
  /** Whether a real AI is connected. With the mock AI the background request would only return the rule-based text already on screen, so it is never sent. */
  aiNarratives: boolean;
  /** The instant the bundle was built; dates and "next collection" are relative to it, on the server and in the browser alike. */
  generatedAtMs: number;
  channels: GrowthBundleChannel[];
  hasAnyData: boolean;
}

/** The chart-ready series of one channel for the chosen period and view: what the old per-request server call returned. */
export function selectChannelSeries(channel: GrowthBundleChannel, days: GrowthPeriod, granularity: GrowthGranularity): ChannelGrowthSeries {
  return {
    channelId: channel.channelId,
    platform: channel.platform,
    externalId: channel.externalId,
    url: channel.url,
    displayName: channel.displayName,
    thumbnailUrl: channel.thumbnailUrl,
    collection: channel.collection,
    metrics: channel.metrics.map((metric) => ({
      metric: metric.metric,
      label: metric.label,
      kind: metric.kind,
      hasDemoSeedData: metric.hasDemoSeedData,
      hasSampleData: metric.hasSampleData,
      ...metric.byDays[days],
      points: bucketPoints(metric.points.slice(-days), granularity, metric.kind),
    })),
  };
}

/** A 7-day chart is daily; a longer one reads better by week unless the owner picks otherwise. */
export function defaultGranularity(days: GrowthPeriod): GrowthGranularity {
  return days >= 90 ? "week" : "day";
}

/** Whether the browser should ask the server for the AI reading of this channel and period (once per session, only when an AI is connected and today's reading is missing). */
export function shouldRequestNarrative(params: { aiNarratives: boolean; aiUsed: boolean; alreadyRequested: boolean }): boolean {
  return params.aiNarratives && !params.aiUsed && !params.alreadyRequested;
}
