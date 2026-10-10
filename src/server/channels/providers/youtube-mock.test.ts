import { describe, expect, it } from "vitest";
import { MockYouTubeDataProvider } from "./youtube-mock";

describe("MockYouTubeDataProvider", () => {
  it("returns the same fixed sample channel for any externalId, given the same now", async () => {
    const now = new Date("2026-10-10T00:00:00.000Z");
    const provider = new MockYouTubeDataProvider();

    const a = await provider.collect("@anything", now);
    const b = await provider.collect("UCsomethingElse1234567890", new Date(now));

    expect(a).toEqual(b);
    expect(a.subscriberCount).toBeGreaterThan(0);
    expect(a.hiddenSubscriberCount).toBe(false);
    expect(a.recentVideos.length).toBeGreaterThan(0);
  });

  it("generates recent upload dates relative to the given now, not the real wall clock", async () => {
    const now = new Date("2020-01-01T00:00:00.000Z");
    const result = await new MockYouTubeDataProvider().collect("@x", now);

    for (const video of result.recentVideos) {
      expect(Date.parse(video.publishedAt)).toBeLessThanOrEqual(now.getTime());
    }
  });
});
