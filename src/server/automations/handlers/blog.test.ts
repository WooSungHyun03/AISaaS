import { afterEach, describe, expect, it, vi } from "vitest";
import type { Automation, Business } from "@/types/domain";
import type { AutomationRunContext } from "@/types/automation";

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

const PARAGRAPHS = [
  "겨울에만 파는 한정 소금빵이 이번 주부터 진열대에 올라왔습니다. 평소 쓰는 반죽에 게랑드 소금을 조금 더 넣어 짠맛을 또렷하게 살렸습니다. 한입 베어 물면 겉은 바삭하고 속은 쫀득해서 식어도 맛이 크게 변하지 않습니다.",
  "첫 판은 오전 7시에 나옵니다. 출근 전에 들르는 손님이 많아서 한 번에 열두 개씩만 굽고, 오후에는 품절되는 날도 있습니다. 갓 나온 빵을 드시고 싶다면 오전 시간대를 추천드립니다.",
  "함께 드실 커피는 산미가 약한 중배전 원두를 권합니다. 빵의 단맛과 소금의 짠맛이 커피 쓴맛에 눌리지 않아서 아침 식사로 잘 어울립니다. 따뜻한 음료와 함께 드시면 겨울 아침이 한결 든든해집니다.",
  "저녁에 드시고 싶다면 점심 전에 전화로 수량을 말씀해 주세요. 포장 상자는 따로 요청하지 않으셔도 기본으로 드립니다. 마포구 매장에서 기다리고 있겠습니다.",
];
const GOOD_BODY_HTML = PARAGRAPHS.map((paragraph) => `<p>${paragraph}</p>`).join("\n");

