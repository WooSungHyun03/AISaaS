import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, generateTextMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  generateTextMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/server/ai/generate", () => ({ generateText: generateTextMock }));

const { buildGrowthNarrative, getOrCreateGrowthNarrative } = await import("./growth-narrative");

const BUSINESS = { name: "우리동네 빵집", industry: "베이커리" };
const NOW = new Date("2026-10-10T12:00:00.000Z"); // KST 2026-10-10 21:00

const CHANNEL: Parameters<typeof buildGrowthNarrative>[0] = {
  channelId: "channel-1",
  platform: "youtube",
  externalId: "@mychannel",
  url: "https://youtube.com/@mychannel",
  displayName: null,
  thumbnailUrl: null,
  collection: { state: "SUCCESS", lastCollectedAt: null, nextCollectionAt: null, measuredDays: 2, paused: false },
  metrics: [
    { metric: "subscriberCount", label: "구독자 수", status: "OK", current: 1050, previous: 1000, absoluteDelta: 50, deltaPercent: 5, points: [], hasDemoSeedData: false, hasSampleData: false, kind: "TOTAL" },
    { metric: "viewCount", label: "조회수", status: "COLLECTING", current: null, previous: null, absoluteDelta: null, deltaPercent: null, points: [], hasDemoSeedData: false, hasSampleData: false, kind: "TOTAL" },
  ],
};

function makeClient({ selectResult, insertResult = { error: null } }: { selectResult: { data: unknown; error: unknown }; insertResult?: { error: unknown } }) {
  const selectBuilder = {
    eq: vi.fn(() => selectBuilder),
    order: vi.fn(() => selectBuilder),
    limit: vi.fn(() => selectBuilder),
    maybeSingle: vi.fn().mockResolvedValue(selectResult),
  };
  const insertSpy = vi.fn().mockResolvedValue(insertResult);
  const table = { select: vi.fn(() => selectBuilder), insert: insertSpy };
  return { from: vi.fn(() => table), insertSpy, selectBuilder };
}

