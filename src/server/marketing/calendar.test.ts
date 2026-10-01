import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, generateStructuredMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  generateStructuredMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/server/ai/generate", () => ({ generateStructured: generateStructuredMock }));

const { CalendarPlanError, generateCalendarPlan } = await import("./calendar");

const business = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "성장 카페",
  industry: "카페",
  description: "지역 고객을 위한 디저트 카페",
  location: "서울",
  target_customer: "20~40대 직장인",
  brand_tone: "친근하고 전문적",
  keywords: ["디저트", "커피"],
  website: "https://example.com",
};

function queryReturning<T>(result: T) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  return builder;
}

function makeClient({ diagnosis = { id: "diagnosis-1", score: 62, api_token: "must-not-leak" } as Record<string, unknown> | null } = {}) {
  const businessQuery = queryReturning({ data: business, error: null });
  const diagnosisQuery = queryReturning({ data: diagnosis, error: null });
  const insertedRows: Array<Record<string, unknown>> = [];
  const insertSelect = vi.fn(async () => ({
    data: insertedRows.map((row, index) => ({
      ...row,
      id: `calendar-${index}`,
      status: "PLANNED",
      automation_id: null,
      content_history_id: null,
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
    })),
    error: null,
  }));
  const insert = vi.fn((rows: Array<Record<string, unknown>>) => {
    insertedRows.push(...rows);
    return { select: insertSelect };
  });
  const from = vi.fn((table: string) => {
    if (table === "businesses") return businessQuery;
    if (table === "marketing_diagnoses") return diagnosisQuery;
    if (table === "calendar_items") return { insert };
    throw new Error(`Unexpected table: ${table}`);
  });
  return { client: { from }, insertedRows, insert };
}

const generatedItems = [
  { date: "2026-03-01", platform: "blog", contentType: "정보형", topic: "첫 주 블로그", goal: "인지", summary: "요약", cta: "상담" },
  { date: "2026-03-03", platform: "instagram_reels", contentType: "릴스", topic: "첫 주 릴스", goal: "관심", summary: "요약", cta: "저장" },
  { date: "2026-03-08", platform: "blog", contentType: "정보형", topic: "둘째 주 블로그", goal: "검색", summary: "요약", cta: "방문" },
  { date: "2026-03-10", platform: "youtube_shorts", contentType: "쇼츠", topic: "둘째 주 쇼츠", goal: "전환", summary: "요약", cta: "문의" },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));
  createClientMock.mockReset();
  generateStructuredMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("generateCalendarPlan", () => {
  it("rejects periods outside 2–4 weeks before accessing the database", async () => {
    const error = await generateCalendarPlan(business.id, 1).catch((caught) => caught);
    expect(error).toBeInstanceOf(CalendarPlanError);
    expect((error as InstanceType<typeof CalendarPlanError>).code).toBe("INVALID_WEEKS");
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("requires a saved diagnosis before asking the AI", async () => {
    const { client } = makeClient({ diagnosis: null });
    createClientMock.mockResolvedValue(client);

    const error = await generateCalendarPlan(business.id, 2).catch((caught) => caught);

    expect(error).toBeInstanceOf(CalendarPlanError);
    expect((error as InstanceType<typeof CalendarPlanError>).code).toBe("DIAGNOSIS_REQUIRED");
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it("uses profile and diagnosis context, validates the plan, and bulk inserts it", async () => {
    const { client, insertedRows, insert } = makeClient();
    createClientMock.mockResolvedValue(client);
    generateStructuredMock.mockResolvedValue(generatedItems);

    const result = await generateCalendarPlan(business.id, 2);

    expect(result.items).toHaveLength(4);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insertedRows).toEqual(generatedItems.map((item) => ({
      business_id: business.id,
      planned_date: item.date,
      platform: item.platform,
      content_type: item.contentType,
      topic: item.topic,
      goal: item.goal,
      summary: item.summary,
      cta: item.cta,
    })));
    const request = generateStructuredMock.mock.calls[0][0] as { prompt: string };
    expect(request.prompt).toContain("성장 카페");
    expect(request.prompt).toContain("\"score\":62");
    expect(request.prompt).not.toContain("must-not-leak");
  });

  it("does not save an AI plan containing dates outside the requested range", async () => {
    const { client, insert } = makeClient();
    createClientMock.mockResolvedValue(client);
    generateStructuredMock.mockResolvedValue([
      ...generatedItems.slice(0, 3),
      { ...generatedItems[3], date: "2026-04-20" },
    ]);

    const error = await generateCalendarPlan(business.id, 2).catch((caught) => caught);

    expect(error).toBeInstanceOf(CalendarPlanError);
    expect((error as InstanceType<typeof CalendarPlanError>).code).toBe("INVALID_AI_RESULT");
    expect(insert).not.toHaveBeenCalled();
  });
});