const topicResult = { topic: "겨울철 소금빵 신메뉴 소개", title: "겨울 한정 소금빵이 왔어요" };
const bodyResult = {
  hook: "겨울에만 만날 수 있는 소금빵이 궁금하지 않으세요?",
  excerpt: "겨울 한정 소금빵을 소개합니다.",
  bodyHtml: GOOD_BODY_HTML,
  keywords: ["소금빵", "겨울한정"],
  seoKeywords: ["겨울 소금빵", "마포 베이커리"],
  callToAction: "지금 매장을 방문해보세요!",
  imageSuggestion: "도입부 직후: 겨울 한정 소금빵 클로즈업 사진",
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

describe("blogAutomationHandler", () => {
  it("runs the two-stage pipeline and returns the unified content shape", async () => {
    generateStructuredMock.mockResolvedValueOnce(topicResult).mockResolvedValueOnce(bodyResult);

    const result = await blogAutomationHandler.run(baseContext());

    expect(generateStructuredMock).toHaveBeenCalledTimes(2);
    expect(result.title).toBe(topicResult.title);
    expect(result.topic).toBe(topicResult.topic);
    // content_history gets a plain-text rendering, not raw HTML.
    expect(result.content).toBe(PARAGRAPHS.join("\n\n"));
    expect(result.output).toMatchObject({
      ...topicResult,
      ...bodyResult,
      published: false,
      wordpressStatus: null,
      externalUrl: null,
    });
  });

  it("rewrites once with concrete fixes when the first draft is too short or full of stock phrases, and keeps the better draft", async () => {
    const weakDraft = { ...bodyResult, bodyHtml: "<p>안녕하세요, 오늘은 소금빵을 알아보겠습니다!</p>" };
    generateStructuredMock
      .mockResolvedValueOnce(topicResult)
      .mockResolvedValueOnce(weakDraft)
      .mockResolvedValueOnce(bodyResult);

    const result = await blogAutomationHandler.run(baseContext());

    expect(generateStructuredMock).toHaveBeenCalledTimes(3); // topic + draft + exactly one rewrite
    const rewriteRequest = generateStructuredMock.mock.calls[2][0] as { prompt: string };
    expect(rewriteRequest.prompt).toContain("너무 짧아요");
    expect(rewriteRequest.prompt).toContain("상투적인 표현");
    expect(result.content).toBe(PARAGRAPHS.join("\n\n"));
    expect(result.aiGenerationCount).toBe(2);
  });

  it("never loops: if the rewrite is no better the original is kept and no third body is requested", async () => {
    const weak = { ...bodyResult, bodyHtml: "<p>짧은 글.</p>" };
    generateStructuredMock.mockResolvedValueOnce(topicResult).mockResolvedValueOnce(weak).mockResolvedValueOnce({ ...weak, hook: "다시 쓴 훅" });

    const result = await blogAutomationHandler.run(baseContext());

    expect(generateStructuredMock).toHaveBeenCalledTimes(3);
    expect(result.content).toBe("짧은 글.");
  });

  it("stores only escaped <p> paragraphs even if the model returns scripts, iframes or links", async () => {
    const hostile = { ...bodyResult, bodyHtml: `${GOOD_BODY_HTML}<script>alert(1)</script><iframe src="https://evil.example"></iframe><p onclick="x()">끝<a href="javascript:alert(1)">링크</a></p>` };
    generateStructuredMock.mockResolvedValueOnce(topicResult).mockResolvedValueOnce(hostile);

    const result = await blogAutomationHandler.run(baseContext());

    const stored = (result.output as { bodyHtml: string }).bodyHtml;
    expect(stored).not.toMatch(/script|iframe|onclick|javascript:|href/i);
    expect(stored.startsWith("<p>")).toBe(true);
  });

  it("gives the writer the marketing profile, factual-grounding rules and anti-AI style rules", async () => {
    generateStructuredMock.mockResolvedValueOnce(topicResult).mockResolvedValueOnce(bodyResult);

    await blogAutomationHandler.run(baseContext({ business: { ...business, main_offering: "소금빵과 크루아상", strengths: "직접 로스팅", marketing_goal: "평일 아침 방문" } }));

    const bodyRequest = generateStructuredMock.mock.calls[1][0] as { system: string; prompt: string };
    expect(bodyRequest.system).toContain("소금빵과 크루아상");
    expect(bodyRequest.system).toContain("직접 로스팅");
    expect(bodyRequest.system).toContain("평일 아침 방문");
    expect(bodyRequest.system).toMatch(/Never invent prices/);
    expect(bodyRequest.system).toContain("안녕하세요, 오늘은");
  });

  it("regenerates the topic exactly once when the first pick is a near-duplicate, then accepts the second", async () => {
    generateStructuredMock
      .mockResolvedValueOnce({ topic: "겨울철 난방비 절약 팁", title: "난방비 아끼는 법" }) // near-dup of recent
      .mockResolvedValueOnce(topicResult) // accepted regardless of its own similarity
      .mockResolvedValueOnce(bodyResult);

    const result = await blogAutomationHandler.run(
      baseContext({ recentTopics: ["겨울철 난방비 절약하는 방법"] }),
    );

    expect(generateStructuredMock).toHaveBeenCalledTimes(3);
    expect(result.topic).toBe(topicResult.topic);
  });

  it("does not regenerate when the first topic is already distinct from recent history", async () => {
    generateStructuredMock.mockResolvedValueOnce(topicResult).mockResolvedValueOnce(bodyResult);

    await blogAutomationHandler.run(baseContext({ recentTopics: ["여름 휴가철 여행지 추천"] }));

    expect(generateStructuredMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a calendar topic fixed and injects its goal and CTA into generation", async () => {
    generateStructuredMock
      .mockResolvedValueOnce({ topic: "모델이 바꾸려 한 주제", title: "계획 주제에 맞춘 제목" })
      .mockResolvedValueOnce(bodyResult);
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

    const result = await blogAutomationHandler.run(baseContext({ calendarItem }));

    expect(result.topic).toBe(calendarItem.topic);
    expect(generateStructuredMock).toHaveBeenCalledTimes(2);
    const titleRequest = generateStructuredMock.mock.calls[0][0] as { prompt: string; system: string };
    const bodyRequest = generateStructuredMock.mock.calls[1][0] as { prompt: string; system: string };
    expect(titleRequest.prompt).toContain(calendarItem.topic);
    expect(titleRequest.system).toContain(calendarItem.goal);
    expect(bodyRequest.system).toContain(calendarItem.goal);
    expect(bodyRequest.system).toContain(calendarItem.cta);
    // The calendar's content brief must actually reach the writer, not just goal/CTA.
    expect(titleRequest.system).toContain(calendarItem.summary);
    expect(bodyRequest.system).toContain(calendarItem.summary);
  });

  it("publishes to WordPress with the generated excerpt/bodyHtml when configured for it", async () => {
    generateStructuredMock.mockResolvedValueOnce(topicResult).mockResolvedValueOnce(bodyResult);
    publishMock.mockResolvedValueOnce({ externalUrl: "https://blog.example.com/post-1", externalId: "1" });

    const result = await blogAutomationHandler.run(
      baseContext({
        config: {
          objective: "신메뉴 홍보",
          keywords: ["소금빵"],
          tone: "친근하게",
          deliveryMode: "wordpress_publish",
          wordpress: { siteUrl: "https://blog.example.com", username: "admin", encryptedAppPassword: "enc" },
        },
      }),
    );

    expect(publishMock).toHaveBeenCalledWith(
      { title: topicResult.title, content: bodyResult.bodyHtml, excerpt: bodyResult.excerpt },
      "publish",
    );
    expect(result.externalUrl).toBe("https://blog.example.com/post-1");
    expect(result.output).toMatchObject({ published: true, wordpressStatus: "publish" });
  });

  it("prefers the business-level Settings connection when one exists", async () => {
    generateStructuredMock.mockResolvedValueOnce(topicResult).mockResolvedValueOnce(bodyResult);
    getConnectionMock.mockResolvedValueOnce({ id: "shared", status: "CONNECTED" });
    loadWordPressConnectorMock.mockResolvedValueOnce({ publish: publishMock });
    publishMock.mockResolvedValueOnce({ externalUrl: "https://shared.example.com/post-1" });

    const result = await blogAutomationHandler.run(baseContext({
      config: { objective: "신메뉴 홍보", keywords: ["소금빵"], tone: "친근하게", deliveryMode: "wordpress_publish" },
    }));

    expect(loadWordPressConnectorMock).toHaveBeenCalled();
    expect(WordPressConnectorMock).not.toHaveBeenCalled();
    expect(result.externalUrl).toBe("https://shared.example.com/post-1");
  });

  it("marks a shared connection EXPIRED when WordPress rejects its credentials", async () => {
    const { ConnectorError } = await import("@/server/shared/errors");
    generateStructuredMock.mockResolvedValueOnce(topicResult).mockResolvedValueOnce(bodyResult);
    getConnectionMock.mockResolvedValueOnce({ id: "shared", status: "CONNECTED" });
    loadWordPressConnectorMock.mockResolvedValueOnce({ publish: publishMock });
    publishMock.mockRejectedValueOnce(new ConnectorError("wordpress", "AUTH_FAILED", "authentication rejected"));

    await expect(blogAutomationHandler.run(baseContext({
      config: { objective: "신메뉴 홍보", keywords: ["소금빵"], tone: "친근하게", deliveryMode: "wordpress_publish" },
    }))).rejects.toThrow("authentication rejected");
    expect(updateConnectionStatusMock).toHaveBeenCalledWith(expect.anything(), "shared", "EXPIRED");
  });

  it("falls back to the legacy env-configured WordPress connector when there is no setup-wizard config", async () => {
    generateStructuredMock.mockResolvedValueOnce(topicResult).mockResolvedValueOnce(bodyResult);
    isConfiguredMock.mockReturnValueOnce(true);
    publishMock.mockResolvedValueOnce({ externalUrl: "https://legacy.example.com/post-1", externalId: "1" });

    const result = await blogAutomationHandler.run(baseContext());

    expect(isConfiguredMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith({ title: topicResult.title, content: bodyResult.bodyHtml, excerpt: bodyResult.excerpt });
    expect(result.externalUrl).toBe("https://legacy.example.com/post-1");
    expect(result.output).toMatchObject({ published: true, wordpressStatus: "publish" });
  });

  it("skips WordPress entirely when there is no config and the legacy connector isn't configured", async () => {
    generateStructuredMock.mockResolvedValueOnce(topicResult).mockResolvedValueOnce(bodyResult);
    isConfiguredMock.mockReturnValueOnce(false);

    const result = await blogAutomationHandler.run(baseContext());

    expect(publishMock).not.toHaveBeenCalled();
    expect(result.externalUrl).toBeUndefined();
    expect(result.output).toMatchObject({ published: false, wordpressStatus: null, externalUrl: null });
  });

  it("never calls WordPress for an explicit app_draft config — generation-only going forward", async () => {
    generateStructuredMock.mockResolvedValueOnce(topicResult).mockResolvedValueOnce(bodyResult);

    const result = await blogAutomationHandler.run(
      baseContext({
        config: { objective: "신메뉴 홍보", keywords: ["소금빵"], tone: "친근하게", deliveryMode: "app_draft" },
      }),
    );

    expect(publishMock).not.toHaveBeenCalled();
    expect(isConfiguredMock).not.toHaveBeenCalled();
    expect(result.content).toBeTruthy();
    expect(result.output).toMatchObject({ published: false, wordpressStatus: null, externalUrl: null });
  });

  it("includes the new hook/seoKeywords/imageSuggestion fields in the saved output", async () => {
    generateStructuredMock.mockResolvedValueOnce(topicResult).mockResolvedValueOnce(bodyResult);

    const result = await blogAutomationHandler.run(
      baseContext({ config: { objective: "신메뉴 홍보", keywords: ["소금빵"], tone: "친근하게", deliveryMode: "app_draft" } }),
    );

    expect(result.output).toMatchObject({
      hook: bodyResult.hook,
      seoKeywords: bodyResult.seoKeywords,
      imageSuggestion: bodyResult.imageSuggestion,
    });
  });

  it("throws instead of returning a partial result when the topic stage fails", async () => {
    generateStructuredMock.mockRejectedValueOnce(new Error("AI provider unavailable"));

    await expect(blogAutomationHandler.run(baseContext())).rejects.toThrow("AI provider unavailable");
    expect(generateStructuredMock).toHaveBeenCalledTimes(1);
  });

  it("throws instead of returning a partial result when the body stage fails", async () => {
    generateStructuredMock.mockResolvedValueOnce(topicResult).mockRejectedValueOnce(new Error("body generation failed"));

    await expect(blogAutomationHandler.run(baseContext())).rejects.toThrow("body generation failed");
  });
});
