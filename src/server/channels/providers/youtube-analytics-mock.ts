import type { YouTubeAnalyticsCollector, YouTubeAnalyticsDailyMetrics } from "./youtube-analytics-types";

const DAY_MS = 86_400_000;
/** Mirrors the real API's documented 48–72h processing delay: the most recent ~3 days never have data yet, so the mock doesn't return them either. */
const LAG_DAYS = 3;
const MOCK_WINDOW_DAYS = 4;

/** KST (UTC+9) calendar date for an instant. Kept local (not imported from growth-series.ts) so this provider primitive doesn't depend on a higher-level report module. */
function kstDate(timeMs: number): string {
  return new Date(timeMs + 9 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Deterministic, no-network sample — a handful of trailing days (offset
 * by LAG_DAYS, like the real API) with a mild upward trend, mirroring the
 * style of youtube-mock.ts's MockYouTubeDataProvider. Only ever used when
 * CHANNEL_DATA_PROVIDER=mock (see providers/index.ts).
 */
export const collectMockYouTubeAnalytics: YouTubeAnalyticsCollector = async ({ now }) => {
  const nowMs = now.getTime();
  const days: YouTubeAnalyticsDailyMetrics[] = [];
  for (let offset = LAG_DAYS + MOCK_WINDOW_DAYS - 1; offset >= LAG_DAYS; offset--) {
    const ageFromOldest = LAG_DAYS + MOCK_WINDOW_DAYS - 1 - offset;
    days.push({
      date: kstDate(nowMs - offset * DAY_MS),
      estimatedMinutesWatched: 400 + ageFromOldest * 12,
      averageViewDuration: 95 + ageFromOldest * 2,
    });
  }
  return days;
};
