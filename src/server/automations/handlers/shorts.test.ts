import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Automation, Business } from "@/types/domain";
import type { AutomationHandlerResult, AutomationRunContext } from "@/types/automation";

const { generateStructuredMock } = vi.hoisted(() => ({ generateStructuredMock: vi.fn() }));
vi.mock("@/server/ai/generate", () => ({ generateStructured: generateStructuredMock }));
const { startMovieRenderMock, getMovieRenderStatusMock } = vi.hoisted(() => ({
  startMovieRenderMock: vi.fn(),
  getMovieRenderStatusMock: vi.fn(),
}));
vi.mock("@/server/connectors/video", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/connectors/video")>()),
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

beforeEach(() => {
  vi.resetAllMocks();
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
  const plan = {
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
  const references = [
    { id: "m-wave", kind: "mascot", source: "wave", label: "인사" },
    { id: "m-point", kind: "mascot", source: "point", label: "아이디어" },
    { id: "u-cat", kind: "upload", source: "user-1/auto-1/cat.png", label: "놀란 고양이" },
  ];
  const configWith = (extra: Record<string, unknown> = {}) => ({ references, shortsStyle: "skit", shortsBrief: "이지 마케팅을 소개해줘", ...extra }) as never;
  const imageUrls = ["https://img.example.com/wave.png", "https://img.example.com/point.png", "https://img.example.com/cat.png"];
  const handle = (id: string) => ({ requestId: id, statusUrl: `https://queue.fal.run/m/requests/${id}/status`, responseUrl: `https://queue.fal.run/m/requests/${id}` });
  type Deferred = { deferred: { state: Record<string, unknown>; progress?: string } };
  const start = async (ctx: Partial<AutomationRunContext> = {}) =>
    (await handler.run(baseContext({ config: configWith(), shorts: { previewOnly: true }, ...ctx }))) as unknown as Deferred;
  const resume = async (state: unknown) => (await handler.resume!(baseContext(), state as never)) as unknown as Deferred;

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

  it("needs a character image: without one it stops before any AI call", async () => {
    await expect(handler.run(baseContext({ config: { references: [] } as never }))).rejects.toThrow("캐릭터 이미지를 먼저 추가");
    await expect(handler.run(baseContext())).rejects.toThrow("캐릭터 이미지를 먼저 추가");
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it("plans the skit from the character images and starts one animated clip per scene", async () => {
    generateStructuredMock.mockResolvedValueOnce({ topic: "마케팅 대신 해주는 로봇" }).mockResolvedValueOnce(plan);

    const outcome = await start();

    const topicRequest = generateStructuredMock.mock.calls[0][0] as { prompt: string; system: string };
    const planRequest = generateStructuredMock.mock.calls[1][0] as { prompt: string; system: string };
    expect(topicRequest.system).toContain("Industry: 베이커리");
    expect(topicRequest.prompt).toContain("이지 마케팅을 소개해줘");
    expect(planRequest.system).toContain("Hook -> Problem -> Solution -> CTA");
    expect(planRequest.prompt).toContain("1. 이지 마케팅 마스코트 로봇");
    expect(planRequest.prompt).toContain("3. 놀란 고양이");

    expect(prepareFrameMock).toHaveBeenCalledTimes(5);
    expect(uploadReferenceImageMock).toHaveBeenCalledTimes(5);
    expect(animationProviderMock.startClip).toHaveBeenCalledTimes(5);
    const firstClip = animationProviderMock.startClip.mock.calls[0][0] as { imageUrl: string; prompt: string };
    expect(firstClip.imageUrl).toBe("https://signed.example.com/user-1/auto-1/frames/run-1-0.png");
    expect(firstClip.prompt).toContain("The character panics.");
    expect(outcome.deferred.state).toMatchObject({ stage: "ANIMATING", animationMode: "video" });
    expect(outcome.deferred.progress).toContain("0/5");
    // imageIndex 8 does not exist in a 3-image list -> falls back to the first image
    expect((outcome.deferred.state.scenes as Array<{ referenceIndex: number }>).map((scene) => scene.referenceIndex)).toEqual([1, 0, 2, 0, 0]);
    expect(JSON.stringify(outcome.deferred.state)).not.toContain("signed.example.com");
  });

  it("waits while clips are pending, then renders the movie from the finished clips", async () => {
    generateStructuredMock.mockResolvedValueOnce({ topic: "t" }).mockResolvedValueOnce(plan);
    const started = await start();

    let calls = 0;
    animationProviderMock.getClip.mockImplementation(async (h: { requestId: string }) =>
      (++calls <= 3 ? { state: "pending" } : { state: "done", videoUrl: `https://v3.fal.media/${h.requestId}.mp4` }));
    const waiting = await resume(started.deferred.state);
    expect(waiting.deferred.progress).toContain("2/5");
    expect(startMovieRenderMock).not.toHaveBeenCalled();

    const composing = await resume(waiting.deferred.state);
    expect(composing.deferred.state).toMatchObject({ stage: "COMPOSING", projectId: "project-1" });
    const movie = startMovieRenderMock.mock.calls[0][0] as { scenes: Array<{ elements: Array<{ type: string; src?: string }> }> };
    expect(movie.scenes).toHaveLength(5);
    expect(movie.scenes[0].elements.map((element) => element.type)).toEqual(["voice", "video", "text"]);
    expect(movie.scenes.every((scene) => scene.elements[1].src?.startsWith("https://v3.fal.media/"))).toBe(true);
  });

  it("finishes with the video URL, cleans up the frames and records the animation mode", async () => {
    generateStructuredMock.mockResolvedValueOnce({ topic: "마케팅 대신 해주는 로봇" }).mockResolvedValueOnce(plan);
    const composing = await resume((await start()).deferred.state);

    getMovieRenderStatusMock.mockResolvedValueOnce({ state: "pending" });
    const still = await resume(composing.deferred.state);
    expect(still.deferred.progress).toContain("합치는 중");

    getMovieRenderStatusMock.mockResolvedValueOnce({ state: "done", videoUrl: "https://cdn.example.com/skit.mp4" });
    const done = (await handler.resume!(baseContext(), still.deferred.state as never)) as AutomationHandlerResult;

    expect(done.output).toMatchObject({
      videoUrl: "https://cdn.example.com/skit.mp4",
      animationMode: "video",
      hook: "사장님, 큰일 났어요!",
      topic: "마케팅 대신 해주는 로봇",
      publicationResults: {},
    });
    expect(done.content).toBe(plan.scenes.map((scene) => scene.text).join(" "));
    expect(done).toMatchObject({ externalUrl: "https://cdn.example.com/skit.mp4", title: plan.hook, contentType: "shorts" });
    expect(deleteReferenceImagesMock).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining([expect.stringContaining("frames/run-1-0.png")]));
    expect(JSON.stringify(done.output)).not.toContain("signed.example.com");
    expect(instagramPublishMock).not.toHaveBeenCalled();
  });

  it("publishes to the configured platform only for non-preview runs", async () => {
    generateStructuredMock.mockResolvedValueOnce({ topic: "t" }).mockResolvedValueOnce(plan);
    const started = (await handler.run(baseContext({ config: configWith({ platforms: ["instagram"] }) }))) as unknown as Deferred;
    expect(started.deferred.state).toMatchObject({ platforms: ["instagram"], previewOnly: false });
    const composing = await resume(started.deferred.state);
    getMovieRenderStatusMock.mockResolvedValueOnce({ state: "done", videoUrl: "https://cdn.example.com/skit.mp4" });

    const done = (await handler.resume!(baseContext(), composing.deferred.state as never)) as AutomationHandlerResult;

    expect(instagramPublishMock).toHaveBeenCalledWith({ content: plan.caption, mediaType: "REELS", videoUrl: "https://cdn.example.com/skit.mp4" });
    expect(done.output).toMatchObject({ publicationResults: { instagram: { externalId: "reel-media-1" } } });
  });

  it("retries a failed clip once and fails the run when it fails again", async () => {
    generateStructuredMock.mockResolvedValueOnce({ topic: "t" }).mockResolvedValueOnce(plan);
    const started = await start();

    animationProviderMock.getClip.mockResolvedValueOnce({ state: "failed", message: "policy" }).mockResolvedValue({ state: "pending" });
    const retried = await resume(started.deferred.state);
    expect(animationProviderMock.startClip).toHaveBeenCalledTimes(6);
    expect((retried.deferred.state.clips as Array<{ attempts: number }>)[0].attempts).toBe(2);

    animationProviderMock.getClip.mockResolvedValueOnce({ state: "failed", message: "policy again" });
    await expect(resume(retried.deferred.state)).rejects.toThrow("policy again");
  });

  it("gives up on a run that has been going too long", async () => {
    generateStructuredMock.mockResolvedValueOnce({ topic: "t" }).mockResolvedValueOnce(plan);
    const started = await start();
    const stale = { ...started.deferred.state, startedAt: new Date(Date.now() - 31 * 60_000).toISOString() };
    await expect(resume(stale)).rejects.toThrow("너무 오래");
  });

  it("falls back to the simple motion effect, with a note, when the monthly animation allowance is used up", async () => {
    canUseAnimatedShortsMock.mockResolvedValue({ allowed: false, reason: "스타터 요금제의 이번 달 움직이는 캐릭터 영상 한도(2건)를 모두 썼어요." });
    generateStructuredMock.mockResolvedValueOnce({ topic: "t" }).mockResolvedValueOnce(plan);

    const outcome = await start();

    expect(animationProviderMock.startClip).not.toHaveBeenCalled();
    expect(outcome.deferred.state).toMatchObject({ stage: "COMPOSING", animationMode: "tween" });
    expect(String(outcome.deferred.state.animationNote)).toContain("한도");
    const movie = startMovieRenderMock.mock.calls[0][0] as { scenes: Array<{ elements: Array<{ type: string; src?: string }> }> };
    expect(movie.scenes[0].elements.map((element) => element.type)).toEqual(["voice", "image", "text"]);
    expect(movie.scenes[0].elements[1].src).toBe(imageUrls[1]);
  });

  it("falls back to the simple motion effect when the animation service is not configured", async () => {
    isAnimationAvailableMock.mockReturnValue(false);
    generateStructuredMock.mockResolvedValueOnce({ topic: "t" }).mockResolvedValueOnce(plan);

    const outcome = await start();

    expect(canUseAnimatedShortsMock).not.toHaveBeenCalled();
    expect(outcome.deferred.state).toMatchObject({ animationMode: "tween" });
    expect(String(outcome.deferred.state.animationNote)).toContain("연결되지 않아");

    getMovieRenderStatusMock.mockResolvedValueOnce({ state: "done", videoUrl: "https://cdn.example.com/tween.mp4" });
    const done = (await handler.resume!(baseContext(), outcome.deferred.state as never)) as AutomationHandlerResult;
    expect(done.output).toMatchObject({ animationMode: "tween", animationNote: expect.stringContaining("연결되지 않아") });
  });

  it("surfaces a failed render so the run is marked failed", async () => {
    isAnimationAvailableMock.mockReturnValue(false);
    generateStructuredMock.mockResolvedValueOnce({ topic: "t" }).mockResolvedValueOnce(plan);
    const outcome = await start();
    getMovieRenderStatusMock.mockResolvedValueOnce({ state: "failed", message: "JSON2Video 렌더링에 실패했습니다: bad asset" });
    await expect(resume(outcome.deferred.state)).rejects.toThrow("bad asset");
  });

  it("stops without starting any clip when planning fails", async () => {
    generateStructuredMock.mockResolvedValueOnce({ topic: "t" }).mockRejectedValueOnce(new Error("generation failed"));
    await expect(start()).rejects.toThrow("generation failed");
    expect(animationProviderMock.startClip).not.toHaveBeenCalled();
    expect(startMovieRenderMock).not.toHaveBeenCalled();
  });

  it("keeps a calendar-fixed topic and skips topic generation", async () => {
    generateStructuredMock.mockResolvedValueOnce(plan);
    await start({
      calendarItem: {
        id: "cal-1", businessId: "biz-1", plannedDate: "2026-10-12", platform: "YOUTUBE_SHORTS", contentType: "shorts",
        topic: "신메뉴 소개", goal: "신규 방문", summary: "신메뉴를 소개", cta: "예약하기",
      } as never,
    });
    expect(generateStructuredMock).toHaveBeenCalledTimes(1);
    const request = generateStructuredMock.mock.calls[0][0] as { prompt: string };
    expect(request.prompt).toContain("신메뉴 소개");
    expect(request.prompt).toContain("신규 방문");
  });

  it("regenerates a near-duplicate topic exactly once, and leaves a distinct topic alone", async () => {
    generateStructuredMock
      .mockResolvedValueOnce({ topic: "겨울철 난방비 절약 팁" })
      .mockResolvedValueOnce({ topic: "출근길 소금빵 예약 팁" })
      .mockResolvedValueOnce(plan);
    const outcome = await start({ recentTopics: ["겨울철 난방비 절약하는 방법"] });
    expect(generateStructuredMock).toHaveBeenCalledTimes(3);
    expect(outcome.deferred.state).toMatchObject({ topic: "출근길 소금빵 예약 팁" });
    expect((generateStructuredMock.mock.calls[1][0] as { prompt: string }).prompt).toContain("겨울철 난방비 절약 팁");

    generateStructuredMock.mockReset();
    generateStructuredMock.mockResolvedValueOnce({ topic: "출근길 소금빵 예약 팁" }).mockResolvedValueOnce(plan);
    await start({ recentTopics: ["여름 휴가지 추천"] });
    expect(generateStructuredMock).toHaveBeenCalledTimes(2);
  });
});
