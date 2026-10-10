import type { ChannelDiagnosisCompleteness } from "./completeness";
import type { YouTubeRawMetrics } from "./providers/youtube-types";

/**
 * Same ScoreItem shape (key/group/label/points/detail — a reason sentence
 * per item) as src/server/marketing/scoring.ts, adapted to this domain's
 * own groups. Pure function: given the same metrics and the same `now`,
 * always returns the same score (ticket 1-2's "같은 입력이면 같은 점수").
 */
export interface YouTubeScoreItem {
  key: string;
  group: "activity" | "consistency" | "content";
  label: string;
  points: number;
  detail: string;
}

export interface YouTubeScoreResult {
  overallScore: number;
  activityScore: number;
  consistencyScore: number;
  contentScore: number;
  items: YouTubeScoreItem[];
  findings: string[];
  recommendations: string[];
  completeness: ChannelDiagnosisCompleteness;
}

const DAY_MS = 86_400_000;

/** Exported for reuse by diagnose.ts when it persists `metrics.uploadsLast30Days` alongside the score, so both stay in sync if this window logic ever changes. */
export function uploadsWithinDays(metrics: YouTubeRawMetrics, now: Date, days: number): number {
  const cutoff = now.getTime() - days * DAY_MS;
  return metrics.recentVideos.filter((video) => Date.parse(video.publishedAt) >= cutoff).length;
}

function scoreActivity(metrics: YouTubeRawMetrics, now: Date): YouTubeScoreItem {
  const uploadsLast30Days = uploadsWithinDays(metrics, now, 30);
  const points = uploadsLast30Days === 0 ? 0 : uploadsLast30Days <= 3 ? 40 : uploadsLast30Days <= 7 ? 70 : 100;
  const detail =
    uploadsLast30Days === 0
      ? "최근 30일간 업로드가 없어요."
      : `최근 30일간 영상 ${uploadsLast30Days}개를 업로드했어요.`;
  return { key: "uploads_last_30_days", group: "activity", label: "최근 업로드 빈도", points, detail };
}

function gapDays(sortedDesc: YouTubeRawMetrics["recentVideos"]): number[] {
  const gaps: number[] = [];
  for (let i = 0; i < sortedDesc.length - 1; i++) {
    const gap = (Date.parse(sortedDesc[i].publishedAt) - Date.parse(sortedDesc[i + 1].publishedAt)) / DAY_MS;
    if (gap >= 0) gaps.push(gap);
  }
  return gaps;
}

function scoreConsistency(metrics: YouTubeRawMetrics): YouTubeScoreItem {
  const sorted = [...metrics.recentVideos].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const gaps = gapDays(sorted);

  if (gaps.length < 2) {
    return {
      key: "upload_interval_variance",
      group: "consistency",
      label: "업로드 간격 꾸준함",
      points: 20,
      detail: "업로드 기록이 적어 꾸준함을 판단하기엔 데이터가 부족해요.",
    };
  }

  const mean = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
  const variance = gaps.reduce((sum, g) => sum + (g - mean) ** 2, 0) / gaps.length;
  const coefficientOfVariation = mean > 0 ? Math.sqrt(variance) / mean : 1;
  const points = coefficientOfVariation < 0.3 ? 100 : coefficientOfVariation < 0.6 ? 70 : coefficientOfVariation < 1.0 ? 40 : 20;
  const detail = `최근 업로드 간격이 평균 ${mean.toFixed(1)}일이고, 변동 정도는 ${points >= 70 ? "일정해요" : points >= 40 ? "다소 불규칙해요" : "불규칙해요"}.`;
  return { key: "upload_interval_variance", group: "consistency", label: "업로드 간격 꾸준함", points, detail };
}

