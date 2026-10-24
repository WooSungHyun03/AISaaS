import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeNextRunAt } from "./scheduler";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

const { getHandlerMock } = vi.hoisted(() => ({ getHandlerMock: vi.fn() }));
vi.mock("./handlers", () => ({ getHandler: getHandlerMock }));

const { canExecuteAutomationMock, incrementUsageMock } = vi.hoisted(() => ({
  canExecuteAutomationMock: vi.fn(),
  incrementUsageMock: vi.fn(),
}));
vi.mock("@/server/billing/entitlements", () => ({
  canExecuteAutomation: canExecuteAutomationMock,
  incrementUsage: incrementUsageMock,
  CREDIT_EXHAUSTED_MESSAGE: "이용권이 없거나 모두 만료됐어요. 이용권을 구매하면 바로 만들 수 있어요.",
  getAutomationCreditKind: (slug: string) => slug === "blog-marketing" ? "BLOG" : slug === "shorts" ? "SHORTS" : null,
}));

const {
  ensureTrialCreditsMock,
  reserveCreditMock,
  settleCreditByReferenceMock,
  releaseCreditByReferenceMock,
  isInsufficientCreditErrorMock,
} = vi.hoisted(() => ({
  ensureTrialCreditsMock: vi.fn(),
  reserveCreditMock: vi.fn(),
  settleCreditByReferenceMock: vi.fn(),
  releaseCreditByReferenceMock: vi.fn(),
  isInsufficientCreditErrorMock: vi.fn(),
}));
vi.mock("@/server/billing/credits", () => ({
  ensureTrialCredits: ensureTrialCreditsMock,
  reserveCredit: reserveCreditMock,
  settleCreditByReference: settleCreditByReferenceMock,
  releaseCreditByReference: releaseCreditByReferenceMock,
  isInsufficientCreditError: isInsufficientCreditErrorMock,
}));

const budget = vi.hoisted(() => ({
  claim: vi.fn(),
  assertAllowed: vi.fn(),
  closeRunItem: vi.fn(),
  closeFailed: vi.fn(),
  settleOpen: vi.fn(),
  releaseItem: vi.fn(),
  scopes: [] as unknown[],
}));
vi.mock("@/server/budget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/budget")>()),
  claimBudgetItem: budget.claim,
  assertPaidCallsAllowed: budget.assertAllowed,
  closeRunItem: budget.closeRunItem,
  closeFailedRunBudget: budget.closeFailed,
  settleOpenReservations: budget.settleOpen,
  releaseBudgetItem: budget.releaseItem,
  withBudgetScope: (scope: unknown, fn: () => Promise<unknown>) => {
    budget.scopes.push(scope);
    return fn();
  },
}));

const { runAutomationNow, runDueAutomation } = await import("./runner");
const { BudgetError } = await import("@/server/budget/errors");

/**
 * A minimal stand-in for the Supabase query builder, dispatched by table
 * name so a single test can express the whole sequence of `.from(...)`
 * calls `executeAutomation()` makes (several against the same table, for
 * different purposes) as one queue per table, consumed in call order.
 * Every chain method returns the same object and it resolves like the real
 * client whether the caller ends the chain with `.single()`, `.maybeSingle()`,
 * or just awaits it directly (`.update(...).eq(...)`).
 */
type Result = { data: unknown; error?: unknown };

function makeAdmin(tableQueues: Record<string, Result[]>) {
  const inserts: Record<string, unknown[]> = {};
  const updates: Record<string, unknown[]> = {};
  const filters: Record<string, Array<[string, unknown]>> = {};
  const from = vi.fn((table: string) => {
    const queue = tableQueues[table];
    const result: Result = queue && queue.length > 0 ? queue.shift()! : { data: null, error: null };
    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => {
        (filters[table] ??= []).push([column, value]);
        return builder;
      }),
      in: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      insert: vi.fn((payload: unknown) => {
        (inserts[table] ??= []).push(payload);
        return builder;
      }),
      update: vi.fn((payload: unknown) => {
        (updates[table] ??= []).push(payload);
        return builder;
      }),
      single: vi.fn(() => Promise.resolve(result)),
      maybeSingle: vi.fn(() => Promise.resolve(result)),
      then: (resolve: (value: Result) => unknown) => resolve(result),
    };
    return builder;
  });
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  return { from, rpc, inserts, updates, filters };
}

