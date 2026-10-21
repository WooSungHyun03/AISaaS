import "server-only";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env/server";
import { GROWTH_PERIODS, type GrowthBundle, type GrowthBundleChannel, type GrowthBundleMetric, type GrowthPeriod } from "@/lib/growth/select";
import { isMockAiText } from "@/server/ai/mock-marker";
import { getChannelContentReportsByPeriod } from "./growth-content";
import { buildRuleBasedNarrative } from "./growth-narrative";
import { buildChannelSeries, kstDate, loadGrowthChannels, loadGrowthSnapshots, type ChannelRow, type SnapshotRow } from "./growth-series";
import { ChannelsError } from "./summary";

type CachedNarrative = { channel_id: string; days: number; narrative: string; ai_used: boolean; created_at: string };

/** The AI readings written today (KST) for these channels. One query for all channels and periods, newest first. */
async function readTodaysAiNarratives(channelIds: string[], nowMs: number): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (channelIds.length === 0) return result;
  const supabase = await createClient();
  const todayStart = new Date(Date.parse(`${kstDate(nowMs)}T00:00:00.000Z`) - 9 * 3_600_000).toISOString();
  const { data, error } = await supabase
    .from("channel_growth_narratives")
    .select("channel_id, days, narrative, ai_used, created_at")
    .in("channel_id", channelIds)
    .in("days", [...GROWTH_PERIODS])
    .gte("created_at", todayStart)
    .order("created_at", { ascending: false });
  if (error) throw new ChannelsError("DATABASE_ERROR", "기존 성장 해석을 확인하지 못했습니다.", { cause: error });
  for (const row of (data ?? []) as CachedNarrative[]) {
    const key = `${row.channel_id}:${row.days}`;
    // Newest first: the first row per (channel, period) is the one that counts. A placeholder from the mock AI is never shown.
    if (result.has(key) || !row.ai_used || isMockAiText(row.narrative)) continue;
    result.set(key, row.narrative);
  }
  return result;
}

/**
 * One channel's bundle, from the snapshots already read: the same numbers `buildChannelSeries` gives for any period and
 * view (selectChannelSeries reads them back), plus the per-period reports and readings. Pure.
 */
export function assembleBundleChannel(
  channel: ChannelRow,
  snapshots: SnapshotRow[],
  nowMs: number,
  content: GrowthBundleChannel["content"],
  aiNarratives: ReadonlyMap<string, string> = new Map(),
): GrowthBundleChannel {
  const byPeriod = Object.fromEntries(GROWTH_PERIODS.map((days) => [days, buildChannelSeries(channel, snapshots, nowMs, days, "day")])) as Record<GrowthPeriod, ReturnType<typeof buildChannelSeries>>;
  const widest = byPeriod[90];
  const metrics: GrowthBundleMetric[] = widest.metrics.map((metric, index) => ({
    metric: metric.metric,
    label: metric.label,
    kind: metric.kind,
    hasDemoSeedData: metric.hasDemoSeedData,
    hasSampleData: metric.hasSampleData,
    points: metric.points,
    byDays: Object.fromEntries(
      GROWTH_PERIODS.map((days) => {
        const { status, current, previous, absoluteDelta, deltaPercent } = byPeriod[days].metrics[index];
        return [days, { status, current, previous, absoluteDelta, deltaPercent }];
      }),
    ) as GrowthBundleMetric["byDays"],
  }));
  const narratives = Object.fromEntries(
    GROWTH_PERIODS.map((days) => {
      const ai = aiNarratives.get(`${channel.id}:${days}`);
      return [days, ai ? { text: ai, aiUsed: true } : { text: buildRuleBasedNarrative(byPeriod[days], days), aiUsed: false }];
    }),
  ) as GrowthBundleChannel["narratives"];
  return {
    channelId: channel.id,
    platform: channel.platform,
    externalId: channel.external_id,
    url: channel.url,
    displayName: channel.display_name,
    thumbnailUrl: channel.thumbnail_url,
    collection: widest.collection,
    metrics,
    content,
    narratives,
  };
}

/**
 * Everything the growth report needs for ALL periods (7 / 30 / 90 days) in one go: the daily points, the per-period
 * figures, the per-video reports and the readings. The page sends it to the browser once; choosing a period or a
 * day / week / month view afterwards is a slice of this data, not a request. The AI is never waited for here: a reading
 * that was not generated today is the rule-based summary of the real numbers, and the browser asks for the AI one
 * in the background (see growth-report/actions.ts).
 */
export async function getGrowthBundle(businessId: string, now: Date = new Date()): Promise<GrowthBundle> {
  const nowMs = now.getTime();
  const aiConnected = serverEnv.AI_PROVIDER !== "mock";
  const channels = await loadGrowthChannels(businessId);
  if (channels.length === 0) return { businessId, aiNarratives: aiConnected, generatedAtMs: nowMs, channels: [], hasAnyData: false };

  // Once the channels are known, the snapshots, the per-video rows and today's readings are three independent reads: one round.
  const channelIds = channels.map((channel) => channel.id);
  const [snapshots, contentByChannel, aiNarratives] = await Promise.all([
    loadGrowthSnapshots(channels, nowMs, 90),
    getChannelContentReportsByPeriod(channels.map((channel) => ({ channelId: channel.id, platform: channel.platform })), GROWTH_PERIODS, now),
    readTodaysAiNarratives(channelIds, nowMs),
  ]);

  const bundleChannels = channels.map((channel) =>
    assembleBundleChannel(channel, snapshots, nowMs, contentByChannel.get(channel.id) ?? { 7: null, 30: null, 90: null }, aiNarratives),
  );
  const hasAnyData = bundleChannels.some((channel) => channel.metrics.some((metric) => metric.points.some((point) => point.value !== null) || metric.byDays[30].current !== null));
  return { businessId, aiNarratives: aiConnected, generatedAtMs: nowMs, channels: bundleChannels, hasAnyData };
}