beforeEach(() => {
  generateTextMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("buildGrowthNarrative", () => {
  it("uses the AI narrative verbatim when every number it wrote is verifiable", async () => {
    generateTextMock.mockResolvedValue("구독자가 50명 늘어서 1050명이 됐어요.");
    const result = await buildGrowthNarrative(CHANNEL, BUSINESS, 7);
    expect(result.aiUsed).toBe(true);
    expect(result.narrative).toBe("구독자가 50명 늘어서 1050명이 됐어요.");
  });

  it("never shows the mock provider's placeholder: it falls back to the summary built from the real numbers", async () => {
    generateTextMock.mockResolvedValue("[MOCK AI RESPONSE]\n\n다음 요청에 대한 예시 결과입니다:\n\"...\"\n\n실제 서비스에서는 AI_PROVIDER 환경변수를 openai 또는 gemini로 설정하면 이 자리에 실제 생성 콘텐츠가 표시됩니다.");
    const result = await buildGrowthNarrative(CHANNEL, BUSINESS, 7);
    expect(result.aiUsed).toBe(false);
    expect(result.narrative).not.toContain("MOCK");
    expect(result.narrative).not.toContain("AI_PROVIDER");
    expect(result.narrative).toBe("구독자 수는 이전 7일보다 50명 늘었어요. 지금은 1,050명이에요. 조회수는 아직 데이터를 모으는 중이에요.");
  });

  it("strips a sentence with a hallucinated number, keeping the rest", async () => {
    generateTextMock.mockResolvedValue("구독자가 1050명이에요. 어제보다 900명 늘었어요.");
    const result = await buildGrowthNarrative(CHANNEL, BUSINESS, 7);
    expect(result.aiUsed).toBe(true);
    expect(result.narrative).toBe("구독자가 1050명이에요.");
  });

  it("falls back to the rule-based summary when the AI call throws", async () => {
    generateTextMock.mockRejectedValue(new Error("provider down"));
    const result = await buildGrowthNarrative(CHANNEL, BUSINESS, 7);
    expect(result.aiUsed).toBe(false);
    expect(result.narrative).toContain("50명 늘었어요");
    expect(result.narrative).toContain("모으는 중");
  });

  it("falls back to the rule-based summary when every AI sentence gets stripped", async () => {
    generateTextMock.mockResolvedValue("구독자가 9999명이에요.");
    const result = await buildGrowthNarrative(CHANNEL, BUSINESS, 7);
    expect(result.aiUsed).toBe(false);
  });

  it("never mentions a percent for a metric with no previous value in the rule-based fallback", async () => {
    generateTextMock.mockRejectedValue(new Error("down"));
    const noPrevious = { ...CHANNEL, metrics: [{ ...CHANNEL.metrics[0], previous: null, absoluteDelta: null, deltaPercent: null }] };
    const result = await buildGrowthNarrative(noPrevious, BUSINESS, 7);
    expect(result.narrative).toContain("비교할 이전 기간 데이터가 없어요");
    expect(result.narrative).not.toMatch(/%/);
  });
});

describe("getOrCreateGrowthNarrative", () => {
  const trackedChannel = { id: "channel-1", business_id: "business-1" };

  it("reuses today's cached narrative without calling the AI or inserting a new row", async () => {
    const client = makeClient({ selectResult: { data: { narrative: "cached text", ai_used: true, created_at: NOW.toISOString() }, error: null } });
    createClientMock.mockResolvedValue(client);

    const result = await getOrCreateGrowthNarrative(trackedChannel, CHANNEL, BUSINESS, 7, NOW);

    expect(result).toEqual({ narrative: "cached text", aiUsed: true });
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(client.insertSpy).not.toHaveBeenCalled();
  });

  it("generates and inserts a new row when there is no cached row yet", async () => {
    generateTextMock.mockResolvedValue("구독자가 50명 늘어서 1050명이 됐어요.");
    const client = makeClient({ selectResult: { data: null, error: null } });
    createClientMock.mockResolvedValue(client);

    const result = await getOrCreateGrowthNarrative(trackedChannel, CHANNEL, BUSINESS, 7, NOW);

    expect(result.aiUsed).toBe(true);
    expect(client.insertSpy).toHaveBeenCalledWith({
      business_id: "business-1",
      channel_id: "channel-1",
      days: 7,
      narrative: "구독자가 50명 늘어서 1050명이 됐어요.",
      ai_used: true,
    });
  });

  it("reuses a rule-based fallback from the last hour instead of retrying the AI on every load", async () => {
    const recent = new Date(NOW.getTime() - 10 * 60 * 1000);
    const client = makeClient({ selectResult: { data: { narrative: "fallback", ai_used: false, created_at: recent.toISOString() }, error: null } });
    createClientMock.mockResolvedValue(client);

    const result = await getOrCreateGrowthNarrative(trackedChannel, CHANNEL, BUSINESS, 7, NOW);

    expect(result).toEqual({ narrative: "fallback", aiUsed: false });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("retries the AI when today's cached row is a rule-based fallback older than an hour", async () => {
    generateTextMock.mockResolvedValue("구독자가 50명 늘어서 1050명이 됐어요.");
    const earlierToday = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    const client = makeClient({ selectResult: { data: { narrative: "fallback", ai_used: false, created_at: earlierToday.toISOString() }, error: null } });
    createClientMock.mockResolvedValue(client);

    const result = await getOrCreateGrowthNarrative(trackedChannel, CHANNEL, BUSINESS, 7, NOW);

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(client.insertSpy).toHaveBeenCalledTimes(1);
    expect(result.aiUsed).toBe(true);
  });

  it("regenerates when the cached row is from a previous KST day", async () => {
    generateTextMock.mockResolvedValue("구독자가 50명 늘어서 1050명이 됐어요.");
    const yesterday = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    const client = makeClient({ selectResult: { data: { narrative: "stale", ai_used: true, created_at: yesterday.toISOString() }, error: null } });
    createClientMock.mockResolvedValue(client);

    const result = await getOrCreateGrowthNarrative(trackedChannel, CHANNEL, BUSINESS, 7, NOW);

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(client.insertSpy).toHaveBeenCalledTimes(1);
    expect(result.narrative).toBe("구독자가 50명 늘어서 1050명이 됐어요.");
  });

  it("throws ChannelsError when the cache lookup fails", async () => {
    const client = makeClient({ selectResult: { data: null, error: new Error("boom") } });
    createClientMock.mockResolvedValue(client);
    await expect(getOrCreateGrowthNarrative(trackedChannel, CHANNEL, BUSINESS, 7, NOW)).rejects.toMatchObject({ name: "ChannelsError", code: "DATABASE_ERROR" });
  });

  it("throws ChannelsError when persisting the new narrative fails", async () => {
    generateTextMock.mockResolvedValue("text");
    const client = makeClient({ selectResult: { data: null, error: null }, insertResult: { error: new Error("boom") } });
    createClientMock.mockResolvedValue(client);
    await expect(getOrCreateGrowthNarrative(trackedChannel, CHANNEL, BUSINESS, 7, NOW)).rejects.toMatchObject({ name: "ChannelsError", code: "DATABASE_ERROR" });
  });
});

describe("getOrCreateGrowthNarrative — rows saved while the mock AI was active", () => {
  it("ignores a cached placeholder (even one marked as AI-written) and writes a fresh, clean narrative", async () => {
    generateTextMock.mockResolvedValue("[MOCK AI RESPONSE] 예시");
    const client = makeClient({ selectResult: { data: { narrative: "[MOCK AI RESPONSE]\n\n다음 요청에 대한 예시 결과입니다", ai_used: true, created_at: NOW.toISOString() }, error: null } });
    createClientMock.mockResolvedValue(client);

    const result = await getOrCreateGrowthNarrative({ id: "channel-1", business_id: "biz-1" }, CHANNEL, BUSINESS, 7, NOW);

    expect(result.aiUsed).toBe(false);
    expect(result.narrative).not.toContain("MOCK");
    expect(client.insertSpy).toHaveBeenCalledWith(expect.objectContaining({ narrative: expect.not.stringContaining("MOCK"), ai_used: false }));
  });
});

describe("rule-based narrative wording", () => {
  const metric = (over: Partial<(typeof CHANNEL.metrics)[number]>) => ({ ...CHANNEL.metrics[0], ...over });
  const narrate = async (metrics: typeof CHANNEL.metrics) => {
    generateTextMock.mockRejectedValue(new Error("down"));
    return (await buildGrowthNarrative({ ...CHANNEL, metrics }, BUSINESS, 30)).narrative;
  };

  it("says a drop as a drop, and an unchanged value as unchanged, with the right particles", async () => {
    expect(await narrate([metric({ current: 940, previous: 1000, absoluteDelta: -60, deltaPercent: -6 })])).toBe("구독자 수는 이전 30일보다 60명 줄었어요. 지금은 940명이에요.");
    expect(await narrate([metric({ current: 1000, previous: 1000, absoluteDelta: 0, deltaPercent: 0 })])).toBe("구독자 수는 이전 30일과 같은 1,000명이에요.");
    expect(await narrate([metric({ metric: "viewCount", label: "조회수", current: 7, previous: null, absoluteDelta: null, deltaPercent: null })])).toBe("조회수는 지금 7회예요. 비교할 이전 기간 데이터가 없어요.");
  });

  it("uses each metric's own unit and never invents a number that is not in the data", async () => {
    const text = await narrate([metric({ metric: "viewCountDaily", label: "일별 조회수 증가량", current: 1200, previous: 900, absoluteDelta: 300, deltaPercent: 33 })]);
    expect(text).toBe("일별 조회수 증가량은 이전 30일보다 300회 늘었어요. 지금은 1,200회예요.");
    expect(text).not.toMatch(/33/);
  });
});
