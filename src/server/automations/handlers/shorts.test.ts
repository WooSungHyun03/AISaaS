import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Automation, Business } from "@/types/domain";
import type { AutomationRunContext } from "@/types/automation";

const { generateStructuredMock } = vi.hoisted(() => ({ generateStructuredMock: vi.fn() }));
vi.mock("@/server/ai/generate", () => ({ generateStructured: generateStructuredMock }));
const { renderShortVideoMock } = vi.hoisted(() => ({ renderShortVideoMock: vi.fn() }));
vi.mock("@/server/connectors/video", () => ({ renderShortVideo: renderShortVideoMock }));
const {
  getConnectionMock,
  instagramConnectorMock,
  instagramIsConfiguredMock,
  instagramPublishMock,
  loadInstagramConnectorMock,
  updateConnectionStatusMock,
} = vi.hoisted(() => {
  const instagramIsConfigured = vi.fn();
  const instagramPublish = vi.fn();
  return {
    getConnectionMock: vi.fn(),
    instagramConnectorMock: { isConfigured: instagramIsConfigured, publish: instagramPublish },
    instagramIsConfiguredMock: instagramIsConfigured,
    instagramPublishMock: instagramPublish,
    loadInstagramConnectorMock: vi.fn(),
    updateConnectionStatusMock: vi.fn(),
  };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ kind: "admin-test-client" }) }));
vi.mock("@/server/connectors/instagram", () => ({
  InstagramConnector: class {
    isConfigured = instagramIsConfiguredMock;
    publish = instagramPublishMock;
  },
}));
vi.mock("@/server/connectors/instagram/connect", () => ({ loadInstagramConnector: loadInstagramConnectorMock }));
vi.mock("@/server/connectors/integrations", () => ({
  getConnection: getConnectionMock,
  updateConnectionStatus: updateConnectionStatusMock,
}));

const { shortsAutomationHandler } = await import("./shorts");

beforeEach(() => {
  vi.resetAllMocks();
  renderShortVideoMock.mockResolvedValue("https://cdn.example.com/shorts/result.mp4");
  getConnectionMock.mockResolvedValue({ id: "conn-1", status: "CONNECTED" });
  loadInstagramConnectorMock.mockResolvedValue(instagramConnectorMock);
  instagramIsConfiguredMock.mockReturnValue(true);
  instagramPublishMock.mockResolvedValue({ externalId: "reel-media-1" });
});

const business: Business = {
  id: "biz-1",
  owner_id: "user-1",
  name: "우리동네 빵집",
  industry: "베이커리",
  description: "매일 아침 직접 굽는 동네 베이커리",
  location: "서울 마포구",
  target_customer: "출근길 직장인",
  brand_tone: "따뜻하고 친근한",
  keywords: ["소금빵", "아침빵"],
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
  name: "쇼츠 자동화",
  status: "ACTIVE",
  schedule: {},
  config: {},
  last_run_at: null,
  next_run_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
} as unknown as Automation;