function scoreContent(metrics: YouTubeRawMetrics): { item: YouTubeScoreItem; finding: string | null } {
  const averageRecentViews =
    metrics.recentVideos.length === 0 ? 0 : metrics.recentVideos.reduce((sum, v) => sum + v.viewCount, 0) / metrics.recentVideos.length;

  if (metrics.hiddenSubscriberCount) {
    // Ratio item excluded — no subscriberCount to divide by. Falls back to
    // an absolute-views tier, which is a weaker signal (see completeness).
    const points = averageRecentViews >= 10_000 ? 80 : averageRecentViews >= 1_000 ? 50 : averageRecentViews > 0 ? 25 : 0;
    return {
      item: {
        key: "average_views_absolute",
        group: "content",
        label: "평균 조회수",
        points,
        detail: `구독자 수가 비공개라 조회 대비 구독자 비율 항목을 제외하고, 평균 조회수(${Math.round(averageRecentViews).toLocaleString("ko-KR")}회)만 반영했어요.`,
      },
      finding: "구독자 수가 비공개라 조회 대비 구독자 비율 항목을 제외했습니다.",
    };
  }

  if (!metrics.subscriberCount) {
    return {
      item: { key: "average_views_ratio", group: "content", label: "조회 대비 구독자 비율", points: 0, detail: "구독자 수를 확인할 수 없어 콘텐츠 점수를 매기지 못했어요." },
      finding: null,
    };
  }

  const ratio = averageRecentViews / metrics.subscriberCount;
  const points = ratio >= 0.5 ? 100 : ratio >= 0.2 ? 70 : ratio >= 0.05 ? 40 : 20;
  return {
    item: {
      key: "average_views_ratio",
      group: "content",
      label: "조회 대비 구독자 비율",
      points,
      detail: `최근 영상이 구독자 수 대비 평균 ${(ratio * 100).toFixed(0)}% 만큼 조회됐어요.`,
    },
    finding: null,
  };
}

function buildRecommendations(items: YouTubeScoreItem[]): string[] {
  const recommendations: string[] = [];
  const activity = items.find((item) => item.group === "activity");
  const consistency = items.find((item) => item.group === "consistency");
  if (activity && activity.points < 70) recommendations.push("꾸준한 노출을 위해 월 4회 이상 업로드를 목표로 해보세요.");
  if (consistency && consistency.points < 70) recommendations.push("업로드 요일/시간을 일정하게 유지하면 꾸준함 점수가 올라가요.");
  return recommendations;
}

/** Pure: same `metrics` + same `now` always produces the same result. */
export function scoreYouTubeChannel(metrics: YouTubeRawMetrics, now: Date): YouTubeScoreResult {
  if (metrics.videoCount === 0) {
    return {
      overallScore: 0,
      activityScore: 0,
      consistencyScore: 0,
      contentScore: 0,
      items: [],
      findings: ["이 채널에는 아직 영상이 없어요."],
      recommendations: ["첫 영상을 업로드하면 진단을 시작할 수 있어요."],
      completeness: "INSUFFICIENT_DATA",
    };
  }

  const activityItem = scoreActivity(metrics, now);
  const consistencyItem = scoreConsistency(metrics);
  const { item: contentItem, finding: contentFinding } = scoreContent(metrics);
  const items = [activityItem, consistencyItem, contentItem];

  const overallScore = Math.round((activityItem.points + consistencyItem.points + contentItem.points) / 3);

  const findings: string[] = [];
  if (uploadsWithinDays(metrics, now, 30) === 0) findings.push("최근 30일간 업로드가 없어요.");
  if (contentFinding) findings.push(contentFinding);

  const completeness: ChannelDiagnosisCompleteness =
    metrics.hiddenSubscriberCount || metrics.recentVideos.length < 2 ? "PARTIAL" : "COMPLETE";

  return {
    overallScore,
    activityScore: activityItem.points,
    consistencyScore: consistencyItem.points,
    contentScore: contentItem.points,
    items,
    findings,
    recommendations: buildRecommendations(items),
    completeness,
  };
}
