import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, generateStructuredMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  generateStructuredMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/server/ai/generate", () => ({ generateStructured: generateStructuredMock }));

const { CalendarPlanError, generateCalendarPlan, getMarketingCalendarPageData, calendarPlanSchema } = await import("./calendar");

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
  main_offering: "수제 디저트",
  strengths: null,
  marketing_goal: "평일 방문 늘리기",
  sns_links: { instagram: "https://instagram.com/growth" },
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

function listQuery<T>(rows: T[]) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "order", "limit"]) builder[method] = vi.fn(() => builder);
  builder.then = (resolve: (value: { data: T[]; error: null }) => unknown) => resolve({ data: rows, error: null });
  return builder;
}

type ExistingItem = { id: string; topic: string; status: string; planned_date: string; automation_id: string | null; created_at: string };

function makeClient({
  diagnosis = { id: "diagnosis-1", score: 62, api_token: "must-not-leak", raw_summary: "page title that is not prompt context" } as Record<string, unknown> | null,
  existingItems = [] as ExistingItem[],
  history = [] as Array<{ topic: string | null; title: string | null }>,
} = {}) {
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
  const deleteIn = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn((table: string) => {
    if (table === "businesses") return businessQuery;
    if (table === "marketing_diagnoses") return diagnosisQuery;
    if (table === "content_history") return listQuery(history);
    if (table === "calendar_items") return { select: vi.fn(() => listQuery(existingItems)), insert, delete: vi.fn(() => ({ in: deleteIn })) };
    throw new Error(`Unexpected table: ${table}`);
  });
  return { client: { from }, insertedRows, insert, deleteIn };
}

