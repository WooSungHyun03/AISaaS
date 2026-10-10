import type { ChannelDiagnosisCompleteness } from "./completeness";
import type { TistoryRssMetrics } from "./providers/tistory";

/** Same ScoreItem shape (key/group/label/points/detail) as youtube-scoring.ts. */
export interface TistoryScoreItem {
  key: string;
  group: "activity" | "consistency";
  label: string;
  points: number;
  detail: string;
}

export interface TistoryScoreResult {
  /** Average of activityScore/consistencyScore — Tistory RSS has no view/subscriber data, so there is no contentScore here (unlike YouTube's). */
  overallScore: number;
  activityScore: number;
  consistencyScore: number;
  items: TistoryScoreItem[];
  findings: string[];
  recommendations: string[];
  completeness: ChannelDiagnosisCompleteness;
}

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;

/** Epoch ms of the start (00:00) of the KST calendar day containing `timeMs`. */
function kstDayStartMs(timeMs: number): number {
  const kstTime = timeMs + KST_OFFSET_MS;
  return Math.floor(kstTime / DAY_MS) * DAY_MS - KST_OFFSET_MS;
}

/** Posts within the last `days` KST calendar days (today counts as day 0). */
function postsWithinDays(posts: TistoryRssMetrics["posts"], now: Date, days: number): number {
  const todayStart = kstDayStartMs(now.getTime());
  return posts.filter((post) => {
    const postDayStart = kstDayStartMs(Date.parse(post.publishedAt));
    const ageDays = (todayStart - postDayStart) / DAY_MS;
    return ageDays >= 0 && ageDays < days;
  }).length;
}

function scoreActivity(posts: TistoryRssMetrics["posts"], now: Date): TistoryScoreItem {
  const postsLast30Days = postsWithinDays(posts, now, 30);
  const points = postsLast30Days === 0 ? 0 : postsLast30Days <= 3 ? 40 : postsLast30Days <= 7 ? 70 : 100;
  const detail = postsLast30Days === 0 ? "최근 30일간 게시글이 없어요." : `최근 30일간 글 ${postsLast30Days}개를 게시했어요.`;
  return { key: "posts_last_30_days", group: "activity", label: "최근 게시 빈도", points, detail };
}

function scoreConsistency(posts: TistoryRssMetrics["posts"]): TistoryScoreItem {
  const sorted = [...posts].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const gaps: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = (Date.parse(sorted[i].publishedAt) - Date.parse(sorted[i + 1].publishedAt)) / DAY_MS;
    if (gap >= 0) gaps.push(gap);
  }

  if (gaps.length < 2) {
    return {
      key: "post_interval_variance",
      group: "consistency",
      label: "게시 간격 꾸준함",
      points: 20,
      detail: "게시 기록이 적어 꾸준함을 판단하기엔 데이터가 부족해요.",
    };
  }

  const mean = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
  const variance = gaps.reduce((sum, g) => sum + (g - mean) ** 2, 0) / gaps.length;
  const coefficientOfVariation = mean > 0 ? Math.sqrt(variance) / mean : 1;
  const points = coefficientOfVariation < 0.3 ? 100 : coefficientOfVariation < 0.6 ? 70 : coefficientOfVariation < 1.0 ? 40 : 20;
  const detail = `최근 게시 간격이 평균 ${mean.toFixed(1)}일이고, ${points >= 70 ? "일정해요" : points >= 40 ? "다소 불규칙해요" : "불규칙해요"}.`;
  return { key: "post_interval_variance", group: "consistency", label: "게시 간격 꾸준함", points, detail };
}

/** Pure: same `metrics` + same `now` always produces the same result. */
export function scoreTistoryChannel(metrics: TistoryRssMetrics, now: Date): TistoryScoreResult {
  if (metrics.unavailableReason) {
    return {
      overallScore: 0,
      activityScore: 0,
      consistencyScore: 0,
      items: [],
      findings: [metrics.unavailableReason],
      recommendations: [],
      completeness: "INSUFFICIENT_DATA",
    };
  }

  if (metrics.posts.length === 0) {
    return {
      overallScore: 0,
      activityScore: 0,
      consistencyScore: 0,
      items: [],
      findings: ["이 블로그에는 아직 게시글이 없어요."],
      recommendations: ["첫 글을 게시하면 진단을 시작할 수 있어요."],
      completeness: "INSUFFICIENT_DATA",
    };
  }

  const activityItem = scoreActivity(metrics.posts, now);
  const consistencyItem = scoreConsistency(metrics.posts);
  const items = [activityItem, consistencyItem];
  const overallScore = Math.round((activityItem.points + consistencyItem.points) / 2);

  const findings: string[] = [];
  if (postsWithinDays(metrics.posts, now, 30) === 0) findings.push("최근 30일간 게시글이 없어요.");
  if (metrics.observedCapped) {
    findings.push("최근 30개 글 기준으로 계산했어요 — 그보다 오래된 글은 포함되지 않았어요.");
  }

  const recommendations: string[] = [];
  if (activityItem.points < 70) recommendations.push("꾸준한 노출을 위해 월 4회 이상 게시를 목표로 해보세요.");
  if (consistencyItem.points < 70) recommendations.push("게시 요일을 일정하게 유지하면 꾸준함 점수가 올라가요.");

  const completeness: ChannelDiagnosisCompleteness = metrics.posts.length < 2 ? "PARTIAL" : "COMPLETE";

  return { overallScore, activityScore: activityItem.points, consistencyScore: consistencyItem.points, items, findings, recommendations, completeness };
}
