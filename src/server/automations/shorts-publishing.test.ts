import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
  updateConnectionStatus: vi.fn(),
  loadInstagramConnector: vi.fn(),
  loadYouTubeConnector: vi.fn(),
  instagramPublish: vi.fn(),
  youtubePublish: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ kind: "admin" }) }));
vi.mock("@/server/connectors/integrations", () => ({
  getConnection: mocks.getConnection,
  updateConnectionStatus: mocks.updateConnectionStatus,
}));
vi.mock("@/server/connectors/instagram/connect", () => ({ loadInstagramConnector: mocks.loadInstagramConnector }));
vi.mock("@/server/connectors/youtube/connect", () => ({ loadYouTubeConnector: mocks.loadYouTubeConnector }));
vi.mock("@/server/connectors/instagram", () => ({ InstagramConnector: class {} }));
vi.mock("@/server/connectors/youtube", () => ({ YouTubeConnector: class {} }));

const { publishShortsToPlatforms } = await import("./shorts-publishing");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getConnection.mockImplementation((_admin, _userId, _businessId, provider) => Promise.resolve({ id: `${provider}-connection`, status: "CONNECTED" }));
  mocks.loadInstagramConnector.mockResolvedValue({ isConfigured: () => true, publish: mocks.instagramPublish });
  mocks.loadYouTubeConnector.mockResolvedValue({ isConfigured: () => true, publish: mocks.youtubePublish });
  mocks.instagramPublish.mockResolvedValue({ externalId: "reel-1" });
  mocks.youtubePublish.mockResolvedValue({ externalId: "video-1", externalUrl: "https://www.youtube.com/watch?v=video-1" });
});

describe("publishShortsToPlatforms", () => {
  it("publishes the same rendered video to selected platforms and returns only public result fields", async () => {
    const result = await publishShortsToPlatforms({
      userId: "user-1",
      businessId: "business-1",
      title: "후킹 제목",
      caption: "게시 설명 #태그1 #태그2 #태그3",
      videoUrl: "https://cdn.example.com/short.mp4",
      platforms: ["instagram", "youtube"],
    });

    expect(mocks.instagramPublish).toHaveBeenCalledWith({
      content: "게시 설명 #태그1 #태그2 #태그3",
      mediaType: "REELS",
      videoUrl: "https://cdn.example.com/short.mp4",
    });
    expect(mocks.youtubePublish).toHaveBeenCalledWith({
      title: "후킹 제목",
      content: "게시 설명 #태그1 #태그2 #태그3",
      videoUrl: "https://cdn.example.com/short.mp4",
    });
    expect(result).toEqual({
      instagram: { externalId: "reel-1", externalUrl: null, privacy: null },
      youtube: { externalId: "video-1", externalUrl: "https://www.youtube.com/watch?v=video-1", privacy: "private" },
    });
  });

  it("rejects an empty platform selection before calling a connector", async () => {
    await expect(publishShortsToPlatforms({
      userId: "user-1",
      businessId: "business-1",
      title: "제목",
      caption: "설명",
      videoUrl: "https://cdn.example.com/short.mp4",
      platforms: [],
    })).rejects.toThrow("플랫폼");
    expect(mocks.instagramPublish).not.toHaveBeenCalled();
    expect(mocks.youtubePublish).not.toHaveBeenCalled();
  });
});

