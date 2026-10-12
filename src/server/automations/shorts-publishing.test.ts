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
const { buildShortsPublishing } = await import("@/server/shorts/publishing-metadata");

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

  it("posts the owner's (edited) text: YouTube gets title, description and tags, Instagram one composed caption", async () => {
    const publishing = buildShortsPublishing({ promotionType: "STORE", businessName: "빵집", industry: null, location: null, keywords: ["소금빵"], topic: "소금빵 예약", hook: "소금빵 예약하셨나요?", sceneTexts: ["소금빵 예약하셨나요?", "전날 예약하면 아침에 바로 받아가요"], link: null });
    const edited = { ...publishing, title: "내가 고친 제목입니다", youtubeTitle: "내가 고친 유튜브 제목", description: "고친 설명이에요. 소금빵 예약 안내입니다.", hashtags: ["소금빵", "예약"] };

    await publishShortsToPlatforms({
      userId: "user-1",
      businessId: "business-1",
      title: "옛 제목",
      caption: "옛 설명 #a #b #c",
      videoUrl: "https://cdn.example.com/short.mp4",
      platforms: ["instagram", "youtube"],
      publishing: edited,
      link: "https://shop.example.com",
    });

    expect(mocks.youtubePublish).toHaveBeenCalledWith(expect.objectContaining({
      title: "내가 고친 유튜브 제목",
      content: expect.stringContaining("https://shop.example.com"),
      tags: expect.arrayContaining(["소금빵"]),
    }));
    expect(mocks.youtubePublish.mock.calls[0][0].content).toContain("#Shorts");
    expect(mocks.youtubePublish.mock.calls[0][0].content).toContain("고친 설명이에요");
    const instagram = mocks.instagramPublish.mock.calls[0][0] as { content: string };
    expect(instagram.content).toContain("고친 설명이에요");
    expect(instagram.content).toContain("#예약");
    expect(instagram.content).not.toContain("옛 설명");
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

