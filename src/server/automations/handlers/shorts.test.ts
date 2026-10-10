import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Automation, Business } from "@/types/domain";
import type { AutomationHandlerResult, AutomationRunContext } from "@/types/automation";

const { generateStructuredMock } = vi.hoisted(() => ({ generateStructuredMock: vi.fn() }));
vi.mock("@/server/ai/generate", () => ({ generateStructured: generateStructuredMock }));
const { renderShortVideoMock, startMovieRenderMock, getMovieRenderStatusMock } = vi.hoisted(() => ({
  renderShortVideoMock: vi.fn(),
  startMovieRenderMock: vi.fn(),
  getMovieRenderStatusMock: vi.fn(),
}));
vi.mock("@/server/connectors/video", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/connectors/video")>()),
  renderShortVideo: renderShortVideoMock,
  startMovieRender: startMovieRenderMock,
  getMovieRenderStatus: getMovieRenderStatusMock,
}));
const { animationProviderMock, isAnimationAvailableMock, canUseAnimatedShortsMock, prepareFrameMock } = vi.hoisted(() => ({
  animationProviderMock: { name: "mock", startClip: vi.fn(), getClip: vi.fn() },
  isAnimationAvailableMock: vi.fn(),
  canUseAnimatedShortsMock: vi.fn(),
  prepareFrameMock: vi.fn(),
}));
vi.mock("@/server/connectors/animation", () => ({
  getAnimationProvider: () => animationProviderMock,
  isAnimationAvailable: isAnimationAvailableMock,
}));
vi.mock("@/server/billing/entitlements", () => ({ canUseAnimatedShorts: canUseAnimatedShortsMock }));
vi.mock("@/server/shorts/character-frame", () => ({ prepareCharacterFrame: prepareFrameMock }));
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
const { resolveReferenceImageUrlsMock, loadReferenceBytesMock, signStoragePathMock, uploadReferenceImageMock, deleteReferenceImagesMock } = vi.hoisted(() => ({
  resolveReferenceImageUrlsMock: vi.fn(),
  loadReferenceBytesMock: vi.fn(),
  signStoragePathMock: vi.fn(),
  uploadReferenceImageMock: vi.fn(),
  deleteReferenceImagesMock: vi.fn(),
}));
vi.mock("@/server/shorts/reference-images", () => ({
  resolveReferenceImageUrls: resolveReferenceImageUrlsMock,
  loadReferenceBytes: loadReferenceBytesMock,
  signStoragePath: signStoragePathMock,
  uploadReferenceImage: uploadReferenceImageMock,
  deleteReferenceImages: deleteReferenceImagesMock,
}));
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

const { shortsAutomationHandler: handler } = await import("./shorts");

