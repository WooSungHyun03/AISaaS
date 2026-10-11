import { describe, expect, it } from "vitest";
import { YOUTUBE_ANALYTICS_SCOPE, hasYouTubeAnalyticsScope } from "./youtube-analytics-scope";

describe("hasYouTubeAnalyticsScope", () => {
  it("returns false when metadata is missing", () => {
    expect(hasYouTubeAnalyticsScope({ metadata: null })).toBe(false);
  });

  it("returns false when metadata has no scope field", () => {
    expect(hasYouTubeAnalyticsScope({ metadata: { channelId: "UC1" } })).toBe(false);
  });

  it("returns false when scope is an empty string", () => {
    expect(hasYouTubeAnalyticsScope({ metadata: { scope: "" } })).toBe(false);
  });

  it("returns false when scope is present but doesn't include yt-analytics.readonly", () => {
    expect(
      hasYouTubeAnalyticsScope({
        metadata: { scope: "https://www.googleapis.com/auth/youtube.upload" },
      }),
    ).toBe(false);
  });

  it("returns true when scope is exactly yt-analytics.readonly", () => {
    expect(hasYouTubeAnalyticsScope({ metadata: { scope: YOUTUBE_ANALYTICS_SCOPE } })).toBe(true);
  });

  it("returns true when scope is a space-joined list that includes yt-analytics.readonly", () => {
    expect(
      hasYouTubeAnalyticsScope({
        metadata: {
          scope: `https://www.googleapis.com/auth/youtube.upload ${YOUTUBE_ANALYTICS_SCOPE}`,
        },
      }),
    ).toBe(true);
  });

  it("returns false when metadata is not an object (e.g. array or primitive from a malformed row)", () => {
    expect(hasYouTubeAnalyticsScope({ metadata: [] as unknown as Record<string, never> })).toBe(false);
    expect(hasYouTubeAnalyticsScope({ metadata: "not-an-object" as unknown as Record<string, never> })).toBe(false);
  });
});
