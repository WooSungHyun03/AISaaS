import { afterEach, describe, expect, it, vi } from "vitest";
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
}));

const { runAutomationNow, runDueAutomation } = await import("./runner");

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
  const from = vi.fn((table: string) => {
    const queue = tableQueues[table];
    const result: Result = queue && queue.length > 0 ? queue.shift()! : { data: null, error: null };
    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
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
  return { from, inserts, updates };
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

const BUSINESS = { id: "biz-1", owner_id: "user-1", name: "Test Biz" };
const TEMPLATE = { id: "tmpl-1", slug: "blog-marketing", name: "Blog Marketing", is_active: true };

function noInFlight(): Result {
  return { data: null, error: null };
}

function okHandler(result: Record<string, unknown> = { output: { ok: true } }) {
  const run = vi.fn().mockResolvedValue(result);
  getHandlerMock.mockReturnValue({ templateSlug: "blog-marketing", run });
  return run;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("runDueAutomation / runAutomationNow — happy path", () => {
  it("tags a scheduled run with source SCHEDULED and advances next_run_at on success", async () => {
    const admin = makeAdmin({
      automations: [{ data: AUTOMATION, error: null }, { data: null, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [noInFlight(), { data: { id: "run-1" }, error: null }, { data: null, error: null }],
      content_history: [{ data: [], error: null }, { data: null, error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    okHandler({ output: { ok: true }, content: "body", contentType: "blog", title: "T", topic: "Topic" });

    const result = await runDueAutomation("auto-1");

    expect(result).toEqual({ runId: "run-1", status: "SUCCESS", output: { ok: true } });
    expect(admin.inserts.automation_runs[0]).toMatchObject({ automation_id: "auto-1", status: "RUNNING", source: "SCHEDULED" });
    const expectedNext = computeNextRunAt(SCHEDULE).toISOString();
    expect(admin.updates.automations[0]).toMatchObject({ next_run_at: expectedNext });
    expect(incrementUsageMock).toHaveBeenCalledWith(admin, "user-1", { automationRuns: 1, aiGenerations: 1 });
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
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: false, reason: "STARTER 플랜의 이번 달 실행 한도(30회)를 모두 사용했습니다." });

    const result = await runDueAutomation("auto-1");

    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toBe("STARTER 플랜의 이번 달 실행 한도(30회)를 모두 사용했습니다.");
    expect(getHandlerMock).not.toHaveBeenCalled();
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
    expect(getHandlerMock).not.toHaveBeenCalled();
  });
});

describe("runDueAutomation / runAutomationNow — exception isolation", () => {
  it("catches an exception the handler didn't anticipate, marks the run FAILED (never left RUNNING), and marks the automation ERROR", async () => {
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
    // updates.automations[0] is the next_run_at advance that already happened
    // at run start (before the handler threw); [1] is the ERROR status write.
    expect(admin.updates.automations[0]).toMatchObject({ next_run_at: computeNextRunAt(SCHEDULE).toISOString() });
    expect(admin.updates.automations[1]).toMatchObject({ status: "ERROR" });
    expect(incrementUsageMock).not.toHaveBeenCalled();
  });

  it("marks the run FAILED when persisting the SUCCESS status itself fails, instead of leaving it RUNNING", async () => {
    const admin = makeAdmin({
      automations: [{ data: AUTOMATION, error: null }, { data: null, error: null }],
      businesses: [{ data: BUSINESS, error: null }],
      automation_templates: [{ data: TEMPLATE, error: null }],
      automation_runs: [
        noInFlight(),
        { data: { id: "run-4" }, error: null },
        { data: null, error: { message: "connection reset" } },
        { data: null, error: null },
      ],
      content_history: [{ data: [], error: null }],
    });
    createAdminClientMock.mockReturnValue(admin);
    canExecuteAutomationMock.mockResolvedValueOnce({ allowed: true });
    okHandler({ output: { ok: true } });

    const result = await runDueAutomation("auto-1");

    expect(result.status).toBe("FAILED");
    expect(admin.updates.automation_runs[1]).toMatchObject({ status: "FAILED" });
    // [0] is the run-start next_run_at advance; [1] is the ERROR status write
    // from the catch block once persisting SUCCESS itself failed.
    expect(admin.updates.automations[1]).toMatchObject({ status: "ERROR" });
  });
});