/** The classic (colour card) flow always finishes in one request. */
const shortsAutomationHandler = {
  run: async (ctx: AutomationRunContext) => (await handler.run(ctx)) as AutomationHandlerResult,
};

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

  describe("with reference images", () => {
    const characterPlan = {
      format: "character" as const,
      hook: "사장님, 큰일 났어요!",
      scenes: [
        { text: "사장님, 큰일 났어요!", speaker: "partner" as const, imageIndex: 2, action: "The character panics.", motion: "shake" as const, durationSec: 2, visualPrompt: "v" },
        { text: "무슨 일이에요?", speaker: "main" as const, imageIndex: 1, action: "The character waves.", motion: "pop" as const, durationSec: 3, visualPrompt: "v" },
        { text: "마케팅할 시간이 없어요", speaker: "partner" as const, imageIndex: 3, action: "The character listens.", motion: "wobble" as const, durationSec: 5, visualPrompt: "v" },
        { text: "걱정 마세요, 제가 해드려요!", speaker: "main" as const, imageIndex: 8, action: "The character gives a thumbs up.", motion: "bounce" as const, durationSec: 6, visualPrompt: "v" },
        { text: "지금 바로 시작해요!", speaker: "main" as const, imageIndex: 1, action: "The character points forward.", motion: "zoom" as const, durationSec: 5, visualPrompt: "v" },
      ],
      caption: "마케팅이 어려운 사장님을 위해 #이지마케팅 #소상공인 #숏폼",
      privacy: "private" as const,
    };
    const showcasePlan = {
      format: "showcase" as const,
      hook: "여기 한번 보세요!",
      scenes: [
        { text: "여기 한번 보세요!", caption: "여기 한번 보세요!", imageIndex: 3, motion: "zoom-in" as const, durationSec: 3, visualPrompt: "v" },
        { text: "정성껏 준비한 매장이에요", caption: "정성껏 준비한 매장", imageIndex: 3, motion: "pan-left" as const, durationSec: 5, visualPrompt: "v" },
        { text: "직접 구운 빵을 만나보세요", caption: "직접 구운 빵", imageIndex: 4, motion: "zoom-out" as const, durationSec: 5, visualPrompt: "v" },
        { text: "오늘 바로 들러 보세요", caption: "오늘 들러 보세요", imageIndex: 1, motion: "pan-right" as const, durationSec: 5, visualPrompt: "v" },
      ],
      caption: "동네 빵집 소개 #동네빵집 #소금빵 #숏폼",
      privacy: "private" as const,
    };
    // Images 1-2 are characters, 3-4 are photos.
    const references = [
      { id: "m-wave", kind: "mascot", source: "wave", label: "인사", subject: "character" },
      { id: "m-point", kind: "mascot", source: "point", label: "아이디어", subject: "character" },
      { id: "u-shop", kind: "upload", source: "user-1/auto-1/shop.png", label: "매장 전경", subject: "place" },
      { id: "u-bread", kind: "upload", source: "user-1/auto-1/bread.png", label: "소금빵", subject: "product" },
    ];
    const configWith = (extra: Record<string, unknown> = {}) => ({ references, shortsStyle: "auto", shortsBrief: "이지 마케팅을 소개해줘", ...extra }) as never;
    const imageUrls = ["https://img.example.com/wave.png", "https://img.example.com/point.png", "https://img.example.com/shop.png", "https://img.example.com/bread.png"];
    const handle = (id: string) => ({ requestId: id, statusUrl: `https://queue.fal.run/m/requests/${id}/status`, responseUrl: `https://queue.fal.run/m/requests/${id}` });
    type Deferred = { deferred: { state: Record<string, unknown>; progress?: string } };

    beforeEach(() => {
      resolveReferenceImageUrlsMock.mockResolvedValue(imageUrls);
      loadReferenceBytesMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
      prepareFrameMock.mockResolvedValue(Buffer.from("frame"));
      signStoragePathMock.mockImplementation(async (_admin: unknown, path: string) => `https://signed.example.com/${path}`);
      uploadReferenceImageMock.mockResolvedValue(undefined);
      deleteReferenceImagesMock.mockResolvedValue(undefined);
      isAnimationAvailableMock.mockReturnValue(true);
      canUseAnimatedShortsMock.mockResolvedValue({ allowed: true });
      let clip = 0;
      animationProviderMock.startClip.mockImplementation(async () => handle(`clip-${++clip}`));
      animationProviderMock.getClip.mockImplementation(async (h: { requestId: string }) => ({ state: "done", videoUrl: `https://v3.fal.media/${h.requestId}.mp4` }));
      startMovieRenderMock.mockResolvedValue("project-1");
    });

    it("starts animated clips for the character scenes and defers the run", async () => {
      generateStructuredMock.mockResolvedValueOnce({ topic: "마케팅 대신 해주는 로봇" }).mockResolvedValueOnce(characterPlan);

      const outcome = (await handler.run(baseContext({ config: configWith(), shorts: { previewOnly: true } }))) as unknown as Deferred;

      const planRequest = generateStructuredMock.mock.calls[1][0] as { prompt: string; schema: { safeParse(value: unknown): { success: boolean } } };
      expect(planRequest.prompt).toContain("1. [character] 이지 마케팅 마스코트 로봇");
      expect(planRequest.prompt).toContain("3. [place] 매장 전경");
      expect(planRequest.schema.safeParse(characterPlan).success).toBe(true);
      expect(planRequest.schema.safeParse(showcasePlan).success).toBe(true); // auto allows both

      expect(prepareFrameMock).toHaveBeenCalledTimes(5);
      expect(uploadReferenceImageMock).toHaveBeenCalledTimes(5);
      expect(animationProviderMock.startClip).toHaveBeenCalledTimes(5);
      const firstClip = animationProviderMock.startClip.mock.calls[0][0] as { imageUrl: string; prompt: string };
      expect(firstClip.imageUrl).toMatch(/^https:\/\/signed\.example\.com\/user-1\/auto-1\/frames\/run-1-0\.png$/);
      expect(firstClip.prompt).toContain("The character panics.");
      expect(outcome.deferred.state).toMatchObject({ stage: "ANIMATING", format: "character", animationMode: "video" });
      expect(outcome.deferred.progress).toContain("0/5");
      // image numbers outside the character group fall back to the first character image
      expect((outcome.deferred.state.scenes as Array<{ referenceIndex: number }>).map((scene) => scene.referenceIndex)).toEqual([1, 0, 0, 0, 0]);
      expect(JSON.stringify(outcome.deferred.state)).not.toContain("signed.example.com");
    });

    it("waits while clips are pending, then renders the movie from the finished clips", async () => {
      generateStructuredMock.mockResolvedValueOnce({ topic: "t" }).mockResolvedValueOnce(characterPlan);
      const started = (await handler.run(baseContext({ config: configWith(), shorts: { previewOnly: true } }))) as unknown as Deferred;

      let calls = 0;
      animationProviderMock.getClip.mockImplementation(async (h: { requestId: string }) =>
        (++calls <= 3 ? { state: "pending" } : { state: "done", videoUrl: `https://v3.fal.media/${h.requestId}.mp4` }));
      const waiting = (await handler.resume!(baseContext(), started.deferred.state as never)) as unknown as Deferred;
      expect(waiting.deferred.progress).toContain("2/5");
      expect(startMovieRenderMock).not.toHaveBeenCalled();

      const composing = (await handler.resume!(baseContext(), waiting.deferred.state as never)) as unknown as Deferred;
      expect(composing.deferred.state).toMatchObject({ stage: "COMPOSING", projectId: "project-1" });
      const movie = startMovieRenderMock.mock.calls[0][0] as { scenes: Array<{ elements: Array<{ type: string; src?: string }> }> };
      expect(movie.scenes).toHaveLength(5);
      expect(movie.scenes[0].elements.map((element) => element.type)).toEqual(["voice", "video", "text"]);
      expect(movie.scenes.every((scene) => scene.elements[1].src?.startsWith("https://v3.fal.media/"))).toBe(true);
    });

    it("finishes with the video URL, cleans up the frames and records the animation mode", async () => {
      generateStructuredMock.mockResolvedValueOnce({ topic: "마케팅 대신 해주는 로봇" }).mockResolvedValueOnce(characterPlan);
      const started = (await handler.run(baseContext({ config: configWith(), shorts: { previewOnly: true } }))) as unknown as Deferred;
      const composing = (await handler.resume!(baseContext(), started.deferred.state as never)) as unknown as Deferred;

      getMovieRenderStatusMock.mockResolvedValueOnce({ state: "pending" });
      const still = (await handler.resume!(baseContext(), composing.deferred.state as never)) as unknown as Deferred;
      expect(still.deferred.progress).toContain("합치는 중");

      getMovieRenderStatusMock.mockResolvedValueOnce({ state: "done", videoUrl: "https://cdn.example.com/skit.mp4" });
      const done = (await handler.resume!(baseContext(), still.deferred.state as never)) as AutomationHandlerResult;

      expect(done.output).toMatchObject({
        videoUrl: "https://cdn.example.com/skit.mp4",
        format: "character",
        animationMode: "video",
        hook: "사장님, 큰일 났어요!",
        topic: "마케팅 대신 해주는 로봇",
        publicationResults: {},
      });
      expect(done.content).toBe(characterPlan.scenes.map((scene) => scene.text).join(" "));
      expect(done.externalUrl).toBe("https://cdn.example.com/skit.mp4");
      expect(deleteReferenceImagesMock).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining([expect.stringContaining("frames/run-1-0.png")]));
      expect(JSON.stringify(done.output)).not.toContain("signed.example.com");
    });

    it("retries a failed clip once and fails the run when it fails again", async () => {
      generateStructuredMock.mockResolvedValueOnce({ topic: "t" }).mockResolvedValueOnce(characterPlan);
      const started = (await handler.run(baseContext({ config: configWith(), shorts: { previewOnly: true } }))) as unknown as Deferred;

      animationProviderMock.getClip.mockResolvedValueOnce({ state: "failed", message: "policy" }).mockResolvedValue({ state: "pending" });
      const retried = (await handler.resume!(baseContext(), started.deferred.state as never)) as unknown as Deferred;
      expect(animationProviderMock.startClip).toHaveBeenCalledTimes(6);
      expect((retried.deferred.state.clips as Array<{ attempts: number }>)[0].attempts).toBe(2);

      animationProviderMock.getClip.mockResolvedValueOnce({ state: "failed", message: "policy again" });
      await expect(handler.resume!(baseContext(), retried.deferred.state as never)).rejects.toThrow("policy again");
    });

    it("gives up on a run that has been going too long", async () => {
      generateStructuredMock.mockResolvedValueOnce({ topic: "t" }).mockResolvedValueOnce(characterPlan);
      const started = (await handler.run(baseContext({ config: configWith(), shorts: { previewOnly: true } }))) as unknown as Deferred;
      const stale = { ...started.deferred.state, startedAt: new Date(Date.now() - 31 * 60_000).toISOString() };
      await expect(handler.resume!(baseContext(), stale as never)).rejects.toThrow("너무 오래");
    });

    it("falls back to the simple motion effect, with a note, when the monthly animation allowance is used up", async () => {
      canUseAnimatedShortsMock.mockResolvedValue({ allowed: false, reason: "스타터 요금제의 이번 달 움직이는 캐릭터 영상 한도(2건)를 모두 썼어요." });
      generateStructuredMock.mockResolvedValueOnce({ topic: "t" }).mockResolvedValueOnce(characterPlan);

      const outcome = (await handler.run(baseContext({ config: configWith(), shorts: { previewOnly: true } }))) as unknown as Deferred;

      expect(animationProviderMock.startClip).not.toHaveBeenCalled();
      expect(outcome.deferred.state).toMatchObject({ stage: "COMPOSING", animationMode: "tween" });
      expect(String(outcome.deferred.state.animationNote)).toContain("한도");
      const movie = startMovieRenderMock.mock.calls[0][0] as { scenes: Array<{ elements: Array<{ type: string; src?: string }> }> };
      expect(movie.scenes[0].elements.map((element) => element.type)).toEqual(["voice", "image", "text"]);
    });

    it("falls back to the simple motion effect when the animation service is not configured", async () => {
      isAnimationAvailableMock.mockReturnValue(false);
      generateStructuredMock.mockResolvedValueOnce({ topic: "t" }).mockResolvedValueOnce(characterPlan);

      const outcome = (await handler.run(baseContext({ config: configWith(), shorts: { previewOnly: true } }))) as unknown as Deferred;

      expect(canUseAnimatedShortsMock).not.toHaveBeenCalled();
      expect(outcome.deferred.state).toMatchObject({ animationMode: "tween" });
      expect(String(outcome.deferred.state.animationNote)).toContain("연결되지 않아");
    });

    it("makes a photo showcase from the non-character images without any animation", async () => {
      generateStructuredMock.mockResolvedValueOnce({ topic: "동네 빵집" }).mockResolvedValueOnce(showcasePlan);

      const outcome = (await handler.run(baseContext({ config: configWith({ shortsStyle: "showcase", shortsBrief: "매장 소개" }), shorts: { previewOnly: true } }))) as unknown as Deferred;

      const planRequest = generateStructuredMock.mock.calls[1][0] as { prompt: string; schema: { safeParse(value: unknown): { success: boolean } } };
      expect(planRequest.prompt).toContain('Use format "showcase".');
      expect(planRequest.schema.safeParse(characterPlan).success).toBe(false);
      expect(animationProviderMock.startClip).not.toHaveBeenCalled();
      expect(outcome.deferred.state).toMatchObject({ stage: "COMPOSING", format: "showcase", animationMode: "photos", projectId: "project-1" });
      const movie = startMovieRenderMock.mock.calls[0][0] as { scenes: Array<{ elements: Array<{ type: string; src?: string; text?: string }> }> };
      const images = movie.scenes.map((scene) => scene.elements.find((element) => element.type === "image")?.src);
      // imageIndex 3,3,4 stay; 1 (a character) falls back to the first photo (image 3)
      expect(images).toEqual([imageUrls[2], imageUrls[2], imageUrls[3], imageUrls[2]]);
      expect(movie.scenes[0].elements.some((element) => element.type === "text" && element.text === "우리동네 빵집")).toBe(true);

      getMovieRenderStatusMock.mockResolvedValueOnce({ state: "done", videoUrl: "https://cdn.example.com/showcase.mp4" });
      const done = (await handler.resume!(baseContext(), outcome.deferred.state as never)) as AutomationHandlerResult;
      expect(done.output).toMatchObject({ format: "showcase", animationMode: "photos", videoUrl: "https://cdn.example.com/showcase.mp4" });
    });

    it("surfaces a failed render so the run is marked failed", async () => {
      generateStructuredMock.mockResolvedValueOnce({ topic: "t" }).mockResolvedValueOnce(showcasePlan);
      const outcome = (await handler.run(baseContext({ config: configWith({ shortsStyle: "showcase" }), shorts: { previewOnly: true } }))) as unknown as Deferred;
      getMovieRenderStatusMock.mockResolvedValueOnce({ state: "failed", message: "JSON2Video 렌더링에 실패했습니다: bad asset" });
      await expect(handler.resume!(baseContext(), outcome.deferred.state as never)).rejects.toThrow("bad asset");
    });

    it("only offers the format the images allow when the style cannot be satisfied", async () => {
      generateStructuredMock.mockResolvedValueOnce({ topic: "t" }).mockResolvedValueOnce(showcasePlan);
      const photosOnly = references.filter((reference) => reference.subject !== "character");
      await handler.run(baseContext({ config: configWith({ references: photosOnly, shortsStyle: "skit" }), shorts: { previewOnly: true } }));
      const planRequest = generateStructuredMock.mock.calls[1][0] as { prompt: string };
      expect(planRequest.prompt).toContain('Use format "showcase".');
    });

    it("keeps a calendar-fixed topic and skips topic generation", async () => {
      generateStructuredMock.mockResolvedValueOnce(characterPlan);
      await handler.run(baseContext({
        config: configWith(),
        calendarItem: {
          id: "cal-1", businessId: "biz-1", plannedDate: "2026-10-12", platform: "YOUTUBE_SHORTS", contentType: "shorts",
          topic: "신메뉴 소개", goal: "신규 방문", summary: "신메뉴를 소개", cta: "예약하기",
        } as never,
      }));
      expect(generateStructuredMock).toHaveBeenCalledTimes(1);
      expect((generateStructuredMock.mock.calls[0][0] as { prompt: string }).prompt).toContain("신메뉴 소개");
    });

    it("uses the classic scene flow when no reference image is configured", async () => {
      generateStructuredMock
        .mockResolvedValueOnce({ topic: "출근길 소금빵 예약 팁" })
        .mockResolvedValueOnce(generatedContent);

      await shortsAutomationHandler.run(baseContext({ config: { references: [] } as never }));

      expect(resolveReferenceImageUrlsMock).not.toHaveBeenCalled();
      expect(startMovieRenderMock).not.toHaveBeenCalled();
      const [renderedScenes] = renderShortVideoMock.mock.calls[0] as [Array<Record<string, unknown>>];
      expect(renderedScenes.every((scene) => scene.imageUrl === undefined)).toBe(true);
    });
  });
});
