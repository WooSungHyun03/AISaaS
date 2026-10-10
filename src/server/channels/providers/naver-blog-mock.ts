import type { NaverBlogMetrics } from "./naver-types";

const DAY_MS = 86_400_000;

/** Fixed sample (same shape as youtube-mock.ts/tistory-mock.ts): dates relative to the injected `now`, so CHANNEL_DATA_PROVIDER=mock stays deterministic. */
export async function collectMockNaverBlogMetrics(
  _externalId: string,
  _businessName: string | undefined,
  now: Date = new Date(),
): Promise<NaverBlogMetrics> {
  const nowMs = now.getTime();
  const dates = Array.from({ length: 6 }, (_, i) => new Date(nowMs - (i * 5 + 2) * DAY_MS).toISOString().slice(0, 10));

  return {
    matchedPostCount: dates.length,
    postsLast30Days: dates.length,
    averageGapDays: 5,
    lastPostDate: dates[0],
    firstPostDate: dates[dates.length - 1],
  };
}
