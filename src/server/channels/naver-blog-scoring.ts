import type { ChannelDiagnosisCompleteness } from "./completeness";
import type { NaverBlogMetrics } from "./providers/naver-types";

/**
 * Single place for this caveat so it's never duplicated — blog.json search
 * results can never include visitor counts, whether or not any matching
 * post was found, so this is attached both to a 0-match INSUFFICIENT_DATA
 * result and as a permanent note on an otherwise-COMPLETE one.
 */
export const NAVER_SEARCH_LIMITATION_NOTICE = "검색에 노출된 글 기준이에요, 방문자 수는 확인할 수 없어요.";
/** The RSS lists the blog's own latest posts, so the caveat is about how far back it reaches, not about search exposure. */
export const NAVER_RSS_LIMITATION_NOTICE = "블로그 RSS에 공개된 최근 글(최대 50개) 기준이에요, 방문자 수와 조회수는 확인할 수 없어요.";

function limitationNotice(metrics: NaverBlogMetrics): string {
  return metrics.basis === "rss" ? NAVER_RSS_LIMITATION_NOTICE : NAVER_SEARCH_LIMITATION_NOTICE;
}

/** "RSS에 공개된" vs "검색에 노출된" — the same sentence, honest about where the numbers came from. */
function posts(metrics: NaverBlogMetrics): string {
  return metrics.basis === "rss" ? "최근 공개된 글" : "검색에 노출된 글";
}

export interface NaverBlogScoreItem {
  key: string;
  group: "activity" | "consistency";
  label: string;
  points: number;
  detail: string;
}

export interface NaverBlogScoreResult {
  /** Average of activityScore/consistencyScore only — contentScore is always null: blog.json has no view/visitor data (see NAVER_SEARCH_LIMITATION_NOTICE, always included in `findings`). */
  overallScore: number;
  activityScore: number;
  consistencyScore: number;
  contentScore: number | null;
  items: NaverBlogScoreItem[];
  findings: string[];
  recommendations: string[];
  completeness: ChannelDiagnosisCompleteness;
}

function scoreActivity(metrics: NaverBlogMetrics): NaverBlogScoreItem {
  const { postsLast30Days } = metrics;
  const points = postsLast30Days === 0 ? 0 : postsLast30Days <= 3 ? 40 : postsLast30Days <= 7 ? 70 : 100;
  const detail = postsLast30Days === 0 ? `최근 30일간 ${posts(metrics)}이 없어요.` : `최근 30일간 ${posts(metrics)}이 ${postsLast30Days}개예요.`;
  return { key: "posts_last_30_days", group: "activity", label: metrics.basis === "rss" ? "최근 게시 빈도(RSS 기준)" : "최근 게시 빈도(검색 노출 기준)", points, detail };
}

function scoreConsistency(metrics: NaverBlogMetrics): NaverBlogScoreItem {
  if (metrics.averageGapDays === null) {
    return {
      key: "post_interval",
      group: "consistency",
      label: "게시 간격 꾸준함",
      points: 20,
      detail: `${posts(metrics)}이 적어 꾸준함을 판단하기엔 데이터가 부족해요.`,
    };
  }

  const gap = metrics.averageGapDays;
  const points = gap <= 3 ? 100 : gap <= 7 ? 70 : gap <= 14 ? 40 : 20;
  return {
    key: "post_interval",
    group: "consistency",
    label: "게시 간격 꾸준함",
    points,
    detail: `${posts(metrics)} 사이 평균 간격이 ${gap.toFixed(1)}일이에요.`,
  };
}

/** Pure: same `metrics` always produces the same result (postsLast30Days is already computed relative to `now` by the collector — see naver-blog.ts). */
export function scoreNaverBlogChannel(metrics: NaverBlogMetrics): NaverBlogScoreResult {
  if (metrics.matchedPostCount === 0) {
    return {
      overallScore: 0,
      activityScore: 0,
      consistencyScore: 0,
      contentScore: null,
      items: [],
      findings: [limitationNotice(metrics)],
      recommendations: [],
      completeness: "INSUFFICIENT_DATA",
    };
  }

  const activityItem = scoreActivity(metrics);
  const consistencyItem = scoreConsistency(metrics);
  const items = [activityItem, consistencyItem];
  const overallScore = Math.round((activityItem.points + consistencyItem.points) / 2);

  const recommendations: string[] = [];
  if (activityItem.points < 70) recommendations.push(metrics.basis === "rss" ? "한 달에 최소 4~8개씩 정해진 요일에 꾸준히 올려보세요." : "검색에 노출되려면 블로그 이름/키워드가 포함된 제목으로 꾸준히 게시해보세요.");
  if (consistencyItem.points < 70) recommendations.push("게시 요일을 일정하게 유지하면 꾸준함 점수가 올라가요.");

  const completeness: ChannelDiagnosisCompleteness = metrics.matchedPostCount < 2 ? "PARTIAL" : "COMPLETE";

  return { overallScore, activityScore: activityItem.points, consistencyScore: consistencyItem.points, contentScore: null, items, findings: [limitationNotice(metrics)], recommendations, completeness };
}
