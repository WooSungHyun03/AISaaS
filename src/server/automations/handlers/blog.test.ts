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

const { blogAutomationHandler } = await import("./blog");

afterEach(() => {
  vi.resetAllMocks();
  WordPressConnectorMock.mockImplementation(function () {
    return { publish: publishMock, isConfigured: isConfiguredMock };
  });
});

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

const topicResult = { topic: "겨울철 소금빵 신메뉴 소개", title: "겨울 한정 소금빵이 왔어요" };
const bodyResult = {
  excerpt: "겨울 한정 소금빵을 소개합니다.",
  bodyHtml: "<p>겨울 한정 소금빵이 새로 나왔습니다.</p><p>지금 바로 매장에서 만나보세요.</p>",
  keywords: ["소금빵", "겨울한정"],
  callToAction: "지금 매장을 방문해보세요!",
};

function baseContext(overrides: Partial<AutomationRunContext> = {}): AutomationRunContext {
  return {
    automation,
    business,
    config: {},
    recentTopics: [],
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
    expect(result.content).toBe("겨울 한정 소금빵이 새로 나왔습니다. 지금 바로 매장에서 만나보세요.");
    expect(result.output).toMatchObject({
      ...topicResult,
      ...bodyResult,
      published: false,
      wordpressStatus: null,
      externalUrl: null,
    });
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
