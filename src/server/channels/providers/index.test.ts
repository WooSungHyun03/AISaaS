import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { serverEnvMock } = vi.hoisted(() => ({ serverEnvMock: { CHANNEL_DATA_PROVIDER: "mock" as string } }));
vi.mock("@/lib/env/server", () => ({ serverEnv: serverEnvMock }));

beforeEach(() => {
  vi.resetModules();
  serverEnvMock.CHANNEL_DATA_PROVIDER = "mock";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getYouTubeDataProvider", () => {
  it("returns a MockYouTubeDataProvider when CHANNEL_DATA_PROVIDER=mock", async () => {
    const { getYouTubeDataProvider } = await import("./index");
    const { MockYouTubeDataProvider } = await import("./youtube-mock");
    expect(getYouTubeDataProvider()).toBeInstanceOf(MockYouTubeDataProvider);
  });

  it("returns a YouTubeChannelDataProvider when CHANNEL_DATA_PROVIDER=live", async () => {
    serverEnvMock.CHANNEL_DATA_PROVIDER = "live";
    const { getYouTubeDataProvider } = await import("./index");
    const { YouTubeChannelDataProvider } = await import("./youtube");
    expect(getYouTubeDataProvider()).toBeInstanceOf(YouTubeChannelDataProvider);
  });

  it("caches the provider instance across calls within the same module instance", async () => {
    const { getYouTubeDataProvider } = await import("./index");
    expect(getYouTubeDataProvider()).toBe(getYouTubeDataProvider());
  });
});