const SCHEDULE = { frequency: "DAILY" as const, timeOfDay: "09:00", timezone: "Asia/Seoul" };

const AUTOMATION = {
  id: "auto-1",
  user_id: "user-1",
  business_id: "biz-1",
  template_id: "tmpl-1",
  name: "Blog automation",
  status: "ACTIVE",
  schedule: SCHEDULE,
  config: {},
  last_run_at: null,
  next_run_at: "2026-09-25T00:00:00.000Z",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const BUSINESS = { id: "biz-1", owner_id: "user-1", name: "Test Biz", promotion_type: "STORE" };
const TEMPLATE = { id: "tmpl-1", slug: "blog-marketing", name: "Blog Marketing", is_active: true };

function noInFlight(): Result {
  return { data: null, error: null };
}

function okHandler(result: Record<string, unknown> = { output: { ok: true } }) {
  const run = vi.fn().mockResolvedValue(result);
  getHandlerMock.mockReturnValue({ templateSlug: "blog-marketing", run });
  return run;
}

beforeEach(() => {
  ensureTrialCreditsMock.mockResolvedValue(true);
  reserveCreditMock.mockResolvedValue("reservation-1");
  settleCreditByReferenceMock.mockResolvedValue(true);
  releaseCreditByReferenceMock.mockResolvedValue(true);
  isInsufficientCreditErrorMock.mockImplementation((error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "P0001"));
});

afterEach(() => {
  vi.clearAllMocks();
  budget.scopes.length = 0;
});

describe("runDueAutomation / runAutomationNow — happy path", () => {
  it("tags a scheduled run with source SCHEDULED and advances next_run_at on success", async () => {
    const admin = makeAdmin({
      automations: [{ data: AUTOMATION, error: null }, { data: null, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [noInFlight(), { data: { id: "run-1" }, error: null }, { data: null, error: null }],
      content_history: [{ data: [], error: null }, { data: { id: "content-1" }, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    const run = okHandler({ output: { ok: true }, content: "body", contentType: "blog", title: "T", topic: "Topic" });

    const result = await runDueAutomation("auto-1");

    expect(result).toEqual({ runId: "run-1", status: "SUCCESS", output: { ok: true }, contentHistoryId: "content-1" });
    // The handler gets the automation_runs row id the runner already
    // inserted — handlers derive their idempotency key
    // from this (see types/automation.ts#AutomationRunContext.runId).
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1" }));
    expect(admin.filters.content_history).toEqual(expect.arrayContaining([
      ["automation_id", "auto-1"],
      ["content_type", "blog-marketing"],
    ]));
    expect(admin.inserts.automation_runs[0]).toMatchObject({ automation_id: "auto-1", status: "RUNNING", source: "SCHEDULED" });
    // So a content_history row can link back to its full generation result
    // (hook/seoKeywords/imageSuggestion etc. live only in
    // automation_runs.output) — see src/app/(app)/blog/page.tsx.
    expect(admin.inserts.content_history[0]).toMatchObject({ run_id: "run-1" });
    const expectedNext = computeNextRunAt(SCHEDULE).toISOString();
    expect(admin.updates.automations[0]).toMatchObject({ next_run_at: expectedNext });
    expect(reserveCreditMock).toHaveBeenCalledWith({ userId: "user-1", kind: "BLOG", referenceId: "run-1" });
    expect(admin.rpc).toHaveBeenCalledWith("complete_automation_run_credit_v2", expect.objectContaining({
      p_run_id: "run-1",
      p_requires_credit: true,
    }));
    expect(releaseCreditByReferenceMock).not.toHaveBeenCalled();
    expect(incrementUsageMock).toHaveBeenCalledWith(admin, "user-1", { automationRuns: 1, aiGenerations: 1 });
  });

  it("records a stored video on the content row, so a finished Short shows up in the library", async () => {
    const admin = makeAdmin({
      automations: [{ data: AUTOMATION, error: null }, { data: null, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [noInFlight(), { data: { id: "run-v" }, error: null }, { data: null, error: null }],
      content_history: [{ data: [], error: null }, { data: { id: "content-v" }, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    okHandler({ output: { ok: true }, content: "script", contentType: "shorts", title: "Hook", video: { path: "user-1/auto-1/run-v/final.mp4", durationSec: 25, bytes: 4_000_000 } });

    const result = await runAutomationNow("auto-1");

    expect(result.contentHistoryId).toBe("content-v");
    expect(admin.inserts.content_history[0]).toMatchObject({ run_id: "run-v", content_type: "shorts", video_path: "user-1/auto-1/run-v/final.mp4", video_duration_sec: 25, video_bytes: 4_000_000, video_checked_at: expect.any(String) });
  });

  it("does not store a Short twice when the run's content row already exists (unique run_id): the existing row is kept and updated", async () => {
    const admin = makeAdmin({
      automations: [{ data: AUTOMATION, error: null }, { data: null, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [noInFlight(), { data: { id: "run-d" }, error: null }, { data: null, error: null }],
      content_history: [
        { data: [], error: null },
        { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } },
        { data: { id: "content-first" }, error: null },
        { data: null, error: null },
      ],
    });
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    okHandler({ output: { ok: true }, content: "script", contentType: "shorts", video: { path: "user-1/auto-1/run-d/final.mp4", durationSec: 25, bytes: 1 } });

    const result = await runAutomationNow("auto-1");

    expect(result.status).toBe("SUCCESS");
    expect(result.contentHistoryId).toBe("content-first");
    expect(admin.inserts.content_history).toHaveLength(1);
    expect(admin.updates.content_history[0]).toMatchObject({ video_path: "user-1/auto-1/run-d/final.mp4" });
  });

  it("does not advance next_run_at for a manual Run Now, and tags source MANUAL", async () => {
    const admin = makeAdmin({
      automations: [{ data: AUTOMATION, error: null }, { data: null, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [noInFlight(), { data: { id: "run-2" }, error: null }, { data: null, error: null }],
      content_history: [{ data: [], error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    okHandler({ output: { ok: true } });

    const result = await runAutomationNow("auto-1");

    expect(result.status).toBe("SUCCESS");
    expect(admin.inserts.automation_runs[0]).toMatchObject({ source: "MANUAL" });
    // Only one automations write for a manual run — last_run_at at
    // completion — and it never touches next_run_at at all.
    expect(admin.updates.automations).toHaveLength(1);
    expect(admin.updates.automations[0]).not.toHaveProperty("next_run_at");
    expect(admin.updates.automations[0]).toMatchObject({ last_run_at: expect.any(String) });
  });

  it("passes a trusted calendar item to the handler and records it in the run input", async () => {
    const admin = makeAdmin({
      automations: [{ data: AUTOMATION, error: null }, { data: null, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [noInFlight(), { data: { id: "run-calendar" }, error: null }, { data: null, error: null }],
      content_history: [{ data: [], error: null }, { data: { id: "content-calendar" }, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    const run = okHandler({ output: { ok: true }, content: "calendar body", topic: "계획 주제" });
    const calendarItem = {
      id: "calendar-1",
      businessId: "biz-1",
      plannedDate: "2026-10-01",
      platform: "blog" as const,
      contentType: "정보성 블로그 글",
      topic: "계획 주제",
      goal: "상담 전환",
      summary: "상담 전 자주 묻는 질문 정리",
      cta: "상담 신청",
    };

    const result = await runAutomationNow("auto-1", { calendarItem });

    expect(result).toMatchObject({ status: "SUCCESS", contentHistoryId: "content-calendar" });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ calendarItem }));
    expect(admin.inserts.automation_runs[0]).toMatchObject({ input: { calendarItem } });
  });

  it("advances next_run_at at run START, before the handler is ever called — not at completion", async () => {
    const admin = makeAdmin({
      automations: [{ data: AUTOMATION, error: null }, { data: null, error: null }, { data: null, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [noInFlight(), { data: { id: "run-5" }, error: null }, { data: null, error: null }],
      content_history: [{ data: [], error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });

    let nextRunAtWhenHandlerRan: unknown;
    const run = vi.fn().mockImplementation(() => {
      // Capture the automations update recorded so far, from inside the
      // handler itself — proves the schedule was already advanced before
      // the (potentially slow) handler work even started.
      nextRunAtWhenHandlerRan = admin.updates.automations[0];
      return Promise.resolve({ output: { ok: true } });
    });
    getHandlerMock.mockReturnValue({ templateSlug: "blog-marketing", run });

    await runDueAutomation("auto-1");

    const expectedNext = computeNextRunAt(SCHEDULE).toISOString();
    expect(nextRunAtWhenHandlerRan).toMatchObject({ next_run_at: expectedNext });
    // Two separate automations writes: next_run_at at start, last_run_at at completion.
    expect(admin.updates.automations).toHaveLength(2);
    expect(admin.updates.automations[1]).toMatchObject({ last_run_at: expect.any(String) });
    expect(admin.updates.automations[1]).not.toHaveProperty("next_run_at");
  });
});

describe("runDueAutomation / runAutomationNow — refusal to run", () => {
  it("refuses a PAUSED automation without calling the handler or touching automation status", async () => {
    const pausedAutomation = { ...AUTOMATION, status: "PAUSED" };
    const admin = makeAdmin({
      automations: [{ data: pausedAutomation, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [{ data: { id: "refused-1" }, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);

    const result = await runAutomationNow("auto-1");

    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toContain("일시정지");
    expect(getHandlerMock).not.toHaveBeenCalled();
    expect(canExecuteAutomationMock).not.toHaveBeenCalled();
    expect(admin.inserts.automation_runs[0]).toMatchObject({ status: "FAILED", source: "MANUAL" });
    expect(admin.updates.automations).toBeUndefined();
  });

  it("refuses an ERROR automation without calling the handler", async () => {
    const erroredAutomation = { ...AUTOMATION, status: "ERROR" };
    const admin = makeAdmin({
      automations: [{ data: erroredAutomation, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [{ data: { id: "refused-2" }, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);

    const result = await runDueAutomation("auto-1");

    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toContain("오류 상태");
    expect(getHandlerMock).not.toHaveBeenCalled();
  });

  it("refuses a run when the plan entitlement check fails, before calling the handler, and advances next_run_at for a SCHEDULED run so it doesn't retry-storm the same slot", async () => {
    const admin = makeAdmin({
      automations: [{ data: AUTOMATION, error: null }, { data: null, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [{ data: { id: "refused-3" }, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: false, reason: "이용권이 없거나 모두 만료됐어요. 이용권을 구매하면 바로 만들 수 있어요." });

    const result = await runDueAutomation("auto-1");

    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toBe("이용권이 없거나 모두 만료됐어요. 이용권을 구매하면 바로 만들 수 있어요.");
    expect(getHandlerMock).not.toHaveBeenCalled();
    expect(reserveCreditMock).not.toHaveBeenCalled();
    const expectedNext = computeNextRunAt(SCHEDULE).toISOString();
    expect(admin.updates.automations[0]).toMatchObject({ next_run_at: expectedNext });
  });

  it("does not advance next_run_at when a MANUAL run is refused for a plan limit", async () => {
    const admin = makeAdmin({
      automations: [{ data: AUTOMATION, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [{ data: { id: "refused-4" }, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: false, reason: "한도를 초과했습니다." });

    const result = await runAutomationNow("auto-1");

    expect(result.status).toBe("FAILED");
    expect(admin.updates.automations).toBeUndefined();
  });

  it("records the exact purchase message when the last credit is lost in a reservation race", async () => {
    const admin = makeAdmin({
      automations: [{ data: AUTOMATION, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [noInFlight(), { data: { id: "run-no-credit" }, error: null }, { data: null, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    reserveCreditMock.mockRejectedValueOnce({ code: "P0001", message: "insufficient BLOG credits: missing 1" });

    const result = await runAutomationNow("auto-1");

    expect(result).toEqual({ runId: "run-no-credit", status: "FAILED", errorMessage: "이용권이 없거나 모두 만료됐어요. 이용권을 구매하면 바로 만들 수 있어요." });
    expect(admin.updates.automation_runs[0]).toMatchObject({ status: "FAILED", error_message: "이용권이 없거나 모두 만료됐어요. 이용권을 구매하면 바로 만들 수 있어요." });
    
    expect(admin.updates.automations).toBeUndefined();
  });

});

describe("runDueAutomation / runAutomationNow — duplicate-run guard", () => {
  it("refuses a manual Run Now double-click when a run is already QUEUED/RUNNING", async () => {
    const admin = makeAdmin({
      automations: [{ data: AUTOMATION, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [{ data: { id: "in-flight" }, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });

    await expect(runAutomationNow("auto-1")).rejects.toThrow("already has a run in progress");
    expect(getHandlerMock).not.toHaveBeenCalled();
  });

  it("refuses a concurrent scheduled tick when a run is already QUEUED/RUNNING", async () => {
    const admin = makeAdmin({
      automations: [{ data: AUTOMATION, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [{ data: { id: "in-flight" }, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });

    await expect(runDueAutomation("auto-1")).rejects.toThrow("already has a run in progress");
    expect(getHandlerMock).not.toHaveBeenCalled();
  });

  it("falls back to the DB's one-in-flight-run unique index when two near-simultaneous scheduled ticks both race past the app-level in-flight check", async () => {
    // Simulates the genuine race the app-level SELECT-then-INSERT check can't
    // close on its own: both ticks' in-flight SELECT runs before either has
    // inserted its RUNNING row, so both see "no in-flight run". The second
    // INSERT is what actually collides — on the real table this is
    // `automation_runs_one_inflight_idx` (0006_automation_runs.sql), reproduced
    // here as the Postgres unique-violation error the client resolves with
    // rather than throws.
    const admin = makeAdmin({
      automations: [{ data: AUTOMATION, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [
        noInFlight(),
        { data: null, error: { message: 'duplicate key value violates unique constraint "automation_runs_one_inflight_idx"' } },
      ],
    });
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });

    await expect(runDueAutomation("auto-1")).rejects.toThrow(/automation_runs_one_inflight_idx/);
  });
});

describe("runDueAutomation / runAutomationNow — exception isolation", () => {
  it("catches an exception the handler didn't anticipate, marks the run FAILED (never left RUNNING), and keeps the schedule alive", async () => {
    const admin = makeAdmin({
      automations: [{ data: AUTOMATION, error: null }, { data: null, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [noInFlight(), { data: { id: "run-3" }, error: null }, { data: null, error: null }],
      content_history: [{ data: [], error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    const run = vi.fn().mockRejectedValue(new Error("AI provider exploded"));
    getHandlerMock.mockReturnValue({ templateSlug: "blog-marketing", run });

    const result = await runDueAutomation("auto-1");

    expect(result).toEqual({ runId: "run-3", status: "FAILED", errorMessage: "AI provider exploded" });
    expect(admin.updates.automation_runs[0]).toMatchObject({ status: "FAILED", error_message: "AI provider exploded" });
    // updates.automations[0] is the next_run_at advance that already happened at run start (before the handler threw);
    // [1] counts the failure. One failed scheduled run does not stop the schedule: the status stays ACTIVE.
    expect(admin.updates.automations[0]).toMatchObject({ next_run_at: computeNextRunAt(SCHEDULE).toISOString() });
    expect(admin.updates.automations[1]).toEqual({ consecutive_failures: 1 });
    expect(incrementUsageMock).not.toHaveBeenCalled();
    expect(releaseCreditByReferenceMock).toHaveBeenCalledWith("run-3", "AI provider exploded");
  });

  it("parks the automation (ERROR) only after three scheduled runs in a row failed", async () => {
    const admin = makeAdmin({
      automations: [{ data: { ...AUTOMATION, consecutive_failures: 2 }, error: null }, { data: null, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [noInFlight(), { data: { id: "run-3b" }, error: null }, { data: null, error: null }],
      content_history: [{ data: [], error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    getHandlerMock.mockReturnValue({ templateSlug: "blog-marketing", run: vi.fn().mockRejectedValue(new Error("AI provider exploded")) });

    await runDueAutomation("auto-1");

    expect(admin.updates.automations[1]).toEqual({ consecutive_failures: 3, status: "ERROR" });
  });

  it("a failed manual run never counts against the schedule or parks it", async () => {
    const admin = makeAdmin({
      automations: [{ data: { ...AUTOMATION, consecutive_failures: 2 }, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [noInFlight(), { data: { id: "run-3c" }, error: null }, { data: null, error: null }],
      content_history: [{ data: [], error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    getHandlerMock.mockReturnValue({ templateSlug: "blog-marketing", run: vi.fn().mockRejectedValue(new Error("AI provider exploded")) });

    const result = await runAutomationNow("auto-1");

    expect(result.status).toBe("FAILED");
    expect(admin.updates.automations ?? []).toEqual([]);
  });

  it("a successful run resets the failure streak", async () => {
    const admin = makeAdmin({
      automations: [{ data: { ...AUTOMATION, consecutive_failures: 2 }, error: null }, { data: null, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [noInFlight(), { data: { id: "run-3d" }, error: null }, { data: null, error: null }],
      content_history: [{ data: [], error: null }, { data: { id: "ch-1" }, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    okHandler({ output: { ok: true }, content: "본문", title: "제목" });

    const result = await runDueAutomation("auto-1");

    expect(result.status).toBe("SUCCESS");
    expect(admin.updates.automations).toContainEqual(expect.objectContaining({ consecutive_failures: 0 }));
  });

  it("marks the run FAILED when the atomic SUCCESS/SETTLE RPC fails, instead of leaving it RUNNING", async () => {
    const admin = makeAdmin({
      automations: [{ data: AUTOMATION, error: null }, { data: null, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [noInFlight(), { data: { id: "run-4" }, error: null }, { data: null, error: null }],
      content_history: [{ data: [], error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    admin.rpc.mockResolvedValueOnce({ data: null, error: new Error("connection reset") });
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    okHandler({ output: { ok: true } });

    const result = await runDueAutomation("auto-1");

    expect(result.status).toBe("FAILED");
    expect(admin.updates.automation_runs[0]).toMatchObject({ status: "FAILED" });
    // [0] advances the schedule, [1] records last_run_at, and [2] counts the failure (the schedule stays ACTIVE).
    expect(admin.updates.automations[2]).toEqual({ consecutive_failures: 1 });
  });

  it("refuses blog and shorts runs until the owner has chosen what is promoted, without touching credits", async () => {
    const admin = makeAdmin({
      automations: [{ data: AUTOMATION, error: null }],
      businesses: [{ data: { ...BUSINESS, promotion_type: null }, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [{ data: { id: "refused-type" }, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);

    const result = await runAutomationNow("auto-1");

    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toContain("홍보 대상");
    expect(getHandlerMock).not.toHaveBeenCalled();
    expect(reserveCreditMock).not.toHaveBeenCalled();
  });

  it("refuses, without charging or parking the automation, when the handler says a service is not connected", async () => {
    const admin = makeAdmin({
      automations: [{ data: AUTOMATION, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [noInFlight(), { data: { id: "refused-preflight" }, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValue({ allowed: true });
    const run = vi.fn();
    getHandlerMock.mockReturnValue({ templateSlug: "blog-marketing", run, preflight: () => "영상 제작 서비스가 아직 연결되지 않았어요." });

    const result = await runAutomationNow("auto-1");

    expect(result).toMatchObject({ status: "FAILED", errorMessage: "영상 제작 서비스가 아직 연결되지 않았어요." });
    expect(run).not.toHaveBeenCalled();
    expect(reserveCreditMock).not.toHaveBeenCalled();
    expect(admin.updates.automations).toBeUndefined(); // not parked in ERROR
  });
});


describe("spend budget", () => {
  const meteredAdmin = (runId: string) => makeAdmin({
    automations: [{ data: AUTOMATION, error: null }, { data: null, error: null }],
    businesses: [{ data: BUSINESS, error: null }],
    automation_templates: [{ data: TEMPLATE, error: null }],
    automation_runs: [noInFlight(), { data: { id: runId }, error: null }, { data: null, error: null }],
    content_history: [{ data: [], error: null }, { data: { id: "content-1" }, error: null }],
  });
  const meteredHandler = (run: ReturnType<typeof vi.fn>) => getHandlerMock.mockReturnValue({ templateSlug: "blog-marketing", run, metered: () => "BLOG" });

  it("takes the period's item slot BEFORE reserving the credit, runs the handler inside a budget scope and completes the slot on success", async () => {
    createAdminClientMock.mockReturnValue(meteredAdmin("run-b1"));
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    meteredHandler(vi.fn().mockResolvedValue({ output: { ok: true }, content: "body", contentType: "blog", title: "T", topic: "Topic" }));

    const result = await runAutomationNow("auto-1");

    expect(result.status).toBe("SUCCESS");
    expect(budget.assertAllowed).toHaveBeenCalled();
    expect(budget.claim).toHaveBeenCalledWith("BLOG", "run-b1");
    expect(budget.claim.mock.invocationCallOrder[0]).toBeLessThan(reserveCreditMock.mock.invocationCallOrder[0]);
    expect(budget.scopes).toEqual([{ kind: "BLOG", runId: "run-b1", attempt: 1 }]);
    expect(budget.settleOpen).toHaveBeenCalledWith("run-b1", expect.any(String));
    expect(budget.closeRunItem).toHaveBeenCalledWith("run-b1", "COMPLETED");
    expect(budget.closeFailed).not.toHaveBeenCalled();
  });

  it("refuses with the budget's own words when the month has no room, without reserving a credit or parking the automation", async () => {
    const admin = meteredAdmin("run-b2");
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    const run = vi.fn();
    meteredHandler(run);
    budget.claim.mockRejectedValueOnce(new BudgetError("BUDGET_ITEM_LIMIT", "limit"));

    const result = await runAutomationNow("auto-1");

    expect(result).toEqual({ runId: "run-b2", status: "FAILED", errorMessage: expect.stringContaining("편수") });
    expect(result.errorMessage).toContain("이용권은 차감되지 않았어요");
    expect(run).not.toHaveBeenCalled();
    expect(reserveCreditMock).not.toHaveBeenCalled();
    expect(admin.updates.automations).toBeUndefined();
  });

  it("refuses before claiming when paid calls are switched off or frozen", async () => {
    createAdminClientMock.mockReturnValue(meteredAdmin("run-b3"));
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    meteredHandler(vi.fn());
    budget.assertAllowed.mockImplementationOnce(() => { throw new BudgetError("PAID_CALLS_DISABLED", "off"); });

    const result = await runAutomationNow("auto-1");

    expect(result.errorMessage).toContain("AI 제작 서비스");
    expect(budget.claim).not.toHaveBeenCalled();
    expect(reserveCreditMock).not.toHaveBeenCalled();
  });

  it("gives the slot back and refunds the credit when the handler fails, and books open reservations as spent", async () => {
    const admin = meteredAdmin("run-b4");
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    meteredHandler(vi.fn().mockRejectedValue(new Error("AI provider exploded")));

    const result = await runAutomationNow("auto-1");

    expect(result.status).toBe("FAILED");
    expect(budget.closeFailed).toHaveBeenCalledWith("run-b4", expect.stringContaining("AI provider exploded"));
    expect(releaseCreditByReferenceMock).toHaveBeenCalledWith("run-b4", "AI provider exploded");
    expect(budget.closeRunItem).not.toHaveBeenCalled();
  });

  it("shows a budget refusal in the middle of a run in plain Korean and does not park the automation in ERROR", async () => {
    const admin = meteredAdmin("run-b5");
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    meteredHandler(vi.fn().mockRejectedValue(new BudgetError("BUDGET_CAP_EXCEEDED", "cap")));

    const result = await runAutomationNow("auto-1");

    expect(result.errorMessage).toContain("제작 예산");
    expect(admin.updates.automation_runs[0]).toMatchObject({ status: "FAILED", error_message: expect.stringContaining("제작 예산") });
    expect(admin.updates.automations ?? []).not.toContainEqual({ status: "ERROR" });
    expect(releaseCreditByReferenceMock).toHaveBeenCalled();
  });

  it("gives the slot back when the last credit is lost in a race", async () => {
    createAdminClientMock.mockReturnValue(meteredAdmin("run-b6"));
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    meteredHandler(vi.fn());
    reserveCreditMock.mockRejectedValueOnce({ code: "P0001", message: "insufficient BLOG credits: missing 1" });

    const result = await runAutomationNow("auto-1");

    expect(result.status).toBe("FAILED");
    expect(budget.releaseItem).toHaveBeenCalledWith("BLOG", "run-b6");
  });

  it("does not touch the ledger for a handler that costs nothing (a mock provider, a re-publish)", async () => {
    createAdminClientMock.mockReturnValue(meteredAdmin("run-b7"));
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    okHandler({ output: { ok: true }, content: "body", contentType: "blog", title: "T", topic: "Topic" });
    getHandlerMock.mockReturnValue({ templateSlug: "blog-marketing", run: vi.fn().mockResolvedValue({ output: { ok: true } }), metered: () => null });

    await runAutomationNow("auto-1");

    expect(budget.claim).not.toHaveBeenCalled();
    expect(budget.assertAllowed).not.toHaveBeenCalled();
    expect(budget.closeRunItem).not.toHaveBeenCalled();
    expect(budget.scopes).toEqual([]);
  });
});

describe("runDueAutomation: taking the due slot", () => {
  const due = { id: "auto-1", schedule: SCHEDULE, next_run_at: "2026-10-20T00:00:00.000Z" };

  it("does nothing when another tick already took the slot (no run row, no credit, no handler)", async () => {
    const admin = makeAdmin({ automations: [{ data: [], error: null }] });
    createAdminClientMock.mockReturnValue(admin);

    const result = await runDueAutomation("auto-1", due, new Date("2026-10-20T00:05:00.000Z"));

    expect(result).toEqual({ runId: "", status: "SKIPPED" });
    expect(admin.inserts.automation_runs).toBeUndefined();
    expect(getHandlerMock).not.toHaveBeenCalled();
    expect(reserveCreditMock).not.toHaveBeenCalled();
    // the claim moved next_run_at to the next slot, guarded by the value the tick read
    expect(admin.updates.automations[0]).toEqual({ next_run_at: computeNextRunAt(SCHEDULE, new Date("2026-10-20T00:05:00.000Z")).toISOString() });
    expect(admin.filters.automations).toContainEqual(["next_run_at", "2026-10-20T00:00:00.000Z"]);
  });

  it("runs a slot that was missed for a short while exactly once (catch-up)", async () => {
    const admin = makeAdmin({
      automations: [{ data: [{ id: "auto-1" }], error: null }, { data: { ...AUTOMATION, next_run_at: due.next_run_at }, error: null }, { data: null, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [noInFlight(), { data: { id: "run-c" }, error: null }, { data: null, error: null }],
      content_history: [{ data: [], error: null }, { data: { id: "ch-c" }, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    const run = okHandler({ output: { ok: true }, content: "본문", title: "제목" });

    // two hours after the slot: the scheduler was down, still inside the catch-up window
    const result = await runDueAutomation("auto-1", due, new Date("2026-10-20T02:00:00.000Z"));

    expect(result.status).toBe("SUCCESS");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("skips and records a slot missed for more than 12 hours instead of producing content on the wrong day", async () => {
    const admin = makeAdmin({
      automations: [{ data: [{ id: "auto-1" }], error: null }, { data: { ...AUTOMATION, next_run_at: due.next_run_at }, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [{ data: { id: "run-skip" }, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);

    const result = await runDueAutomation("auto-1", due, new Date("2026-10-21T03:00:00.000Z")); // 27 h late

    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toContain("건너뛰었어요");
    expect(getHandlerMock).not.toHaveBeenCalled();
    expect(reserveCreditMock).not.toHaveBeenCalled();
    expect(admin.inserts.automation_runs[0]).toMatchObject({ source: "SCHEDULED", status: "FAILED" });
    // a skipped slot is not a failure of the automation: no failure count, no parking
    expect(admin.updates.automations).toHaveLength(1);
  });
});
