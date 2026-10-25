import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createClientMock,
  canCreateAutomationMock,
  canExecuteAutomationMock,
  runAutomationNowMock,
  revalidatePathMock,
  removeShortsFilesMock,
} = vi.hoisted(() => ({
  removeShortsFilesMock: vi.fn(),
  createClientMock: vi.fn(),
  canCreateAutomationMock: vi.fn(),
  canExecuteAutomationMock: vi.fn(),
  runAutomationNowMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/server/billing/entitlements", () => ({
  canCreateAutomation: canCreateAutomationMock,
  canExecuteAutomation: canExecuteAutomationMock,
}));
vi.mock("@/server/automations/runner", () => ({ runAutomationNow: runAutomationNowMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ admin: true }) }));
vi.mock("@/server/account/delete-account", () => ({ removeShortsFiles: removeShortsFilesMock }));

const { createAutomation, deleteAutomation, triggerRunNow } = await import("./actions");

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
          content_type: "정보성 블로그 글",
          topic: "계획된 블로그 주제",
          goal: "상담 전환",
          summary: "상담 전 자주 묻는 질문 정리",
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
  canCreateAutomationMock.mockReset();
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
        contentType: "정보성 블로그 글",
        topic: "계획된 블로그 주제",
        goal: "상담 전환",
        summary: "상담 전 자주 묻는 질문 정리",
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

describe("triggerRunNow without a calendar item (plain re-generate — what RunNowButton / the /blog page use)", () => {
  it("still enforces the billing limit before calling the runner", async () => {
    const { client } = makeClient();
    createClientMock.mockResolvedValue(client);
    canExecuteAutomationMock.mockResolvedValue({ allowed: false, reason: "이용권이 없거나 모두 만료됐어요. 이용권을 구매하면 바로 만들 수 있어요." });

    const result = await triggerRunNow("automation-1");

    expect(result).toEqual({ error: "이용권이 없거나 모두 만료됐어요. 이용권을 구매하면 바로 만들 수 있어요." });
    expect(runAutomationNowMock).not.toHaveBeenCalled();
  });

  it("refuses to run (or leak) an automation owned by a different user", async () => {
    const from = vi.fn((table: string) => {
      const result: QueryResult = table === "automations"
        ? { data: { id: "automation-1", user_id: "someone-elses-user-id", business_id: "business-1", template_id: "template-1" }, error: null }
        : { data: null, error: null };
      const builder = { select: vi.fn(() => builder), eq: vi.fn(() => builder), single: vi.fn().mockResolvedValue(result), maybeSingle: vi.fn().mockResolvedValue(result) };
      return builder;
    });
    createClientMock.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) }, from });

    const result = await triggerRunNow("automation-1");

    expect(result).toEqual({ error: "자동화를 찾을 수 없습니다." });
    expect(canExecuteAutomationMock).not.toHaveBeenCalled();
    expect(runAutomationNowMock).not.toHaveBeenCalled();
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

describe("createAutomation — blog delivery mode (generation-only going forward)", () => {
  function makeBlogCreationClient() {
    const queues: Record<string, QueryResult[]> = {
      businesses: [{ data: { id: "business-1" }, error: null }],
      automation_templates: [{ data: { slug: "blog-marketing", is_active: true }, error: null }],
      automations: [{ data: { id: "automation-1" }, error: null }],
    };
    const from = vi.fn((table: string) => {
      const result = queues[table]?.shift() ?? { data: null, error: null };
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        insert: vi.fn(() => builder),
        maybeSingle: vi.fn().mockResolvedValue(result),
        single: vi.fn().mockResolvedValue(result),
      };
      return builder;
    });
    return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) }, from };
  }

  function blogFormData(deliveryMode: string) {
    const formData = new FormData();
    formData.set("businessId", "business-1");
    formData.set("templateId", "template-blog");
    formData.set("name", "블로그 자동화");
    formData.set("objective", "신메뉴 홍보용 글을 꾸준히 만들고 싶어요");
    formData.set("keywords", "소금빵, 베이커리");
    formData.set("tone", "친근하게");
    formData.set("frequency", "WEEKLY");
    formData.set("daysOfWeek", "1");
    formData.set("timeOfDay", "09:00");
    formData.set("deliveryMode", deliveryMode);
    return formData;
  }

  it.each(["wordpress_draft", "wordpress_publish"])(
    "treats an old delivery mode %s as plain draft saving (WordPress delivery no longer exists)",
    async (deliveryMode) => {
      createClientMock.mockResolvedValue(makeBlogCreationClient());
      canCreateAutomationMock.mockResolvedValue({ allowed: true });

      const result = await createAutomation({}, blogFormData(deliveryMode));

      expect(result).toBeUndefined();
    },
  );

  it("allows app_draft for a new blog automation", async () => {
    createClientMock.mockResolvedValue(makeBlogCreationClient());
    canCreateAutomationMock.mockResolvedValue({ allowed: true });

    const result = await createAutomation({}, blogFormData("app_draft"));

    // createAutomation redirects on success (mocked as a no-op above), so a
    // defined return value here would mean it returned early with an error.
    expect(result).toBeUndefined();
  });
});

