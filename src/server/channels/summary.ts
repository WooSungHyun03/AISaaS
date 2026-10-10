import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ChannelPlatform } from "./platform";
import type { ChannelDiagnosisCompleteness } from "./completeness";
import type { ChannelSnapshotSource } from "./snapshot-source";
import type { ChannelDiagnosisSummary, ChannelDiagnosisSummaryItem, ChannelMetricTrend, GrowthSummary } from "./types";

export type ChannelsErrorCode = "DATABASE_ERROR";

export class ChannelsError extends Error {
  constructor(
    public readonly code: ChannelsErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ChannelsError";
  }
}

const DAY_MS = 86_400_000;

type ChannelDiagnosisRow = {
  channel_id: string;
  overall_score: number;
  activity_score: number;
  consistency_score: number;
  content_score: number;
  metrics: Record<string, number> | null;
  findings: string[];
  recommendations: string[];
  completeness: ChannelDiagnosisCompleteness;
  data_source: ChannelSnapshotSource;
  created_at: string;
};

type TrackedChannelRow = { id: string; platform: ChannelPlatform; external_id: string; url: string };

/**
 * Latest diagnosis per tracked channel, for the dashboard (person 2). See
 * docs/person1/CHANNEL_DASHBOARD_API.md for the full return shape and the
 * no-data case.
 */
export async function getLatestChannelDiagnosisSummary(businessId: string): Promise<ChannelDiagnosisSummary> {
  const supabase = await createClient();

  const { data: channelRows, error: channelsError } = await supabase
    .from("tracked_channels")
    .select("id, platform, external_id, url")
    .eq("business_id", businessId);
  if (channelsError) throw new ChannelsError("DATABASE_ERROR", "추적 중인 채널을 불러오지 못했습니다.", { cause: channelsError });

  const channels = (channelRows ?? []) as TrackedChannelRow[];
  if (channels.length === 0) return { businessId, channels: [], hasAnyData: false };

  const channelById = new Map(channels.map((channel) => [channel.id, channel]));

  // Newest first, then keep only the first (= latest) row per channel_id below.
  const { data: diagnosisRows, error: diagnosesError } = await supabase
    .from("channel_diagnoses")
    .select("channel_id, overall_score, activity_score, consistency_score, content_score, metrics, findings, recommendations, completeness, data_source, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (diagnosesError) throw new ChannelsError("DATABASE_ERROR", "채널 진단 결과를 불러오지 못했습니다.", { cause: diagnosesError });

  const latestByChannel = new Map<string, ChannelDiagnosisRow>();
  for (const row of (diagnosisRows ?? []) as ChannelDiagnosisRow[]) {
    if (!latestByChannel.has(row.channel_id)) latestByChannel.set(row.channel_id, row);
  }

  const items: ChannelDiagnosisSummaryItem[] = [];
  for (const [channelId, diagnosis] of latestByChannel) {
    const channel = channelById.get(channelId);
    if (!channel) continue; // diagnosis for a channel that's since been removed
    items.push({
      channelId,
      externalId: channel.external_id,
      url: channel.url,
      channel: channel.platform,
      overallScore: diagnosis.overall_score,
      activityScore: diagnosis.activity_score,
      consistencyScore: diagnosis.consistency_score,
      contentScore: diagnosis.content_score,
      metrics: diagnosis.metrics ?? {},
      findings: diagnosis.findings,
      recommendations: diagnosis.recommendations,
      dataSource: diagnosis.data_source,
      collectedAt: diagnosis.created_at,
      completeness: diagnosis.completeness,
    });
  }

  return { businessId, channels: items, hasAnyData: items.length > 0 };
}

/** Most recent snapshot at or before `beforeMs`, or null if none of `rows` qualifies. */
function latestBefore(rows: Array<{ value: number; recorded_at: string }>, beforeMs: number): number | null {
  let best: { value: number; time: number } | null = null;
  for (const row of rows) {
    const time = Date.parse(row.recorded_at);
    if (time > beforeMs) continue;
    if (!best || time > best.time) best = { value: row.value, time };
  }
  return best?.value ?? null;
}

function deltaPercent(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Current vs. previous `days`-window comparison per (channel, metric), for
 * the dashboard (person 2). See docs/person1/CHANNEL_DASHBOARD_API.md.
 */
export async function getGrowthSummary(businessId: string, options: { days?: number; now?: Date } = {}): Promise<GrowthSummary> {
  const days = options.days ?? 7;
  const nowMs = (options.now ?? new Date()).getTime();
  const supabase = await createClient();

  const { data: channelRows, error: channelsError } = await supabase
    .from("tracked_channels")
    .select("id, platform")
    .eq("business_id", businessId);
  if (channelsError) throw new ChannelsError("DATABASE_ERROR", "추적 중인 채널을 불러오지 못했습니다.", { cause: channelsError });

  const channels = (channelRows ?? []) as Array<{ id: string; platform: ChannelPlatform }>;
  if (channels.length === 0) return { businessId, days, trends: [], hasAnyData: false };

  const platformByChannel = new Map(channels.map((channel) => [channel.id, channel.platform]));
  const since = new Date(nowMs - days * 2 * DAY_MS).toISOString();

  const { data: snapshotRows, error: snapshotsError } = await supabase
    .from("marketing_metric_snapshots")
    .select("channel_id, metric, value, recorded_at")
    .in("channel_id", channels.map((channel) => channel.id))
    .gte("recorded_at", since);
  if (snapshotsError) throw new ChannelsError("DATABASE_ERROR", "채널 성장 지표를 불러오지 못했습니다.", { cause: snapshotsError });

  const snapshots = (snapshotRows ?? []) as Array<{ channel_id: string; metric: string; value: number; recorded_at: string }>;
  if (snapshots.length === 0) return { businessId, days, trends: [], hasAnyData: false };

  const byChannelMetric = new Map<string, Array<{ value: number; recorded_at: string }>>();
  for (const row of snapshots) {
    const key = `${row.channel_id}:${row.metric}`;
    const bucket = byChannelMetric.get(key) ?? [];
    bucket.push({ value: row.value, recorded_at: row.recorded_at });
    byChannelMetric.set(key, bucket);
  }

  const trends: ChannelMetricTrend[] = [];
  for (const [key, rows] of byChannelMetric) {
    const [channelId, metric] = key.split(":");
    const platform = platformByChannel.get(channelId);
    if (!platform) continue;
    const current = latestBefore(rows, nowMs);
    const previous = latestBefore(rows, nowMs - days * DAY_MS);
    trends.push({ channelId, platform, metric, current, previous, deltaPercent: deltaPercent(current, previous) });
  }

  return { businessId, days, trends, hasAnyData: trends.length > 0 };
}
