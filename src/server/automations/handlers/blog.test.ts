import { afterEach, describe, expect, it, vi } from "vitest";
import type { Automation, Business } from "@/types/domain";
import type { AutomationHandlerResult, AutomationRunContext } from "@/types/automation";

const { generateStructuredMock } = vi.hoisted(() => ({ generateStructuredMock: vi.fn() }));
vi.mock("@/server/ai/generate", () => ({ generateStructured: generateStructuredMock }));

const { publishMock, isConfiguredMock, WordPressConnectorMock } = vi.hoisted(() => {
  const publishMock = vi.fn();
  const isConfiguredMock = vi.fn();
  // A regular function (not an arrow function) so `new WordPressConnector()` works.
  const WordPressConnectorMock = vi.fn().mockImplementation(function () {
    return { publish: publishMock, isConfigured: isConfiguredMock };
  });
  return { publishMock, isConfiguredMock, WordPressConnectorMock };
});
vi.mock("@/server/connectors/wordpress", () => ({ WordPressConnector: WordPressConnectorMock }));
vi.mock("@/server/connectors/wordpress/credentials", () => ({
  decryptWordPressPassword: vi.fn().mockReturnValue("decrypted-app-password"),
}));
const { getConnectionMock, loadWordPressConnectorMock, updateConnectionStatusMock } = vi.hoisted(() => ({
  getConnectionMock: vi.fn(),
  loadWordPressConnectorMock: vi.fn(),
  updateConnectionStatusMock: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ kind: "admin" })) }));
vi.mock("@/server/connectors/integrations", () => ({ getConnection: getConnectionMock, updateConnectionStatus: updateConnectionStatusMock }));
vi.mock("@/server/connectors/wordpress/connect", () => ({ loadWordPressConnector: loadWordPressConnectorMock }));

const { blogAutomationHandler } = await import("./blog");
import { mockBlogOutline, mockBlogSection } from "@/server/ai/providers/mock-blog";

afterEach(() => {
  vi.resetAllMocks();
  getConnectionMock.mockResolvedValue(null);
  loadWordPressConnectorMock.mockResolvedValue(null);
  WordPressConnectorMock.mockImplementation(function () {
    return { publish: publishMock, isConfigured: isConfiguredMock };
  });
});

getConnectionMock.mockResolvedValue(null);

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
  name: "블로그 자동화",
  status: "ACTIVE",
  schedule: {},
  config: {},
  last_run_at: null,
  next_run_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
} as unknown as Automation;

type Request = { system: string; prompt: string; tier?: string; schema: { parse(value: unknown): unknown } };
type Deferred = { deferred: { state: Record<string, unknown>; progress?: string } };

const topicResult = { topic: "소금빵 맛있게 먹는 법", title: "소금빵 맛있게 먹는 법" };
const config = { objective: "신메뉴 홍보", keywords: ["소금빵", "성수동 빵집"], tone: "친근하게", deliveryMode: "app_draft" as const };

/** Answers every AI call like the mock provider does (topic, outline and sections), recording the requests. */
function useMockWriter(overrides: { section?: (request: Request, index: number) => unknown } = {}) {
  let sectionCalls = 0;
  generateStructuredMock.mockImplementation(async (request: Request) => {
    if (request.prompt.includes("AUTOBIZ_BLOG_OUTLINE_V1")) return request.schema.parse(JSON.parse(mockBlogOutline(request.prompt, request.system)));
    if (request.prompt.includes("AUTOBIZ_BLOG_SECTION_V1")) {
      const index = sectionCalls++;
      const custom = overrides.section?.(request, index);
      return request.schema.parse(custom ?? JSON.parse(mockBlogSection(request.prompt, request.system)));
    }
    return topicResult;
  });
}

function baseContext(overrides: Partial<AutomationRunContext> = {}): AutomationRunContext {
  return { automation, business, config: config as never, recentTopics: [], runId: "run-1", ...overrides };
}

