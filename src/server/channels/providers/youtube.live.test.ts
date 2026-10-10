import { describe, expect, it } from "vitest";
import { YouTubeChannelDataProvider } from "./youtube";

/**
 * Manual, opt-in check against the real YouTube Data API — satisfies ticket
 * 1-2's "YOUTUBE_API_KEY가 있는 로컬에서 실제 공개 채널 1개를 진단해 볼 수
 * 있어요" without a new script-runner tool. Skipped by default (and
 * therefore never hits the network from `npm run test`/CI) unless BOTH are
 * set:
 *
 *   YOUTUBE_API_KEY=... RUN_LIVE_YOUTUBE_TEST=true npx vitest run src/server/channels/providers/youtube.live.test.ts
 */
const RUN_LIVE = process.env.RUN_LIVE_YOUTUBE_TEST === "true" && Boolean(process.env.YOUTUBE_API_KEY);

describe.skipIf(!RUN_LIVE)("YouTubeChannelDataProvider (live network)", () => {
  it("diagnoses the official @YouTube channel", async () => {
    const result = await new YouTubeChannelDataProvider().collect("@YouTube");

    expect(result.videoCount).toBeGreaterThan(0);
    expect(result.viewCount).toBeGreaterThan(0);
    expect(Array.isArray(result.recentVideos)).toBe(true);
  }, 20_000);
});
