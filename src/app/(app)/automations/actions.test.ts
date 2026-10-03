import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createClientMock,
  canExecuteAutomationMock,
  runAutomationNowMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  canExecuteAutomationMock: vi.fn(),
  runAutomationNowMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/server/billing/entitlements", () => ({
  canCreateAutomation: vi.fn(),
  canExecuteAutomation: canExecuteAutomationMock,
}));
vi.mock("@/server/automations/runner", () => ({ runAutomationNow: runAutomationNowMock }));

const { createAutomation, triggerRunNow } = await import("./actions");

type QueryResult = { data: unknown; error: unknown };

function makeClient() {
  const queues: Record<string, QueryResult[]> = {
    automations: [{ data: { id: "automation-1", user_id: "user-1", business_id: "business-1", template_id: "template-1" }, error: null }],
    automation_templates: [{ data: { slug: "blog-marketing" }, error: null }],
    calendar_items: [
      {
        data: {
          id: "calendar-1",
          business_id: "business-1",
          planned_date: "2026-10-01",
          platform: "blog",
          topic: "계획된 블로그 주제",
          goal: "상담 전환",
          cta: "상담 신청",
          status: "PLANNED",
        },
        error: null,
      },
      { data: { id: "calendar-1" }, error: null },
    ],
  };
  const updates: Record<string, unknown[]> = {};
  const from = vi.fn((table: string) => {
    const result = queues[table]?.shift() ?? { data: null, error: null };
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      update: vi.fn((payload: unknown) => {
        (updates[table] ??= []).push(payload);
        return builder;
      }),
      single: vi.fn().mockResolvedValue(result),
      maybeSingle: vi.fn().mockResolvedValue(result),
    };
    return builder;
  });
  return {
    client: {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      from,
    },
    updates,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T03:00:00.000Z"));
  createClientMock.mockReset();
  canExecuteAutomationMock.mockReset();
  runAutomationNowMock.mockReset();
  revalidatePathMock.mockReset();
});

afterEach(() => vi.useRealTimers());

describe("triggerRunNow with a calendar item", () => {
  it("passes trusted plan context to the runner and links the generated content", async () => {
    const { client, updates } = makeClient();
    createClientMock.mockResolvedValue(client);
    canExecuteAutomationMock.mockResolvedValue({ allowed: true });
    runAutomationNowMock.mockResolvedValue({
      runId: "run-1",
      status: "SUCCESS",
      output: { title: "생성 제목" },
      contentHistoryId: "content-1",
    });

    const result = await triggerRunNow("automation-1", "calendar-1");

    expect(result).toEqual({ success: true, runId: "run-1", contentHistoryId: "content-1" });
    expect(runAutomationNowMock).toHaveBeenCalledWith("automation-1", {
      calendarItem: {
        id: "calendar-1",
        businessId: "business-1",
        plannedDate: "2026-10-01",
        platform: "blog",
        topic: "계획된 블로그 주제",
        goal: "상담 전환",
        cta: "상담 신청",
      },
    });
    expect(updates.calendar_items[0]).toEqual({
      status: "GENERATED",
      automation_id: "automation-1",
      content_history_id: "content-1",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/calendar");
  });
});

describe("createAutomation — availability gate", () => {
  it("rejects creating an automation for a COMING_SOON template, even if requested directly (not just hidden in the UI)", async () => {
    const queues: Record<string, QueryResult[]> = {
      businesses: [{ data: { id: "business-1" }, error: null }],
      automation_templates: [{ data: { slug: "newsletter", is_active: true }, error: null }],
    };
    const from = vi.fn((table: string) => {
      const result = queues[table]?.shift() ?? { data: null, error: null };
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        maybeSingle: vi.fn().mockResolvedValue(result),
      };
      return builder;
    });
    createClientMock.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      from,
    });

    const formData = new FormData();
    formData.set("businessId", "business-1");
    formData.set("templateId", "template-newsletter");
    formData.set("name", "뉴스레터 자동화");

    const result = await createAutomation({}, formData);

    expect(result).toEqual({ error: "아직 생성할 수 없는 자동화입니다." });
  });
});