/** Drives a deferred run to the end like the runner does (start, then resume until it returns a result). */
async function runToEnd(ctx: AutomationRunContext, onStep?: (outcome: Deferred) => void): Promise<AutomationHandlerResult> {
  let outcome = await blogAutomationHandler.run(ctx);
  for (let step = 0; step < 20; step++) {
    if (!("deferred" in outcome)) return outcome;
    onStep?.(outcome as unknown as Deferred);
    outcome = await blogAutomationHandler.resume!(ctx, outcome.deferred.state as never);
  }
  throw new Error("blog run did not finish");
}

describe("blogAutomationHandler", () => {
  it("plans the post, writes it section by section and returns markup, HTML and measured stats", async () => {
    useMockWriter();
    const progress: Array<string | undefined> = [];

    const result = await runToEnd(baseContext(), (step) => progress.push(step.deferred.progress));

    expect(progress[0]).toContain("0/8");
    expect(result.contentType).toBe("blog-marketing");
    expect(result.title).toContain("소금빵 맛있게 먹는 법");
    expect(result.content).toMatch(/^# /);
    expect(result.content).toContain("## 🥐");
    expect(result.content).toContain("[사진]");
    expect(result.content).toContain("[포인트] 💡 꿀팁");
    expect(result.output).toMatchObject({
      platform: "naver",
      stats: { chars: expect.any(Number), sections: 9, photos: expect.any(Number) },
      bodyHtml: expect.stringContaining("<h2"),
      callToAction: expect.any(String),
      published: false,
    });
    const stats = (result.output as { stats: { chars: number; photos: number } }).stats;
    expect(stats.chars).toBeGreaterThanOrEqual(1_500);
    expect(stats.photos).toBeGreaterThanOrEqual(4);
    expect(result.aiGenerationCount).toBe(2 + 8); // topic + outline, then intro, six sections and the closing
  });

  it("writes intro, each section and the closing in order, each seeing what came before", async () => {
    useMockWriter();
    await runToEnd(baseContext());

    const sectionRequests = generateStructuredMock.mock.calls.map((call) => call[0] as Request).filter((request) => request.prompt.includes("AUTOBIZ_BLOG_SECTION_V1"));
    expect(sectionRequests).toHaveLength(8);
    expect(sectionRequests[0].prompt).toContain("KIND=intro");
    expect(sectionRequests[7].prompt).toContain("KIND=closing");
    expect(sectionRequests[0].prompt).not.toContain("Already written");
    expect(sectionRequests[3].prompt).toContain("Already written");
    expect(sectionRequests.every((request) => request.tier === "quality")).toBe(true);
    const outlineRequest = generateStructuredMock.mock.calls.map((call) => call[0] as Request).find((request) => request.prompt.includes("AUTOBIZ_BLOG_OUTLINE_V1"));
    expect(outlineRequest?.tier).toBe("quality");
  });

  it("gives the writer the facts, the owner's notes, the platform style and the anti-AI rules", async () => {
    useMockWriter();
    await runToEnd(baseContext({ config: { ...config, platform: "tistory", notes: "시그니처는 저온 숙성 소금빵이에요" } as never }));

    const outlineRequest = generateStructuredMock.mock.calls.map((call) => call[0] as Request).find((request) => request.prompt.includes("AUTOBIZ_BLOG_OUTLINE_V1"))!;
    expect(outlineRequest.system).toContain("상호: 우리동네 빵집");
    expect(outlineRequest.system).toContain("위치: 서울 마포구");
    expect(outlineRequest.system).toContain("시그니처는 저온 숙성 소금빵이에요");
    expect(outlineRequest.system).toContain("Platform: Tistory");
    expect(outlineRequest.system).toContain("Never invent prices");
    expect(outlineRequest.system).toContain("결론적으로");
    expect(outlineRequest.system).toContain("==highlight==");
  });

  it("appends a business info box and hashtags that the app builds, not the AI", async () => {
    useMockWriter();
    const result = await runToEnd(baseContext({ business: { ...business, main_offering: "소금빵, 크루아상", website: "https://bakery.example.com" } }));

    expect(result.content).toContain("## 📌 우리동네 빵집 정보");
    expect(result.content).toContain("[정보] 📍 위치 | 서울 마포구");
    expect(result.content).toContain("[정보] 🛍️ 대표 메뉴·서비스 | 소금빵, 크루아상");
    expect(result.content).toMatch(/#소금빵 #성수동빵집/);
    expect(result.content?.trim().split("\n").at(-1)).toMatch(/^#\S+/);
  });

  it("drops info boxes and dividers the AI tries to add itself", async () => {
    useMockWriter({
      section: (request, index) => {
        const base = JSON.parse(mockBlogSection(request.prompt, request.system)) as { blocks: unknown[] };
        return index === 1 ? { blocks: [...base.blocks, { type: "info", rows: [{ label: "전화", value: "02-000-0000" }] }, { type: "divider" }] } : base;
      },
    });
    const result = await runToEnd(baseContext());
    expect(result.content).not.toContain("02-000-0000");
    expect(result.content).not.toMatch(/^---$/m);
  });

  it("rewrites only the sections that fail the quality check, once, with the problems and the old text", async () => {
    useMockWriter({
      section: (request, index) => {
        if (index === 2) {
          // third section written: a stock phrase, an unprovable claim and an invented price
          return { blocks: [{ type: "paragraph", text: "결론적으로 저희는 최고의 빵집이고 소금빵은 3,500원입니다 🙂" }, { type: "paragraph", text: "소금빵은 **겉바속촉**이에요 ✨" }] };
        }
        return undefined;
      },
    });

    const result = await runToEnd(baseContext());

    const requests = generateStructuredMock.mock.calls.map((call) => call[0] as Request);
    const sectionRequests = requests.filter((request) => request.prompt.includes("AUTOBIZ_BLOG_SECTION_V1"));
    expect(sectionRequests.length).toBeGreaterThan(8);
    expect(sectionRequests.length).toBeLessThanOrEqual(8 + 4); // at most four rewrites
    const rewrite = sectionRequests.slice(8).find((request) => request.prompt.includes("It had these problems"))!;
    expect(rewrite.prompt).toContain("INDEX=1"); // body section 1 = post section 2
    expect(rewrite.prompt).toContain("결론적으로");
    expect(rewrite.prompt).toContain("3,500원");
    expect(rewrite.prompt).toContain("The previous version of this section");
    expect(result.content).not.toContain("3,500원");
    expect(result.content).not.toContain("결론적으로");
  });

  it("keeps the original section when a rewrite fails, and still finishes", async () => {
    let rewriting = false;
    useMockWriter({
      section: (request, index) => {
        if (request.prompt.includes("It had these problems")) {
          rewriting = true;
          throw new Error("AI unavailable");
        }
        return index === 1 ? { blocks: [{ type: "paragraph", text: "결론적으로 좋아요" }] } : undefined;
      },
    });

    const result = await runToEnd(baseContext());

    expect(rewriting).toBe(true);
    expect(result.content).toContain("결론적으로 좋아요");
    expect(result.output).toMatchObject({ qualityNotes: expect.any(Array) });
  });

  it("spreads the writing over several short steps instead of one long request", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-11T00:00:00.000Z"));
      useMockWriter();
      const base = generateStructuredMock.getMockImplementation()!;
      generateStructuredMock.mockImplementation(async (request: Request) => {
        vi.setSystemTime(new Date(Date.now() + 15_000)); // each AI call "takes" 15 s
        return base(request);
      });

      const steps: number[] = [];
      await runToEnd(baseContext(), (step) => steps.push(((step.deferred.state as { sections: unknown[] }).sections ?? []).length));

      // start (0 written), then three sections per 40 s step; the third step writes the last two and finishes
      expect(steps).toEqual([0, 3, 6]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up on a run that has been going too long", async () => {
    useMockWriter();
    const started = (await blogAutomationHandler.run(baseContext())) as unknown as Deferred;
    const stale = { ...started.deferred.state, startedAt: new Date(Date.now() - 26 * 60_000).toISOString() };
    await expect(blogAutomationHandler.resume!(baseContext(), stale as never)).rejects.toThrow("너무 오래");
  });

  it("regenerates the topic exactly once when the first pick is a near-duplicate, then accepts the second", async () => {
    useMockWriter();
    const base = generateStructuredMock.getMockImplementation()!;
    const topics = [{ topic: "겨울철 난방비 절약 팁", title: "첫 제목" }, { topic: "출근길 소금빵 예약 팁", title: "둘째 제목" }];
    generateStructuredMock.mockImplementation(async (request: Request) => (request.prompt.includes("Pick one specific blog topic") ? topics.shift() : base(request)));

    const started = (await blogAutomationHandler.run(baseContext({ recentTopics: ["겨울철 난방비 절약하는 방법"] }))) as unknown as Deferred;

    expect(started.deferred.state.topic).toBe("출근길 소금빵 예약 팁");
    const retry = generateStructuredMock.mock.calls.map((call) => call[0] as Request).filter((request) => request.prompt.includes("Pick one specific blog topic"))[1];
    expect(retry.prompt).toContain("겨울철 난방비 절약 팁");
  });

  it("does not regenerate when the first topic is already distinct from recent history", async () => {
    useMockWriter();
    await blogAutomationHandler.run(baseContext({ recentTopics: ["여름 휴가지 추천"] }));
    const picks = generateStructuredMock.mock.calls.map((call) => call[0] as Request).filter((request) => request.prompt.includes("Pick one specific blog topic"));
    expect(picks).toHaveLength(1);
  });

  it("keeps a calendar topic fixed and injects its goal, brief and CTA into every stage", async () => {
    useMockWriter();
    const calendarItem = {
      id: "calendar-1",
      businessId: "biz-1",
      plannedDate: "2026-10-01",
      platform: "blog" as const,
      contentType: "정보성 블로그 글",
      topic: "직장인을 위한 아침 소금빵 활용법",
      goal: "평일 오전 방문 늘리기",
      summary: "출근 전 5분 안에 고르는 법과 예약 픽업 방법을 소개한다",
      cta: "출근길 예약하기",
    };

    const result = await runToEnd(baseContext({ calendarItem }));

    expect(result.topic).toBe(calendarItem.topic);
    const requests = generateStructuredMock.mock.calls.map((call) => call[0] as Request);
    const title = requests[0];
    expect(title.prompt).toContain(calendarItem.topic);
    expect(title.system).toContain(calendarItem.goal);
    expect(title.system).toContain(calendarItem.summary);
    for (const request of requests.slice(1)) {
      expect(request.system).toContain(calendarItem.goal);
      expect(request.system).toContain(calendarItem.summary);
      expect(request.system).toContain(calendarItem.cta);
    }
  });

  describe("delivery", () => {
    const wordpress = { ...config, deliveryMode: "wordpress_publish" as const, wordpress: { siteUrl: "https://blog.example.com", username: "admin", encryptedAppPassword: "enc" } };

    it("publishes to WordPress with the generated HTML and excerpt once the post is finished", async () => {
      useMockWriter();
      publishMock.mockResolvedValueOnce({ externalUrl: "https://blog.example.com/post-1", externalId: "1" });

      const result = await runToEnd(baseContext({ config: wordpress as never }));

      expect(publishMock).toHaveBeenCalledTimes(1);
      const [post, status] = publishMock.mock.calls[0] as [{ title: string; content: string; excerpt: string }, string];
      expect(status).toBe("publish");
      expect(post.title).toBe(result.title);
      expect(post.content).toContain("<h2");
      expect(post.content).not.toMatch(/<script|<iframe/i);
      expect(post.excerpt.length).toBeGreaterThan(10);
      expect(result.externalUrl).toBe("https://blog.example.com/post-1");
      expect(result.output).toMatchObject({ published: true, wordpressStatus: "publish" });
    });

    it("prefers the business-level Settings connection when one exists", async () => {
      useMockWriter();
      getConnectionMock.mockResolvedValue({ id: "shared", status: "CONNECTED" });
      loadWordPressConnectorMock.mockResolvedValueOnce({ publish: publishMock });
      publishMock.mockResolvedValueOnce({ externalUrl: "https://shared.example.com/post-1" });

      const result = await runToEnd(baseContext({ config: { ...config, deliveryMode: "wordpress_publish" } as never }));

      expect(loadWordPressConnectorMock).toHaveBeenCalled();
      expect(WordPressConnectorMock).not.toHaveBeenCalled();
      expect(result.externalUrl).toBe("https://shared.example.com/post-1");
    });

    it("marks a shared connection EXPIRED when WordPress rejects its credentials", async () => {
      const { ConnectorError } = await import("@/server/shared/errors");
      useMockWriter();
      getConnectionMock.mockResolvedValue({ id: "shared", status: "CONNECTED" });
      loadWordPressConnectorMock.mockResolvedValueOnce({ publish: publishMock });
      publishMock.mockRejectedValueOnce(new ConnectorError("wordpress", "AUTH_FAILED", "authentication rejected"));

      await expect(runToEnd(baseContext({ config: { ...config, deliveryMode: "wordpress_publish" } as never }))).rejects.toThrow("authentication rejected");
      expect(updateConnectionStatusMock).toHaveBeenCalledWith(expect.anything(), "shared", "EXPIRED");
    });

    it("falls back to the legacy env-configured WordPress connector when there is no setup-wizard config", async () => {
      useMockWriter();
      isConfiguredMock.mockReturnValue(true);
      publishMock.mockResolvedValueOnce({ externalUrl: "https://legacy.example.com/post-1", externalId: "1" });

      const result = await runToEnd(baseContext({ config: {} as never }));

      expect(publishMock).toHaveBeenCalledTimes(1);
      expect(result.externalUrl).toBe("https://legacy.example.com/post-1");
      expect(result.output).toMatchObject({ published: true, wordpressStatus: "publish" });
    });

    it("skips WordPress entirely when there is no config and the legacy connector isn't configured", async () => {
      useMockWriter();
      isConfiguredMock.mockReturnValue(false);

      const result = await runToEnd(baseContext({ config: {} as never }));

      expect(publishMock).not.toHaveBeenCalled();
      expect(result.output).toMatchObject({ published: false, wordpressStatus: null, externalUrl: null });
    });

    it("never calls WordPress for an explicit app_draft config — generation-only going forward", async () => {
      useMockWriter();
      const result = await runToEnd(baseContext());
      expect(publishMock).not.toHaveBeenCalled();
      expect(isConfiguredMock).not.toHaveBeenCalled();
      expect(result.output).toMatchObject({ published: false, wordpressStatus: null, externalUrl: null });
    });
  });

  it("throws instead of returning a partial result when a stage fails", async () => {
    generateStructuredMock.mockRejectedValue(new Error("topic failed"));
    await expect(blogAutomationHandler.run(baseContext())).rejects.toThrow("topic failed");

    useMockWriter();
    const base = generateStructuredMock.getMockImplementation()!;
    generateStructuredMock.mockImplementation(async (request: Request) => {
      if (request.prompt.includes("AUTOBIZ_BLOG_OUTLINE_V1")) throw new Error("outline failed");
      return base(request);
    });
    await expect(blogAutomationHandler.run(baseContext())).rejects.toThrow("outline failed");

    useMockWriter({ section: (_request, index) => { if (index === 2) throw new Error("section failed"); return undefined; } });
    await expect(runToEnd(baseContext())).rejects.toThrow("section failed");
  });
});
