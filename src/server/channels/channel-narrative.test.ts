import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }));

vi.mock("@/server/ai/generate", () => ({ generateText: generateTextMock }));

const { buildChannelNarrative } = await import("./channel-narrative");

const BUSINESS = { name: "우리동네 빵집", industry: "베이커리" };

const DIAGNOSIS = {
  channel: "youtube" as const,
  overallScore: 73,
  activityScore: 40,
  consistencyScore: 100,
  contentScore: 70,
  metrics: { viewCount: 50000, videoCount: 10, subscriberCount: 1200, uploadsLast30Days: 0 },
  findings: ["최근 30일간 업로드가 없어요."],
  recommendations: [],
  dataSource: "mock" as const,
  collectedAt: "2026-10-10T12:00:00.000Z",
  completeness: "COMPLETE" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("buildChannelNarrative", () => {
  it("uses the AI narrative verbatim when every number it wrote is verifiable", async () => {
    generateTextMock.mockResolvedValue("구독자가 1200명이에요. 최근 30일간 업로드가 없어요.");

    const result = await buildChannelNarrative(DIAGNOSIS, BUSINESS);

    expect(result.aiUsed).toBe(true);
    expect(result.narrative).toBe("구독자가 1200명이에요. 최근 30일간 업로드가 없어요.");
  });

  it("strips only the sentence with a hallucinated number, keeping the rest of the AI narrative", async () => {
    generateTextMock.mockResolvedValue("구독자가 1200명이에요. 어제보다 500명 늘었어요.");

    const result = await buildChannelNarrative(DIAGNOSIS, BUSINESS);

    expect(result.aiUsed).toBe(true);
    expect(result.narrative).toBe("구독자가 1200명이에요.");
  });

  it("falls back to the deterministic rule-based summary when the AI call throws", async () => {
    generateTextMock.mockRejectedValue(new Error("provider down"));

    const result = await buildChannelNarrative(DIAGNOSIS, BUSINESS);

    expect(result.aiUsed).toBe(false);
    expect(result.narrative).toContain("73점");
    expect(result.narrative).toContain("최근 30일간 업로드가 없어요.");
  });

  it("falls back to the rule-based summary when every AI sentence gets stripped", async () => {
    generateTextMock.mockResolvedValue("구독자가 9999명이에요.");

    const result = await buildChannelNarrative(DIAGNOSIS, BUSINESS);

    expect(result.aiUsed).toBe(false);
    expect(result.narrative).toContain("73점");
  });

  it("never throws even when the AI step fails — the caller always gets a narrative", async () => {
    generateTextMock.mockRejectedValue(new Error("timeout"));
    await expect(buildChannelNarrative(DIAGNOSIS, BUSINESS)).resolves.toMatchObject({ aiUsed: false });
  });

  it("passes the date components (year/month/day) of collectedAt as allowed numbers", async () => {
    generateTextMock.mockResolvedValue("10월 10일 기준 자료예요.");
    const result = await buildChannelNarrative(DIAGNOSIS, BUSINESS);
    expect(result.aiUsed).toBe(true);
    expect(result.narrative).toBe("10월 10일 기준 자료예요.");
  });
});
