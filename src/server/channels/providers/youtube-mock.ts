import type { YouTubeChannelLookup, YouTubeChannelPreview, YouTubeDataProvider, YouTubeRawMetrics } from "./youtube-types";

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
      videoId: `mockVideo${String(i).padStart(4, "0")}`,
      title: `샘플 영상 ${10 - i}`,
      likeCount: 20 + i,
      commentCount: 2 + (i % 3),
      publishedAt: new Date(nowMs - (i * 7 + 1) * DAY_MS).toISOString(),
      viewCount: 500 + i * 15,
    }));

    return {
      channelId: "UCmockSampleChannel00000a",
      title: "샘플 채널",
      thumbnailUrl: null,
      subscriberCount: 1_200,
      hiddenSubscriberCount: false,
      viewCount: 85_000,
      videoCount: 42,
      recentVideos,
    };
  }

  async lookup(input: YouTubeChannelLookup): Promise<YouTubeChannelPreview> {
    const handle = "handle" in input ? (input.handle.startsWith("@") ? input.handle : `@${input.handle}`) : null;
    // A stable fake id per input, so two different sample channels never collide on the unique (business, platform, id).
    const seed = "handle" in input ? input.handle : "username" in input ? input.username : input.channelId;
    let hash = 7;
    for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) % 2_147_483_647;
    const channelId = "channelId" in input ? input.channelId : `UCmock${hash.toString(36).padStart(18, "0").slice(0, 18)}`;
    return { channelId, title: "샘플 채널", handle, thumbnailUrl: null, subscriberCount: 1_200, videoCount: 42 };
  }
}