const generatedItems = [
  { date: "2026-03-01", platform: "blog", contentType: "정보형", topic: "첫 주 블로그", goal: "인지", summary: "요약", cta: "상담" },
  { date: "2026-03-03", platform: "youtube_shorts", contentType: "쇼츠", topic: "첫 주 쇼츠", goal: "관심", summary: "요약", cta: "저장" },
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

describe("calendarPlanSchema: instagram_reels is not generable (ticket 1-8)", () => {
  const baseItem = { date: "2026-03-01", contentType: "정보형", topic: "주제", goal: "목표", summary: "요약", cta: "상담" };

  it("rejects an item with platform: instagram_reels — the AI's structured-output schema itself can never produce one", () => {
    const result = calendarPlanSchema.safeParse([{ ...baseItem, platform: "instagram_reels" }]);
    expect(result.success).toBe(false);
  });

  it("still accepts blog and youtube_shorts", () => {
    const result = calendarPlanSchema.safeParse([
      { ...baseItem, platform: "blog" },
      { ...baseItem, date: "2026-03-02", platform: "youtube_shorts" },
    ]);
    expect(result.success).toBe(true);
  });
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
    expect(request.prompt).not.toContain("page title that is not prompt context");
  });

  it("includes the marketing profile and the content brief instruction in the prompt", async () => {
    const { client } = makeClient();
    createClientMock.mockResolvedValue(client);
    generateStructuredMock.mockResolvedValue(generatedItems);

    await generateCalendarPlan(business.id, 2);

    const request = generateStructuredMock.mock.calls[0][0] as { prompt: string };
    expect(request.prompt).toContain("mainOffering");
    expect(request.prompt).toContain("콘텐츠 브리프");
  });

  it("tells the AI which topics already exist and drops near-duplicates it still returns", async () => {
    const { client, insertedRows } = makeClient({
      existingItems: [{ id: "old-published", topic: "첫 주 블로그 주제", status: "GENERATED", planned_date: "2026-02-20", automation_id: "a-1", created_at: "2026-02-18T00:00:00.000Z" }],
      history: [{ topic: "둘째 주 쇼츠 주제", title: "쇼츠 제목" }],
    });
    createClientMock.mockResolvedValue(client);
    generateStructuredMock.mockResolvedValue([
      ...generatedItems,
      { date: "2026-03-12", platform: "blog", contentType: "정보형", topic: "첫 주 블로그 주제 2", goal: "인지", summary: "요약", cta: "상담" },
    ]);

    const result = await generateCalendarPlan(business.id, 2);

    const request = generateStructuredMock.mock.calls[0][0] as { prompt: string };
    expect(request.prompt).toContain("첫 주 블로그 주제");
    expect(request.prompt).toContain("쇼츠 제목");
    expect(insertedRows.map((row) => row.topic)).not.toContain("첫 주 블로그 주제 2");
    expect(result.skippedDuplicates).toBeGreaterThanOrEqual(1);
  });

  it("does not treat distinct topics as duplicates just because they all start with the business name", async () => {
    const { client, insertedRows } = makeClient();
    createClientMock.mockResolvedValue(client);
    generateStructuredMock.mockResolvedValue([
      { ...generatedItems[0], topic: "성장 카페 처음 오시는 분을 위한 이용 안내" },
      { ...generatedItems[1], topic: "성장 카페 단골이 알려주는 숨은 활용법" },
      { ...generatedItems[2], topic: "성장 카페 계절이 바뀔 때 챙길 준비물" },
      { ...generatedItems[3], topic: "성장 카페 자주 받는 질문 다섯 가지" },
    ]);

    await generateCalendarPlan(business.id, 2);

    expect(insertedRows).toHaveLength(4);
  });

  it("fails instead of saving when almost every returned topic repeats an existing one", async () => {
    const existing = generatedItems.map((item, index) => ({ id: `old-${index}`, topic: item.topic, status: "GENERATED", planned_date: "2026-02-20", automation_id: "a-1", created_at: "2026-02-18T00:00:00.000Z" }));
    const { client, insert } = makeClient({ existingItems: existing });
    createClientMock.mockResolvedValue(client);
    generateStructuredMock.mockResolvedValue(generatedItems);

    const error = await generateCalendarPlan(business.id, 2).catch((caught) => caught);

    expect((error as InstanceType<typeof CalendarPlanError>).code).toBe("INVALID_AI_RESULT");
    expect(insert).not.toHaveBeenCalled();
  });

  it("replaces the unused part of the previous plan only after the new plan is saved", async () => {
    const { client, deleteIn, insert } = makeClient({
      existingItems: [
        { id: "unused-1", topic: "예전 주제 하나", status: "PLANNED", planned_date: "2026-03-05", automation_id: null, created_at: "2026-02-27T00:00:00.000Z" },
        { id: "linked", topic: "연결된 주제", status: "PLANNED", planned_date: "2026-03-05", automation_id: "a-1", created_at: "2026-02-27T00:00:00.000Z" },
        { id: "done", topic: "이미 만든 주제", status: "GENERATED", planned_date: "2026-03-05", automation_id: "a-1", created_at: "2026-02-27T00:00:00.000Z" },
        { id: "past", topic: "지난 계획", status: "PLANNED", planned_date: "2026-02-20", automation_id: null, created_at: "2026-02-10T00:00:00.000Z" },
      ],
    });
    createClientMock.mockResolvedValue(client);
    generateStructuredMock.mockResolvedValue(generatedItems);

    const result = await generateCalendarPlan(business.id, 2);

    expect(insert.mock.invocationCallOrder[0]).toBeLessThan(deleteIn.mock.invocationCallOrder[0]);
    expect(deleteIn).toHaveBeenCalledWith("id", ["unused-1"]);
    expect(result.replaced).toBe(1);
    // The replaced item's topic is not blocked from the new plan.
    const request = generateStructuredMock.mock.calls[0][0] as { prompt: string };
    expect(request.prompt).not.toContain("예전 주제 하나");
    expect(request.prompt).toContain("이미 만든 주제");
  });

  it("refuses a second plan within a minute and caps daily volume, before calling the AI", async () => {
    const justNow = { id: "x", topic: "방금 만든", status: "PLANNED", planned_date: "2026-03-05", automation_id: null, created_at: "2026-02-28T23:59:30.000Z" };
    createClientMock.mockResolvedValue(makeClient({ existingItems: [justNow] }).client);
    const burst = await generateCalendarPlan(business.id, 2).catch((caught) => caught);
    expect((burst as InstanceType<typeof CalendarPlanError>).code).toBe("RATE_LIMITED");

    const many = Array.from({ length: 84 }, (_, index) => ({ id: `m-${index}`, topic: `주제 ${index}`, status: "PLANNED", planned_date: "2026-03-05", automation_id: null, created_at: "2026-02-28T12:00:00.000Z" }));
    createClientMock.mockResolvedValue(makeClient({ existingItems: many }).client);
    const daily = await generateCalendarPlan(business.id, 2).catch((caught) => caught);
    expect((daily as InstanceType<typeof CalendarPlanError>).code).toBe("RATE_LIMITED");

    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it("excludes an out-of-range item but still saves the rest when enough remain (ticket 1-8: exclude, don't reject the whole plan)", async () => {
    const { client, insert, insertedRows } = makeClient();
    createClientMock.mockResolvedValue(client);
    const padded = [
      ...generatedItems,
      { date: "2026-03-05", platform: "blog", contentType: "정보형", topic: "셋째 글", goal: "인지", summary: "요약", cta: "상담" },
      { date: "2026-03-12", platform: "youtube_shorts", contentType: "쇼츠", topic: "셋째 쇼츠", goal: "전환", summary: "요약", cta: "문의" },
      { date: "2026-04-20", platform: "blog", contentType: "정보형", topic: "범위 밖 글", goal: "인지", summary: "요약", cta: "상담" }, // outside the 2-week window
    ];
    generateStructuredMock.mockResolvedValue(padded);

    const result = await generateCalendarPlan(business.id, 2);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(result.excludedOutOfRange).toBe(1);
    expect(insertedRows.map((row) => row.topic)).not.toContain("범위 밖 글");
    expect(insertedRows).toHaveLength(6);
  });

  it("merges a duplicate (date, platform) pair, keeping the first one and counting the merge", async () => {
    const { client, insert, insertedRows } = makeClient();
    createClientMock.mockResolvedValue(client);
    const withDuplicate = [
      ...generatedItems,
      { date: "2026-03-01", platform: "blog", contentType: "정보형", topic: "첫 주 블로그(중복, 버려짐)", goal: "인지", summary: "요약", cta: "상담" }, // same date+platform as generatedItems[0]
      { date: "2026-03-15", platform: "blog", contentType: "정보형", topic: "셋째 주 글", goal: "인지", summary: "요약", cta: "상담" },
    ];
    generateStructuredMock.mockResolvedValue(withDuplicate);

    const result = await generateCalendarPlan(business.id, 2);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(result.mergedDuplicates).toBe(1);
    expect(insertedRows.map((row) => row.topic)).toContain("첫 주 블로그"); // the first one with this (date, platform) wins
    expect(insertedRows.map((row) => row.topic)).not.toContain("첫 주 블로그(중복, 버려짐)");
  });

  it("rejects only when too few items remain after excluding out-of-range ones and merging duplicates, with a message naming the shortfall", async () => {
    const { client, insert } = makeClient();
    createClientMock.mockResolvedValue(client);
    generateStructuredMock.mockResolvedValue([
      ...generatedItems.slice(0, 3), // 3 in-range, unique items
      { ...generatedItems[3], date: "2026-04-20" }, // out of range -> excluded, leaving 3 < weeks*2=4
    ]);

    const error = await generateCalendarPlan(business.id, 2).catch((caught) => caught);

    expect(error).toBeInstanceOf(CalendarPlanError);
    expect((error as InstanceType<typeof CalendarPlanError>).code).toBe("INVALID_AI_RESULT");
    expect((error as Error).message).toContain("3개");
    expect(insert).not.toHaveBeenCalled();
  });
});

/**
 * Builder for getMarketingCalendarPageData's query shapes, distinct from
 * makeClient() above: its businesses/calendar_items queries are awaited
 * directly (no .maybeSingle()), while getLatestDiagnosis still ends in
 * .maybeSingle() — same dual shape runner.test.ts's makeAdmin uses.
 */
function makePageDataClient(options: { businesses?: unknown[]; items?: unknown[]; diagnosis: Record<string, unknown> | null }) {
  const businesses = options.businesses ?? [business];
  const items = options.items ?? [];
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      gte: vi.fn(() => builder),
      lte: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(() => Promise.resolve({ data: options.diagnosis, error: null })),
      then: (resolve: (value: { data: unknown; error: null }) => unknown) => {
        if (table === "businesses") return resolve({ data: businesses, error: null });
        if (table === "calendar_items") return resolve({ data: items, error: null });
        throw new Error(`Unexpected table: ${table}`);
      },
    };
    return builder;
  });
  return { from };
}