describe("triggerRunNow with a Shorts calendar item", () => {
  it("only renders a preview — it never posts to a platform from the calendar", async () => {
    const { client } = makeClient();
    createClientMock.mockResolvedValue(client);
    canExecuteAutomationMock.mockResolvedValue({ allowed: true });
    runAutomationNowMock.mockResolvedValue({ runId: "run-1", status: "SUCCESS", output: {}, contentHistoryId: "content-1" });
    // Swap the queued rows for a Shorts template + youtube_shorts item.
    const original = client.from;
    client.from = vi.fn((table: string) => {
      const builder = original(table) as { single: () => Promise<{ data: unknown; error: unknown }>; maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
      if (table === "automation_templates") {
        builder.single = () => Promise.resolve({ data: { slug: "shorts" }, error: null });
      }
      if (table === "calendar_items") {
        const calendarMaybeSingle = builder.maybeSingle;
        let first = true;
        builder.maybeSingle = async () => {
          const result = await calendarMaybeSingle();
          if (first) {
            first = false;
            return { data: { ...(result.data as object), platform: "youtube_shorts" }, error: null };
          }
          return result;
        };
      }
      return builder as never;
    }) as never;

    await triggerRunNow("automation-1", "calendar-1");

    expect(runAutomationNowMock).toHaveBeenCalledWith(
      "automation-1",
      expect.objectContaining({ shorts: { previewOnly: true } }),
    );
  });
});

describe("deleteAutomation", () => {
  function chain(result: QueryResult) {
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "limit", "delete"]) query[method] = vi.fn(() => query);
    query.maybeSingle = vi.fn(() => Promise.resolve(result));
    return query;
  }

  it("removes the photos and videos stored under the deleted automation (the rows cascade, Storage does not)", async () => {
    const tables: Record<string, Record<string, unknown>> = { automation_runs: chain({ data: null, error: null }), automations: chain({ data: { id: "auto-1" }, error: null }) };
    createClientMock.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) }, from: vi.fn((table: string) => tables[table]) });

    expect(await deleteAutomation("auto-1")).toEqual({ success: true });
    expect(removeShortsFilesMock).toHaveBeenCalledWith({ admin: true }, "user-1/auto-1");
  });

  it("keeps the files when the row was not deleted", async () => {
    const tables: Record<string, Record<string, unknown>> = { automation_runs: chain({ data: null, error: null }), automations: chain({ data: null, error: null }) };
    createClientMock.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) }, from: vi.fn((table: string) => tables[table]) });

    expect((await deleteAutomation("auto-x")).error).toBeTruthy();
    expect(removeShortsFilesMock).not.toHaveBeenCalled();
  });

  it("says a run is in flight when the database refuses the delete (a run started after the check, migration 0078)", async () => {
    const tables: Record<string, Record<string, unknown>> = { automation_runs: chain({ data: null, error: null }), automations: chain({ data: null, error: { code: "55006" } }) };
    createClientMock.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) }, from: vi.fn((table: string) => tables[table]) });

    expect((await deleteAutomation("auto-1")).error).toContain("실행 중");
    expect(removeShortsFilesMock).not.toHaveBeenCalled();
  });
});
