import "server-only";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env/server";
import { ChannelsError } from "./summary";
import { collectRawChannelMetrics, toSnapshotMetricsRecord } from "./raw-metrics";
import type { RawChannelMetrics, TrackedChannelForCollection } from "./raw-metrics";
import { scoreYouTubeChannel, uploadsWithinDays } from "./youtube-scoring";
import { scoreTistoryChannel, postsWithinDays } from "./tistory-scoring";
import { scoreNaverBlogChannel } from "./naver-blog-scoring";
import { saveMetricSnapshot } from "./snapshot";
import type { ChannelDiagnosis } from "./types";

/**
 * "동일 채널 1시간 캐시" without an in-memory cache (serverless instances
 * don't share memory, and may not even survive between two requests) —
 * reuses the most recent channel_diagnoses row instead. If it's younger
 * than this and came from the provider currently configured, it's
 * returned as-is with no provider call at all.
 */
const CACHE_FRESHNESS_MS = 60 * 60 * 1000;

type ChannelDiagnosisSelection = {
  overall_score: number;
  activity_score: number;
  consistency_score: number;
  content_score: number | null;
  metrics: Record<string, number> | null;
  findings: string[];
  recommendations: string[];
  completeness: ChannelDiagnosis["completeness"];
  data_source: ChannelDiagnosis["dataSource"];
  created_at: string;
};

const DIAGNOSIS_COLUMNS = "overall_score, activity_score, consistency_score, content_score, metrics, findings, recommendations, completeness, data_source, created_at";

function isFresh(createdAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(createdAt) < CACHE_FRESHNESS_MS;
}

/** What one diagnosis's score + persistence payload looks like, independent of platform. */
type ScoredChannel = {
  overallScore: number;
  activityScore: number;
  consistencyScore: number;
  contentScore: number | null;
  findings: string[];
  recommendations: string[];
  completeness: ChannelDiagnosis["completeness"];
  metricsRecord: Record<string, number>;
};

/**
 * "What the score was computed from", persisted into `channel_diagnoses.metrics`
 * for display/debugging — a richer, platform-specific shape than
 * raw-metrics.ts's toSnapshotMetricsRecord (that one is the plain
 * time-series value for the growth graph, not a diagnosis record).
 */
function toMetricsRecord(raw: RawChannelMetrics, now: Date): Record<string, number> {
  switch (raw.platform) {
    case "youtube": {
      const { metrics } = raw;
      const record: Record<string, number> = {
        viewCount: metrics.viewCount,
        videoCount: metrics.videoCount,
        uploadsLast30Days: uploadsWithinDays(metrics, now, 30),
      };
      if (metrics.subscriberCount !== null) record.subscriberCount = metrics.subscriberCount;
      if (metrics.recentVideos.length > 0) {
        record.averageRecentViews = Math.round(metrics.recentVideos.reduce((sum, video) => sum + video.viewCount, 0) / metrics.recentVideos.length);
      }
      return record;
    }
    case "tistory":
      return { postCount: raw.metrics.posts.length, postsLast30Days: postsWithinDays(raw.metrics.posts, now, 30) };
    case "naver_blog": {
      const { metrics } = raw;
      const record: Record<string, number> = { matchedPostCount: metrics.matchedPostCount, postsLast30Days: metrics.postsLast30Days };
      if (metrics.averageGapDays !== null) record.averageGapDays = metrics.averageGapDays;
      return record;
    }
  }
}

/** Dispatches to whichever platform's (pure) scoring function matches, and attaches this diagnosis's metrics-record. */
function scoreRawMetrics(raw: RawChannelMetrics, now: Date): ScoredChannel {
  const scored = raw.platform === "youtube" ? scoreYouTubeChannel(raw.metrics, now) : raw.platform === "tistory" ? scoreTistoryChannel(raw.metrics, now) : scoreNaverBlogChannel(raw.metrics);
  return { ...scored, metricsRecord: toMetricsRecord(raw, now) };
}

function mapRowToChannelDiagnosis(row: ChannelDiagnosisSelection, platform: TrackedChannelForCollection["platform"]): ChannelDiagnosis {
  return {
    channel: platform,
    overallScore: row.overall_score,
    activityScore: row.activity_score,
    consistencyScore: row.consistency_score,
    contentScore: row.content_score,
    metrics: row.metrics ?? {},
    findings: row.findings,
    recommendations: row.recommendations,
    dataSource: row.data_source,
    collectedAt: row.created_at,
    completeness: row.completeness,
  };
}

/**
 * Diagnoses one tracked channel (any of the three platforms — ticket 1-5
 * generalizes ticket 1-1's YouTube-only version): reuses a fresh-enough
 * cached diagnosis, or collects live/mock metrics, scores them, and
 * persists a new channel_diagnoses row. `now` is injectable so "같은
 * 입력이면 같은 점수" is testable with a fixed clock.
 */
export async function diagnoseChannel(
  trackedChannel: TrackedChannelForCollection & { business_id: string },
  businessName: string | undefined,
  options: { now?: Date } = {},
): Promise<ChannelDiagnosis> {
  const now = options.now ?? new Date();
  const supabase = await createClient();

  const { data: latest, error: latestError } = await supabase
    .from("channel_diagnoses")
    .select(DIAGNOSIS_COLUMNS)
    .eq("channel_id", trackedChannel.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw new ChannelsError("DATABASE_ERROR", "기존 채널 진단을 확인하지 못했습니다.", { cause: latestError });

  const cached = latest as ChannelDiagnosisSelection | null;
  if (cached && isFresh(cached.created_at, now) && cached.data_source === serverEnv.CHANNEL_DATA_PROVIDER) {
    return mapRowToChannelDiagnosis(cached, trackedChannel.platform);
  }

  const raw = await collectRawChannelMetrics(trackedChannel, businessName, now);
  const scored = scoreRawMetrics(raw, now);

  const { data: inserted, error: insertError } = await supabase
    .from("channel_diagnoses")
    .insert({
      business_id: trackedChannel.business_id,
      channel_id: trackedChannel.id,
      overall_score: scored.overallScore,
      activity_score: scored.activityScore,
      consistency_score: scored.consistencyScore,
      content_score: scored.contentScore,
      metrics: scored.metricsRecord,
      findings: scored.findings,
      recommendations: scored.recommendations,
      completeness: scored.completeness,
      data_source: serverEnv.CHANNEL_DATA_PROVIDER,
    })
    .select(DIAGNOSIS_COLUMNS)
    .single();
  if (insertError) throw new ChannelsError("DATABASE_ERROR", "채널 진단 결과를 저장하지 못했습니다.", { cause: insertError });

  // Ticket 1-6's "(a) 진단 시 자동 저장" — reuses the metrics already
  // fetched above instead of calling the provider again.
  await saveSnapshotsFromRawMetrics(trackedChannel.id, raw, now);

  return mapRowToChannelDiagnosis(inserted as ChannelDiagnosisSelection, trackedChannel.platform);
}

async function saveSnapshotsFromRawMetrics(channelId: string, raw: RawChannelMetrics, now: Date): Promise<void> {
  const source = serverEnv.CHANNEL_DATA_PROVIDER;
  for (const [metric, value] of Object.entries(toSnapshotMetricsRecord(raw))) {
    await saveMetricSnapshot({ channelId, metric, value, source, recordedAt: now });
  }
}