describe("getMarketingCalendarPageData — hasDiagnosis reflects marketing_diagnoses directly", () => {
  it("is true once a diagnosis row exists, using exactly the columns runDiagnosis() (src/app/(app)/diagnosis/actions.ts) writes", async () => {
    const client = makePageDataClient({
      diagnosis: {
        id: "diagnosis-1",
        business_id: business.id,
        source_type: "website",
        source_url: "https://example.com/",
        score: 70,
        missing_channels: ["instagram"],
        content_status: "최근 업데이트가 없습니다.",
        sns_activity: "SNS 연동이 없습니다.",
        recommendations: ["인스타그램을 연결하세요."],
        raw_summary: "성장 카페 — 소개",
        created_at: "2026-03-01T00:00:00.000Z",
      },
    });
    createClientMock.mockResolvedValue(client);

    const result = await getMarketingCalendarPageData("user-1", { businessId: business.id, startDate: "2026-03-01", endDate: "2026-03-28" });

    expect(result.hasDiagnosis).toBe(true);
  });

  it("is false when no diagnosis has been run yet", async () => {
    const client = makePageDataClient({ diagnosis: null });
    createClientMock.mockResolvedValue(client);

    const result = await getMarketingCalendarPageData("user-1", { businessId: business.id, startDate: "2026-03-01", endDate: "2026-03-28" });

    expect(result.hasDiagnosis).toBe(false);
  });
});
