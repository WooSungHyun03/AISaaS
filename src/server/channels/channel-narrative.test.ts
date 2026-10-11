import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }));

vi.mock("@/server/ai/generate", () => ({ generateText: generateTextMock }));
// In-memory stand-in for Next's data cache, keyed by the stringified arguments like the real one.
const cacheStore = new Map<string, unknown>();
vi.mock("next/cache", () => ({
  unstable_cache:
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>, keyParts: string[]) =>
    async (...args: A): Promise<R> => {
      const key = JSON.stringify([keyParts, args]);
      if (cacheStore.has(key)) return cacheStore.get(key) as R;
      const value = await fn(...args);
      cacheStore.set(key, value);
      return value;
    },
}));

const { buildChannelNarrative, getChannelNarrative } = await import("./channel-narrative");

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
  cacheStore.clear();
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

describe("getChannelNarrative", () => {
  it("calls the AI once per diagnosis, not on every page load", async () => {
    generateTextMock.mockResolvedValue("구독자가 1200명이에요.");

    const first = await getChannelNarrative(DIAGNOSIS, BUSINESS);
    const second = await getChannelNarrative(DIAGNOSIS, BUSINESS);

    expect(first).toEqual({ narrative: "구독자가 1200명이에요.", aiUsed: true });
    expect(second).toEqual(first);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it("generates a fresh narrative for a newer diagnosis", async () => {
    generateTextMock.mockResolvedValue("구독자가 1200명이에요.");

    await getChannelNarrative(DIAGNOSIS, BUSINESS);
    await getChannelNarrative({ ...DIAGNOSIS, collectedAt: "2026-10-11T12:00:00.000Z" }, BUSINESS);

    expect(generateTextMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache the rule-based fallback, so the next load retries the AI", async () => {
    generateTextMock.mockRejectedValueOnce(new Error("provider down")).mockResolvedValueOnce("구독자가 1200명이에요.");

    const fallback = await getChannelNarrative(DIAGNOSIS, BUSINESS);
    const retried = await getChannelNarrative(DIAGNOSIS, BUSINESS);

    expect(fallback.aiUsed).toBe(false);
    expect(retried).toEqual({ narrative: "구독자가 1200명이에요.", aiUsed: true });
  });
});
