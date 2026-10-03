import { afterEach, describe, expect, it, vi } from "vitest";
import type { Automation, Business } from "@/types/domain";
import type { AutomationRunContext } from "@/types/automation";

const { generateStructuredMock } = vi.hoisted(() => ({ generateStructuredMock: vi.fn() }));
vi.mock("@/server/ai/generate", () => ({ generateStructured: generateStructuredMock }));

const { publishMock, isConfiguredMock, InstagramConnectorMock } = vi.hoisted(() => {
  const publishMock = vi.fn();
  const isConfiguredMock = vi.fn();
  // A regular function (not an arrow function) so `new InstagramConnector()` works.
  const InstagramConnectorMock = vi.fn().mockImplementation(function () {
    return { publish: publishMock, isConfigured: isConfiguredMock };
  });
  return { publishMock, isConfiguredMock, InstagramConnectorMock };
});
vi.mock("@/server/connectors/instagram", () => ({ InstagramConnector: InstagramConnectorMock }));

const { getConnectionMock, loadInstagramConnectorMock, updateConnectionStatusMock } = vi.hoisted(() => ({
  getConnectionMock: vi.fn(),
  loadInstagramConnectorMock: vi.fn(),
  updateConnectionStatusMock: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ kind: "admin" })) }));
vi.mock("@/server/connectors/integrations", () => ({ getConnection: getConnectionMock, updateConnectionStatus: updateConnectionStatusMock }));
vi.mock("@/server/connectors/instagram/connect", () => ({ loadInstagramConnector: loadInstagramConnectorMock }));

const { ensureMarketingCardImageUrlMock } = vi.hoisted(() => ({ ensureMarketingCardImageUrlMock: vi.fn() }));
vi.mock("@/server/connectors/instagram/media", () => ({ ensureMarketingCardImageUrl: ensureMarketingCardImageUrlMock }));

const { instagramAutomationHandler } = await import("./instagram");

afterEach(() => {
  vi.resetAllMocks();
  getConnectionMock.mockResolvedValue(null);
  loadInstagramConnectorMock.mockResolvedValue(null);
  ensureMarketingCardImageUrlMock.mockResolvedValue("https://storage.example.com/marketing-card.png");
  InstagramConnectorMock.mockImplementation(function () {
    return { publish: publishMock, isConfigured: isConfiguredMock };
  });
});

getConnectionMock.mockResolvedValue(null);
ensureMarketingCardImageUrlMock.mockResolvedValue("https://storage.example.com/marketing-card.png");

