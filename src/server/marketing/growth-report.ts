/**
 * Growth Report: only numbers that can be computed from this service's own
 * records, each tagged with where it came from. External performance data
 * (views, likes, followers, conversions) is listed as UNAVAILABLE instead of
 * being estimated or generated — nothing in this file calls an AI.
 *
 * Pure functions: the page loads rows and passes them in, which keeps every
 * rule here unit-testable.
 */

export type MetricSource =
  /** Computed from this service's own database. */
  | "INTERNAL"
  /** Read from an official platform API with the user's connected account. */
  | "EXTERNAL_VERIFIED"
  /** A modelled value, always labelled as an estimate. */
  | "ESTIMATED"
  /** Cannot be obtained with the access this service has today. */
  | "UNAVAILABLE";

export const SOURCE_LABEL: Record<MetricSource, string> = {
  INTERNAL: "서비스 기록",
  EXTERNAL_VERIFIED: "플랫폼 확인",
  ESTIMATED: "추정",
  UNAVAILABLE: "확인 불가",
};

export interface ContentRow {
  content_type: string;
  topic: string | null;
  created_at: string;
}
export interface RunRow {
  status: string;
  created_at: string;
  /** Number of platforms a Shorts run reported a successful publish to (from the platform's own response). */
  publishedCount: number;
}
export interface CalendarRow {
  platform: string;
  status: string;
  planned_date: string;
}

export interface ReportInput {
  now: Date;
  days: number;
  content: ContentRow[];
  runs: RunRow[];
  calendar: CalendarRow[];
}

export interface Comparison {
  current: number;
  previous: number;
  /** current - previous; for rates this is in percentage points. */
  delta: number;
  /** Relative change in %, only when there is a non-zero previous value to compare against. */
  deltaPercent: number | null;
}

export interface Rate extends Comparison {
  /** Denominators, so the UI can say "7 of 10". */
  currentOf: number;
  previousOf: number;
}

export interface GrowthReport {
  days: number;
  source: Record<"content" | "runs" | "calendar" | "publications", MetricSource>;
  contentCount: Comparison;
  byType: Array<{ type: string; label: string; current: number; previous: number }>;
  successRate: Rate | null;
  calendarCompletion: Rate | null;
  publications: Comparison;
  weekly: Array<{ label: string; count: number }>;
  calendar: { planned: number; done: number; skipped: number; open: number; byPlatform: Array<{ platform: string; label: string; total: number; done: number }> };
  topTopics: Array<{ topic: string; count: number }>;
  unavailable: Array<{ key: string; label: string; reason: string }>;
  suggestions: string[];
  hasAnyData: boolean;
}

const DAY_MS = 86_400_000;

export const CONTENT_TYPE_LABEL: Record<string, string> = {
  "blog-marketing": "블로그 글",
  shorts: "숏폼 영상",
  "shorts-publish": "숏폼 게시",
  instagram: "인스타그램",
  newsletter: "뉴스레터",
};
const PLATFORM_LABEL: Record<string, string> = { blog: "블로그", youtube_shorts: "유튜브 쇼츠", instagram_reels: "인스타 릴스" };

function compare(current: number, previous: number): Comparison {
  return { current, previous, delta: current - previous, deltaPercent: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null };
}

function rate(currentNumerator: number, currentDenominator: number, previousNumerator: number, previousDenominator: number): Rate | null {
  if (currentDenominator === 0 && previousDenominator === 0) return null;
  const current = currentDenominator === 0 ? 0 : Math.round((currentNumerator / currentDenominator) * 100);
  const previous = previousDenominator === 0 ? 0 : Math.round((previousNumerator / previousDenominator) * 100);
  return { current, previous, delta: current - previous, deltaPercent: null, currentOf: currentDenominator, previousOf: previousDenominator };
}

function period(time: number, now: number, days: number): "current" | "previous" | null {
  const age = now - time;
  if (age < 0) return null;
  if (age < days * DAY_MS) return "current";
  if (age < days * 2 * DAY_MS) return "previous";
  return null;
}