const generatedContent = {
  hook: "출근 전에 갓 구운 소금빵, 놓치고 계신가요?",
  script: "바쁜 아침에는 빵을 고를 시간도 부족하죠. 매일 아침 갓 구운 소금빵을 미리 예약하면 기다리지 않고 바로 받을 수 있어요. 오늘 출근길 빵을 예약해보세요.",
  scenes: [
    { text: "출근 전 소금빵, 놓치고 계신가요?", visualPrompt: "갓 구운 소금빵 클로즈업, 세로 9:16, 따뜻한 아침 햇빛", durationSec: 3 },
    { text: "바쁜 아침엔 기다릴 시간도 없죠", visualPrompt: "시계를 확인하며 서두르는 직장인, 세로 9:16 미디엄 샷", durationSec: 4 },
    { text: "미리 예약하면 바로 픽업", visualPrompt: "포장된 빵을 건네는 직원의 손, 세로 9:16 클로즈업", durationSec: 5 },
    { text: "오늘 출근길 빵을 예약하세요", visualPrompt: "웃으며 빵 봉투를 들고 나가는 고객, 세로 9:16, 자연광", durationSec: 5 },
  ],
  caption: "출근길에도 갓 구운 소금빵을 빠르게 만나보세요. #소금빵 #마포빵집 #아침메뉴",
  privacy: "private" as const,
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

describe("shortsAutomationHandler", () => {
  it("only renders a preview (never posts) when no platform was explicitly configured", async () => {
    generateStructuredMock
      .mockResolvedValueOnce({ topic: "출근길 소금빵 예약 팁" })
      .mockResolvedValueOnce(generatedContent);

    const result = await shortsAutomationHandler.run(baseContext());

    expect(instagramPublishMock).not.toHaveBeenCalled();
    expect(result.output).toMatchObject({ videoUrl: "https://cdn.example.com/shorts/result.mp4", publicationResults: {} });
  });

  it("returns schema-shaped scenes and caption and persists Shorts metadata", async () => {
    generateStructuredMock
      .mockResolvedValueOnce({ topic: "출근길 소금빵 예약 팁" })
      .mockResolvedValueOnce(generatedContent);

    const result = await shortsAutomationHandler.run(baseContext({ config: { platforms: ["instagram"] } }));

    expect(generateStructuredMock).toHaveBeenCalledTimes(2);
    expect(result.output).toEqual({
      ...generatedContent,
      topic: "출근길 소금빵 예약 팁",
      videoUrl: "https://cdn.example.com/shorts/result.mp4",
      publicationResults: {
        instagram: { externalId: "reel-media-1", externalUrl: null, privacy: null },
      },
    });
    expect(result.output).toMatchObject({
      scenes: expect.arrayContaining([
        expect.objectContaining({ text: expect.any(String), visualPrompt: expect.any(String), durationSec: expect.any(Number) }),
      ]),
      caption: expect.stringContaining("#소금빵"),
      privacy: "private",
    });
    expect(result).toMatchObject({
      externalUrl: "https://cdn.example.com/shorts/result.mp4",
      title: generatedContent.hook,
      topic: "출근길 소금빵 예약 팁",
      content: generatedContent.script,
      contentType: "shorts",
    });
    expect(renderShortVideoMock).toHaveBeenCalledWith(generatedContent.scenes, generatedContent.script);
    expect(instagramPublishMock).toHaveBeenCalledWith({
      content: generatedContent.caption,
      mediaType: "REELS",
      videoUrl: "https://cdn.example.com/shorts/result.mp4",
    });
  });

  it("regenerates a near-duplicate topic exactly once before writing content", async () => {
    generateStructuredMock
      .mockResolvedValueOnce({ topic: "겨울철 난방비 절약 팁" })
      .mockResolvedValueOnce({ topic: "출근길 소금빵 예약 팁" })
      .mockResolvedValueOnce(generatedContent);

    const result = await shortsAutomationHandler.run(
      baseContext({ recentTopics: ["겨울철 난방비 절약하는 방법"] }),
    );

    expect(generateStructuredMock).toHaveBeenCalledTimes(3);
    expect(result.topic).toBe("출근길 소금빵 예약 팁");
    const retryRequest = generateStructuredMock.mock.calls[1][0] as { prompt: string };
    expect(retryRequest.prompt).toContain("겨울철 난방비 절약 팁");
  });

  it("does not regenerate a distinct topic", async () => {
    generateStructuredMock
      .mockResolvedValueOnce({ topic: "출근길 소금빵 예약 팁" })
      .mockResolvedValueOnce(generatedContent);

    await shortsAutomationHandler.run(baseContext({ recentTopics: ["여름 휴가지 추천"] }));

    expect(generateStructuredMock).toHaveBeenCalledTimes(2);
  });

  it("injects industry context and the Hook to Problem to Solution to CTA structure", async () => {
    generateStructuredMock
      .mockResolvedValueOnce({ topic: "출근길 소금빵 예약 팁" })
      .mockResolvedValueOnce(generatedContent);

    await shortsAutomationHandler.run(baseContext());

    const topicRequest = generateStructuredMock.mock.calls[0][0] as { system: string };
    const contentRequest = generateStructuredMock.mock.calls[1][0] as { system: string; prompt: string };
    expect(topicRequest.system).toContain("Industry: 베이커리");
    expect(contentRequest.system).toContain("Hook -> Problem -> Solution -> CTA");
    expect(contentRequest.prompt).toContain("15-45 seconds");
  });

  it("stops without returning partial content when generation fails", async () => {
    generateStructuredMock.mockResolvedValueOnce({ topic: "출근길 소금빵 예약 팁" }).mockRejectedValueOnce(new Error("generation failed"));

    await expect(shortsAutomationHandler.run(baseContext())).rejects.toThrow("generation failed");
    expect(renderShortVideoMock).not.toHaveBeenCalled();
    expect(instagramPublishMock).not.toHaveBeenCalled();
  });

  it("renders a preview without requiring or calling a publishing connector", async () => {
    generateStructuredMock
      .mockResolvedValueOnce({ topic: "출근길 소금빵 예약 팁" })
      .mockResolvedValueOnce(generatedContent);
    getConnectionMock.mockResolvedValue(null);
    instagramIsConfiguredMock.mockReturnValue(false);

    const result = await shortsAutomationHandler.run(baseContext({ shorts: { previewOnly: true } }));

    expect(result.output).toMatchObject({
      videoUrl: "https://cdn.example.com/shorts/result.mp4",
      publicationResults: {},
    });
    expect(instagramPublishMock).not.toHaveBeenCalled();
  });
});
