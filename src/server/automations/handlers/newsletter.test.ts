import { afterEach, describe, expect, it, vi } from "vitest";
import type { Automation, Business } from "@/types/domain";
import type { AutomationRunContext } from "@/types/automation";

const { generateStructuredMock } = vi.hoisted(() => ({ generateStructuredMock: vi.fn() }));
vi.mock("@/server/ai/generate", () => ({ generateStructured: generateStructuredMock }));

const { sendMock, isConfiguredMock, ResendConnectorMock, listActiveSubscribersMock } = vi.hoisted(() => {
  const sendMock = vi.fn();
  const isConfiguredMock = vi.fn().mockReturnValue(true);
  const ResendConnectorMock = vi.fn().mockImplementation(function () {
    return { send: sendMock, isConfigured: isConfiguredMock };
  });
  const listActiveSubscribersMock = vi.fn();
  return { sendMock, isConfiguredMock, ResendConnectorMock, listActiveSubscribersMock };
});
vi.mock("@/server/connectors/email", () => ({
  ResendConnector: ResendConnectorMock,
  listActiveSubscribers: listActiveSubscribersMock,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ kind: "admin" })) }));

const { newsletterAutomationHandler } = await import("./newsletter");

afterEach(() => {
  vi.resetAllMocks();
  isConfiguredMock.mockReturnValue(true);
  ResendConnectorMock.mockImplementation(function () {
    return { send: sendMock, isConfigured: isConfiguredMock };
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
  name: "뉴스레터 자동화",
  status: "ACTIVE",
  schedule: {},
  config: {},
  last_run_at: null,
  next_run_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
} as unknown as Automation;

const content = {
  subject: "겨울 한정 소금빵 소식",
  previewText: "겨울 한정 소금빵을 소개합니다.",
  htmlBody: "<p>겨울 한정 소금빵이 새로 나왔습니다.</p><p>지금 바로 매장에서 만나보세요.</p>",
};

const subscribers = [
  { id: "sub-1", email: "a@example.com", name: "가나다" },
  { id: "sub-2", email: "b@example.com", name: null },
];

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

describe("newsletterAutomationHandler", () => {
  it("sends only to ACTIVE subscribers and records per-run success counts/message ids", async () => {
    listActiveSubscribersMock.mockResolvedValue(subscribers);
    generateStructuredMock.mockResolvedValueOnce(content);
    sendMock.mockResolvedValueOnce({ messageId: "msg-1" }).mockResolvedValueOnce({ messageId: "msg-2" });

    const result = await newsletterAutomationHandler.run(baseContext());

    expect(listActiveSubscribersMock).toHaveBeenCalledWith({ kind: "admin" }, "biz-1");
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(result.title).toBe(content.subject);
    expect(result.content).toBe("겨울 한정 소금빵이 새로 나왔습니다. 지금 바로 매장에서 만나보세요.");
    expect(result.output).toMatchObject({
      subject: content.subject,
      previewText: content.previewText,
      totalSubscribers: 2,
      successCount: 2,
      failureCount: 0,
      messageIds: ["msg-1", "msg-2"],
      failures: [],
    });
  });

  it("derives a stable per-run, per-subscriber idempotency key from automation_runs.id", async () => {
    listActiveSubscribersMock.mockResolvedValue(subscribers);
    generateStructuredMock.mockResolvedValueOnce(content);
    sendMock.mockResolvedValue({ messageId: "msg" });

    await newsletterAutomationHandler.run(baseContext({ runId: "run-42" }));

    expect(sendMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ idempotencyKey: "run-42:sub-1" }));
    expect(sendMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ idempotencyKey: "run-42:sub-2" }));
  });

  it("produces the identical idempotency keys on a re-triggered run of the same run id (never double-sends via a different key)", async () => {
    listActiveSubscribersMock.mockResolvedValue(subscribers);
    generateStructuredMock.mockResolvedValue(content);
    sendMock.mockResolvedValue({ messageId: "msg" });

    await newsletterAutomationHandler.run(baseContext({ runId: "run-7" }));
    const firstKeys = sendMock.mock.calls.map((call) => call[0].idempotencyKey);
    sendMock.mockClear();

    await newsletterAutomationHandler.run(baseContext({ runId: "run-7" }));
    const secondKeys = sendMock.mock.calls.map((call) => call[0].idempotencyKey);

    expect(secondKeys).toEqual(firstKeys);
  });

  it("continues past a per-recipient send failure (partial failure) and records it without failing the whole run", async () => {
    listActiveSubscribersMock.mockResolvedValue(subscribers);
    generateStructuredMock.mockResolvedValueOnce(content);
    const { ConnectorError } = await import("@/server/shared/errors");
    sendMock
      .mockRejectedValueOnce(new ConnectorError("email", "UPSTREAM_CLIENT_ERROR", "invalid recipient"))
      .mockResolvedValueOnce({ messageId: "msg-2" });

    const result = await newsletterAutomationHandler.run(baseContext());

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(result.output).toMatchObject({
      successCount: 1,
      failureCount: 1,
      messageIds: ["msg-2"],
    });
    expect((result.output as { failures: { subscriberId: string }[] }).failures).toEqual([
      { subscriberId: "sub-1", email: "a@example.com", error: "invalid recipient" },
    ]);
  });

  it("aborts the run on a systemic provider failure (auth) instead of failing every remaining recipient individually", async () => {
    listActiveSubscribersMock.mockResolvedValue(subscribers);
    generateStructuredMock.mockResolvedValueOnce(content);
    const { ConnectorError } = await import("@/server/shared/errors");
    sendMock.mockRejectedValueOnce(new ConnectorError("email", "AUTH_FAILED", "authentication rejected"));

    await expect(newsletterAutomationHandler.run(baseContext())).rejects.toThrow("authentication rejected");
    // Never attempts the second subscriber once the failure is systemic.
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("throws before generating or sending anything when the email connector isn't configured", async () => {
    isConfiguredMock.mockReturnValue(false);

    await expect(newsletterAutomationHandler.run(baseContext())).rejects.toThrow(/RESEND_API_KEY/);

    expect(listActiveSubscribersMock).not.toHaveBeenCalled();
    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("still generates content and succeeds with zero counts when there are no active subscribers", async () => {
    listActiveSubscribersMock.mockResolvedValue([]);
    generateStructuredMock.mockResolvedValueOnce(content);

    const result = await newsletterAutomationHandler.run(baseContext());

    expect(sendMock).not.toHaveBeenCalled();
    expect(result.output).toMatchObject({ totalSubscribers: 0, successCount: 0, failureCount: 0, messageIds: [], failures: [] });
  });

  it("regenerates the subject exactly once when the first pick is a near-duplicate, then accepts the second", async () => {
    listActiveSubscribersMock.mockResolvedValue([]);
    generateStructuredMock
      .mockResolvedValueOnce({ ...content, subject: "겨울철 난방비 절약 팁" }) // near-dup of recent
      .mockResolvedValueOnce(content); // accepted regardless of its own similarity

    const result = await newsletterAutomationHandler.run(baseContext({ recentTopics: ["겨울철 난방비 절약하는 방법"] }));

    expect(generateStructuredMock).toHaveBeenCalledTimes(2);
    expect(result.title).toBe(content.subject);
  });

  it("does not regenerate when the first subject is already distinct from recent history", async () => {
    listActiveSubscribersMock.mockResolvedValue([]);
    generateStructuredMock.mockResolvedValueOnce(content);

    await newsletterAutomationHandler.run(baseContext({ recentTopics: ["여름 휴가철 여행지 추천"] }));

    expect(generateStructuredMock).toHaveBeenCalledTimes(1);
  });

  it("throws instead of returning a partial result when content generation fails", async () => {
    listActiveSubscribersMock.mockResolvedValue(subscribers);
    generateStructuredMock.mockRejectedValueOnce(new Error("AI provider unavailable"));

    await expect(newsletterAutomationHandler.run(baseContext())).rejects.toThrow("AI provider unavailable");
    expect(sendMock).not.toHaveBeenCalled();
  });
});