/** KST calendar date (YYYY-MM-DD) for an instant, used to compare against calendar_items.planned_date. */
function kstDate(time: number): string {
  return new Date(time + 9 * 3_600_000).toISOString().slice(0, 10);
}

export function buildGrowthReport({ now, days, content, runs, calendar }: ReportInput): GrowthReport {
  const nowMs = now.getTime();

  const contentCurrent = content.filter((row) => period(Date.parse(row.created_at), nowMs, days) === "current");
  const contentPrevious = content.filter((row) => period(Date.parse(row.created_at), nowMs, days) === "previous");
  // "shorts-publish" rows record a publish operation, not a new piece of content.
  const created = (rows: ContentRow[]) => rows.filter((row) => row.content_type !== "shorts-publish");

  const types = Array.from(new Set(created(content).map((row) => row.content_type)));
  const byType = types
    .map((type) => ({
      type,
      label: CONTENT_TYPE_LABEL[type] ?? type,
      current: created(contentCurrent).filter((row) => row.content_type === type).length,
      previous: created(contentPrevious).filter((row) => row.content_type === type).length,
    }))
    .sort((a, b) => b.current - a.current || b.previous - a.previous);

  const finished = (rows: RunRow[], which: "current" | "previous") =>
    rows.filter((row) => (row.status === "SUCCESS" || row.status === "FAILED") && period(Date.parse(row.created_at), nowMs, days) === which);
  const finishedCurrent = finished(runs, "current");
  const finishedPrevious = finished(runs, "previous");
  const successRate = rate(
    finishedCurrent.filter((row) => row.status === "SUCCESS").length, finishedCurrent.length,
    finishedPrevious.filter((row) => row.status === "SUCCESS").length, finishedPrevious.length,
  );

  const publishedIn = (which: "current" | "previous") =>
    runs.filter((row) => row.status === "SUCCESS" && period(Date.parse(row.created_at), nowMs, days) === which).reduce((total, row) => total + row.publishedCount, 0);

  // Calendar completion: of the items that were due in a period (skipped ones excluded), how many got made.
  const calendarPeriod = (row: CalendarRow) => period(Date.parse(`${row.planned_date}T00:00:00+09:00`), nowMs, days);
  const dueIn = (which: "current" | "previous") => calendar.filter((row) => calendarPeriod(row) === which && row.status !== "SKIPPED");
  const isDone = (row: CalendarRow) => row.status === "GENERATED" || row.status === "PUBLISHED";
  const calendarCompletion = rate(
    dueIn("current").filter(isDone).length, dueIn("current").length,
    dueIn("previous").filter(isDone).length, dueIn("previous").length,
  );

  const today = kstDate(nowMs);
  const inWindow = calendar.filter((row) => calendarPeriod(row) === "current" || row.planned_date >= today);
  const platforms = Array.from(new Set(inWindow.map((row) => row.platform)));
  const calendarSummary = {
    planned: inWindow.length,
    done: inWindow.filter(isDone).length,
    skipped: inWindow.filter((row) => row.status === "SKIPPED").length,
    open: inWindow.filter((row) => row.status === "PLANNED").length,
    byPlatform: platforms.map((platform) => ({
      platform,
      label: PLATFORM_LABEL[platform] ?? platform,
      total: inWindow.filter((row) => row.platform === platform && row.status !== "SKIPPED").length,
      done: inWindow.filter((row) => row.platform === platform && isDone(row)).length,
    })),
  };

  const weekCount = Math.min(Math.max(Math.ceil(days / 7), 4), 12);
  const weekly = Array.from({ length: weekCount }, (_, index) => {
    const weeksAgo = weekCount - 1 - index;
    const count = created(content).filter((row) => {
      const age = nowMs - Date.parse(row.created_at);
      return age >= weeksAgo * 7 * DAY_MS && age < (weeksAgo + 1) * 7 * DAY_MS;
    }).length;
    return { label: weeksAgo === 0 ? "이번 주" : `${weeksAgo}주 전`, count };
  });

  const topicCounts = new Map<string, number>();
  for (const row of created(contentCurrent)) {
    const topic = row.topic?.trim();
    if (topic) topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
  }
  const topTopics = Array.from(topicCounts, ([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count).slice(0, 8);

  const contentCount = compare(created(contentCurrent).length, created(contentPrevious).length);
  const publications = compare(publishedIn("current"), publishedIn("previous"));

  const report: GrowthReport = {
    days,
    source: { content: "INTERNAL", runs: "INTERNAL", calendar: "INTERNAL", publications: "EXTERNAL_VERIFIED" },
    contentCount,
    byType,
    successRate,
    calendarCompletion,
    publications,
    weekly,
    calendar: calendarSummary,
    topTopics,
    unavailable: [
      { key: "views", label: "조회수", reason: "인스타그램·유튜브의 성과 데이터(Insights/Analytics) 권한이 아직 연결돼 있지 않아 가져올 수 없어요." },
      { key: "engagement", label: "좋아요·댓글·저장", reason: "공식 API 권한 없이는 확인할 수 없어서 추정하지 않아요." },
      { key: "followers", label: "팔로워 증감", reason: "계정 연결과 성과 권한이 있어야 확인할 수 있어요." },
      { key: "conversion", label: "문의·구매 전환", reason: "홈페이지·예약 시스템과 연결돼 있지 않아 이 서비스가 알 수 없는 값이에요." },
    ],
    suggestions: [],
    hasAnyData: content.length > 0 || runs.length > 0 || calendar.length > 0,
  };
  report.suggestions = buildSuggestions(report);
  return report;
}

/**
 * Suggestions are rules over the measured numbers above — each one names
 * the number that triggered it, so none of them can claim a result the data
 * doesn't show.
 */
export function buildSuggestions(report: GrowthReport): string[] {
  const suggestions: string[] = [];
  const { contentCount, calendarCompletion, successRate, calendar, byType } = report;

  if (contentCount.current === 0) {
    suggestions.push("이 기간에 만든 콘텐츠가 없어요. 캘린더에서 한 건만 먼저 만들어 보세요.");
  } else if (contentCount.previous > 0 && contentCount.current < contentCount.previous) {
    suggestions.push(`이전 ${report.days}일에는 ${contentCount.previous}건을 만들었는데 이번에는 ${contentCount.current}건이에요. 정해둔 요일에 만들도록 만들기 설정의 주기를 확인해 보세요.`);
  }
  if (calendarCompletion && calendarCompletion.currentOf >= 3 && calendarCompletion.current < 50) {
    suggestions.push(`캘린더 수행률이 ${calendarCompletion.current}%예요(${calendarCompletion.currentOf}건 중 ${Math.round((calendarCompletion.current / 100) * calendarCompletion.currentOf)}건). 계획 수를 줄이거나 건너뛸 항목을 정리해 보세요.`);
  }
  if (successRate && successRate.currentOf >= 3 && successRate.current < 80) {
    suggestions.push(`제작 성공률이 ${successRate.current}%예요. 제작 기록에서 실패한 항목의 이유를 확인해 보세요.`);
  }
  if (calendar.open > 0) suggestions.push(`아직 만들지 않은 계획이 ${calendar.open}건 남아 있어요. 가까운 날짜부터 만들어 보세요.`);
  const hasBlog = byType.some((entry) => entry.type === "blog-marketing" && entry.current > 0);
  const hasShorts = byType.some((entry) => entry.type === "shorts" && entry.current > 0);
  if (hasBlog && !hasShorts) suggestions.push("블로그 글만 만들고 있어요. 같은 주제로 숏폼도 만들면 더 많은 손님에게 닿을 수 있어요.");
  if (!hasBlog && hasShorts) suggestions.push("숏폼만 만들고 있어요. 같은 주제의 블로그 글을 함께 만들면 검색으로도 찾아와요.");
  return suggestions.slice(0, 5);
}
