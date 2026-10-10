import type { TistoryRssMetrics } from "./tistory";

const DAY_MS = 86_400_000;

/**
 * Fixed sample RSS data (ticket 1-3's "mock 공급자는 샘플 RSS 문자열 픽스처를
 * 써요") — dates are generated relative to the injected `now` rather than
 * hardcoded, so CHANNEL_DATA_PROVIDER=mock stays deterministic and
 * "최근 30일" scoring stays meaningful however long this file goes unchanged.
 */
export async function collectMockTistoryRssMetrics(_blogUrl: string, now: Date = new Date()): Promise<TistoryRssMetrics> {
  const nowMs = now.getTime();
  const posts = Array.from({ length: 8 }, (_, i) => ({ publishedAt: new Date(nowMs - (i * 4 + 1) * DAY_MS).toISOString() }));
  return { posts, observedCapped: false, unavailableReason: null };
}
