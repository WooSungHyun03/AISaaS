import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, triggerRunNowMock, canCreateAutomationMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  triggerRunNowMock: vi.fn(),
  canCreateAutomationMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/app/(app)/automations/actions", () => ({ triggerRunNow: triggerRunNowMock }));
vi.mock("@/server/billing/entitlements", () => ({ canCreateAutomation: canCreateAutomationMock }));

const { triggerCalendarItemNow } = await import("./actions");

const inserted: unknown[] = [];

function queryReturning(result: { data: unknown; error: unknown }) {
  const builder = {
    insert: vi.fn((payload: unknown) => {
      inserted.push(payload);
      return builder;
    }),
    single: vi.fn().mockResolvedValue({ data: { id: "automation-new" }, error: null }),
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  return builder;
}

function makeClient(options: { platform?: "blog" | "instagram_reels" | "youtube_shorts"; automation?: { id: string } | null } = {}) {
  const item = {
    id: "11111111-1111-4111-8111-111111111111",
    business_id: "22222222-2222-4222-8222-222222222222",
    planned_date: "2026-10-01",
    platform: options.platform ?? "blog",
    status: "PLANNED",
    automation_id: null,
  };
  const from = vi.fn((table: string) => {
    if (table === "calendar_items") return queryReturning({ data: item, error: null });
    if (table === "automation_templates") return queryReturning({ data: { id: "template-1" }, error: null });
    if (table === "automations") return queryReturning({ data: options.automation === undefined ? { id: "automation-1" } : options.automation, error: null });
    if (table === "businesses") {
      return queryReturning({ data: { id: "22222222-2222-4222-8222-222222222222", name: "해온 카페", keywords: ["카페", "신메뉴"], brand_tone: null, marketing_goal: null }, error: null });
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    from,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T03:00:00.000Z"));
  createClientMock.mockReset();
  triggerRunNowMock.mockReset();
  canCreateAutomationMock.mockReset();
  canCreateAutomationMock.mockResolvedValue({ allowed: true });
  inserted.length = 0;
});

afterEach(() => vi.useRealTimers());

describe("triggerCalendarItemNow", () => {
  it("finds the active blog automation and delegates with the trusted calendar item id", async () => {
    createClientMock.mockResolvedValue(makeClient());
    triggerRunNowMock.mockResolvedValue({ success: true, runId: "run-1", contentHistoryId: "content-1" });

    const result = await triggerCalendarItemNow("11111111-1111-4111-8111-111111111111");

    expect(result).toMatchObject({ success: true, contentHistoryId: "content-1" });
    expect(triggerRunNowMock).toHaveBeenCalledWith("automation-1", "11111111-1111-4111-8111-111111111111");
  });

  it("does not run Instagram items through an unrelated handler", async () => {
    createClientMock.mockResolvedValue(makeClient({ platform: "instagram_reels" }));

    const result = await triggerCalendarItemNow("11111111-1111-4111-8111-111111111111");

    expect(result.error).toContain("준비 중");
    expect(triggerRunNowMock).not.toHaveBeenCalled();
  });

  it("finds the active shorts automation and delegates with the trusted calendar item id, now that Shorts is AVAILABLE", async () => {
    createClientMock.mockResolvedValue(makeClient({ platform: "youtube_shorts" }));
    triggerRunNowMock.mockResolvedValue({ success: true, runId: "run-2", contentHistoryId: "content-2" });

    const result = await triggerCalendarItemNow("11111111-1111-4111-8111-111111111111");

    expect(result).toMatchObject({ success: true, contentHistoryId: "content-2" });
    expect(triggerRunNowMock).toHaveBeenCalledWith("automation-1", "11111111-1111-4111-8111-111111111111");
  });

  it("works for an item planned on any date, not only today", async () => {
    createClientMock.mockResolvedValue(makeClient());
    triggerRunNowMock.mockResolvedValue({ success: true, runId: "run-3", contentHistoryId: "content-3" });
    vi.setSystemTime(new Date("2026-10-20T03:00:00.000Z")); // item is planned 2026-10-01 (overdue)

    const result = await triggerCalendarItemNow("11111111-1111-4111-8111-111111111111");

    expect(result).toMatchObject({ success: true });
    expect(triggerRunNowMock).toHaveBeenCalledOnce();
  });

  it("creates an unscheduled DRAFT automation from the business profile when none exists yet", async () => {
    createClientMock.mockResolvedValue(makeClient({ automation: null }));
    triggerRunNowMock.mockResolvedValue({ success: true, runId: "run-4", contentHistoryId: "content-4" });

    const result = await triggerCalendarItemNow("11111111-1111-4111-8111-111111111111");

    expect(result).toMatchObject({ success: true });
    expect(inserted[0]).toMatchObject({
      user_id: "user-1",
      status: "DRAFT",
      config: { deliveryMode: "app_draft", keywords: ["카페", "신메뉴"] },
    });
    expect(triggerRunNowMock).toHaveBeenCalledWith("automation-new", "11111111-1111-4111-8111-111111111111");
  });

  it("surfaces the plan limit instead of creating another automation", async () => {
    createClientMock.mockResolvedValue(makeClient({ automation: null }));
    canCreateAutomationMock.mockResolvedValue({ allowed: false, reason: "무료 플랜은 만들기 설정을 1개까지 만들 수 있어요." });

    const result = await triggerCalendarItemNow("11111111-1111-4111-8111-111111111111");

    expect(result.error).toContain("1개까지");
    expect(inserted).toHaveLength(0);
    expect(triggerRunNowMock).not.toHaveBeenCalled();
  });
});
