import type { YouTubeDataProvider, YouTubeRawMetrics } from "./youtube-types";

/**
 * Fixed sample channel — same subscriber/view/upload shape every call, so
 * CHANNEL_DATA_PROVIDER=mock always reproduces the same diagnosis (and the
 * UI must label it "샘플 데이터" via data_source="mock" — see diagnose.ts).
 * Recent uploads are generated relative to the `now` passed to collect()
 * rather than hardcoded dates, so "최근 30일 업로드" stays meaningful
 * however long this file goes unchanged.
 */
const DAY_MS = 86_400_000;

export class MockYouTubeDataProvider implements YouTubeDataProvider {
  async collect(_externalId: string, now: Date = new Date()): Promise<YouTubeRawMetrics> {
    const nowMs = now.getTime();
    // Weekly uploads for the last ~10 weeks: active and fairly consistent.
    const recentVideos = Array.from({ length: 10 }, (_, i) => ({
      publishedAt: new Date(nowMs - (i * 7 + 1) * DAY_MS).toISOString(),
      viewCount: 500 + i * 15,
    }));

    return {
      subscriberCount: 1_200,
      hiddenSubscriberCount: false,
      viewCount: 85_000,
      videoCount: 42,
      recentVideos,
    };
  }
}