const business: Business = {
  id: "biz-1",
  owner_id: "user-1",
  name: "우리동네 빵집",
  industry: "베이커리",
  description: null,
  location: "서울 마포구",
  target_customer: "20-30대 직장인",
  brand_tone: "친근하고 따뜻한",
  keywords: ["소금빵", "크루아상"],
  website: null,
  sns_links: {},
  main_offering: null,
  strengths: null,
  marketing_goal: null,
  public_widget_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const automation = {
  id: "auto-1",
  user_id: "user-1",
  business_id: "biz-1",
  template_id: "tmpl-1",
  name: "인스타그램 자동화",
  status: "ACTIVE",
  schedule: {},
  config: {},
  last_run_at: null,
  next_run_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
} as unknown as Automation;

const caption = {
  topic: "겨울 한정 소금빵 신메뉴",
  caption: "겨울 한정 소금빵이 새로 나왔어요! 지금 매장에서 만나보세요.",
  hashtags: ["소금빵", "베이커리", "겨울한정"],
};

function baseContext(overrides: Partial<AutomationRunContext> = {}): AutomationRunContext {
  return {
    automation,
    business,
    config: {},
    recentTopics: [],
    runId: "run-1",
    ...overrides,
  };
}

describe("instagramAutomationHandler", () => {
  it("uses the business's connected (shared) InstagramConnector when one exists", async () => {
    getConnectionMock.mockResolvedValueOnce({ id: "conn-1", status: "CONNECTED" });
    loadInstagramConnectorMock.mockResolvedValueOnce({ publish: publishMock, isConfigured: () => true });
    generateStructuredMock.mockResolvedValueOnce(caption);
    publishMock.mockResolvedValueOnce({ externalId: "media-1" });

    const result = await instagramAutomationHandler.run(baseContext());

    expect(loadInstagramConnectorMock).toHaveBeenCalledWith({ kind: "admin" }, "user-1", "biz-1");
    expect(InstagramConnectorMock).not.toHaveBeenCalled();
    expect(publishMock).toHaveBeenCalledWith({
      content: "겨울 한정 소금빵이 새로 나왔어요! 지금 매장에서 만나보세요.\n\n#소금빵 #베이커리 #겨울한정",
      imageUrl: "https://storage.example.com/marketing-card.png",
    });
    expect(result.title).toBe(caption.topic);
    expect(result.topic).toBe(caption.topic);
    expect(result.contentType).toBe("instagram-marketing");
    expect(result.output).toMatchObject({
      topic: caption.topic,
      caption: caption.caption,
      hashtags: caption.hashtags,
      imageUrl: "https://storage.example.com/marketing-card.png",
      mediaId: "media-1",
    });
  });

  it("falls back to the legacy env-configured InstagramConnector when the business has no shared connection", async () => {
    isConfiguredMock.mockReturnValue(true);
    generateStructuredMock.mockResolvedValueOnce(caption);
    publishMock.mockResolvedValueOnce({ externalId: "media-2" });

    const result = await instagramAutomationHandler.run(baseContext());

    expect(loadInstagramConnectorMock).not.toHaveBeenCalled();
    expect(InstagramConnectorMock).toHaveBeenCalledTimes(1);
    expect(result.output).toMatchObject({ mediaId: "media-2" });
  });

  it("throws and marks a CONNECTED-but-unusable connection ERROR when no usable connector is found", async () => {
    getConnectionMock.mockResolvedValueOnce({ id: "conn-1", status: "CONNECTED" });
    loadInstagramConnectorMock.mockResolvedValueOnce(null);

    await expect(instagramAutomationHandler.run(baseContext())).rejects.toThrow(/Instagram 연결이/);

    expect(updateConnectionStatusMock).toHaveBeenCalledWith({ kind: "admin" }, "conn-1", "ERROR");
    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("throws without touching the connection when there was never a shared connection and env vars aren't configured either", async () => {
    isConfiguredMock.mockReturnValue(false);

    await expect(instagramAutomationHandler.run(baseContext())).rejects.toThrow(/Instagram 연결이/);

    expect(updateConnectionStatusMock).not.toHaveBeenCalled();
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it("marks the connection EXPIRED on an AUTH_FAILED publish failure and rethrows", async () => {
    getConnectionMock.mockResolvedValueOnce({ id: "conn-1", status: "CONNECTED" });
    loadInstagramConnectorMock.mockResolvedValueOnce({ publish: publishMock, isConfigured: () => true });
    generateStructuredMock.mockResolvedValueOnce(caption);
    const { ConnectorError } = await import("@/server/shared/errors");
    publishMock.mockRejectedValueOnce(new ConnectorError("instagram", "AUTH_FAILED", "Instagram 인증에 실패했습니다."));

    await expect(instagramAutomationHandler.run(baseContext())).rejects.toThrow("Instagram 인증에 실패했습니다.");

    expect(updateConnectionStatusMock).toHaveBeenCalledWith({ kind: "admin" }, "conn-1", "EXPIRED");
  });

  it("marks the connection ERROR (not EXPIRED) on a non-auth publish failure and rethrows", async () => {
    getConnectionMock.mockResolvedValueOnce({ id: "conn-1", status: "CONNECTED" });
    loadInstagramConnectorMock.mockResolvedValueOnce({ publish: publishMock, isConfigured: () => true });
    generateStructuredMock.mockResolvedValueOnce(caption);
    const { ConnectorError } = await import("@/server/shared/errors");
    publishMock.mockRejectedValueOnce(new ConnectorError("instagram", "UPSTREAM_SERVER_ERROR", "Instagram 게시물 처리에 실패했습니다."));

    await expect(instagramAutomationHandler.run(baseContext())).rejects.toThrow("Instagram 게시물 처리에 실패했습니다.");

    expect(updateConnectionStatusMock).toHaveBeenCalledWith({ kind: "admin" }, "conn-1", "ERROR");
  });

  it("regenerates the topic exactly once when the first pick is a near-duplicate, then accepts the second", async () => {
    isConfiguredMock.mockReturnValue(true);
    generateStructuredMock
      .mockResolvedValueOnce({ ...caption, topic: "겨울철 난방비 절약 팁" }) // near-dup of recent
      .mockResolvedValueOnce(caption); // accepted regardless of its own similarity
    publishMock.mockResolvedValueOnce({ externalId: "media-3" });

    const result = await instagramAutomationHandler.run(baseContext({ recentTopics: ["겨울철 난방비 절약하는 방법"] }));

    expect(generateStructuredMock).toHaveBeenCalledTimes(2);
    expect(result.title).toBe(caption.topic);
  });

  it("does not regenerate when the first topic is already distinct from recent history", async () => {
    isConfiguredMock.mockReturnValue(true);
    generateStructuredMock.mockResolvedValueOnce(caption);
    publishMock.mockResolvedValueOnce({ externalId: "media-4" });

    await instagramAutomationHandler.run(baseContext({ recentTopics: ["여름 휴가철 여행지 추천"] }));

    expect(generateStructuredMock).toHaveBeenCalledTimes(1);
  });

  it("throws instead of returning a partial result when caption generation fails", async () => {
    isConfiguredMock.mockReturnValue(true);
    generateStructuredMock.mockRejectedValueOnce(new Error("AI provider unavailable"));

    await expect(instagramAutomationHandler.run(baseContext())).rejects.toThrow("AI provider unavailable");
    expect(ensureMarketingCardImageUrlMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("propagates a marketing-card upload failure without calling publish", async () => {
    isConfiguredMock.mockReturnValue(true);
    generateStructuredMock.mockResolvedValueOnce(caption);
    ensureMarketingCardImageUrlMock.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(instagramAutomationHandler.run(baseContext())).rejects.toThrow("storage unavailable");
    expect(publishMock).not.toHaveBeenCalled();
  });
});
