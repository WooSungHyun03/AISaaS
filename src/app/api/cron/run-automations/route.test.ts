import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findDueMock, runDueMock, reapMock, advanceMock, envState } = vi.hoisted(() => ({
  findDueMock: vi.fn(),
  runDueMock: vi.fn(),
  reapMock: vi.fn(),
  advanceMock: vi.fn(),
  envState: { CRON_SECRET: "test-cron-secret" as string | undefined },
}));

vi.mock("@/lib/env/server", () => ({ serverEnv: envState }));
vi.mock("@/server/automations", () => ({ findDueAutomations: findDueMock, runDueAutomation: runDueMock, reapStaleRuns: reapMock, advanceDeferredRuns: advanceMock }));

const { POST } = await import("./route");

const request = (secret?: string) =>
  new Request("http://localhost/api/cron/run-automations", { method: "POST", headers: secret ? { "x-cron-secret": secret } : {} });

beforeEach(() => {
  envState.CRON_SECRET = "test-cron-secret";
  reapMock.mockResolvedValue(0);
  advanceMock.mockResolvedValue([]);
  findDueMock.mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("POST /api/cron/run-automations", () => {
  it("rejects a missing or wrong secret without touching the database", async () => {
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request("wrong"))).status).toBe(401);
    expect(findDueMock).not.toHaveBeenCalled();
    expect(reapMock).not.toHaveBeenCalled();
  });

  it("rejects every request when CRON_SECRET is not configured", async () => {
    envState.CRON_SECRET = undefined;
    expect((await POST(request("anything"))).status).toBe(401);
    expect((await POST(request(""))).status).toBe(401);
  });

  it("reaps abandoned runs first, then runs each due automation", async () => {
    findDueMock.mockResolvedValue([{ id: "a-1" }, { id: "a-2" }]);
    runDueMock.mockResolvedValue({ runId: "r", status: "SUCCESS" });

    const response = await POST(request("test-cron-secret"));

    expect(reapMock.mock.invocationCallOrder[0]).toBeLessThan(findDueMock.mock.invocationCallOrder[0]);
    expect(await response.json()).toMatchObject({ processed: 2 });
    expect(runDueMock).toHaveBeenCalledTimes(2);
  });

  it("keeps going when reaping or one run fails", async () => {
    reapMock.mockRejectedValue(new Error("db down"));
    findDueMock.mockResolvedValue([{ id: "a-1" }, { id: "a-2" }]);
    runDueMock.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ runId: "r", status: "SUCCESS" });

    const body = await (await POST(request("test-cron-secret"))).json();

    expect(body.processed).toBe(2);
    expect(body.results[0]).toMatchObject({ automationId: "a-1", status: "FAILED" });
  });

  it("stops starting new automations once the tick's time budget is spent (the rest stay due)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
    findDueMock.mockResolvedValue([{ id: "a-1" }, { id: "a-2" }, { id: "a-3" }]);
    runDueMock.mockImplementation(async () => {
      vi.setSystemTime(new Date(Date.now() + 40_000)); // each run "takes" 40s (budget is 70s from the start of the tick)
      return { runId: "r", status: "SUCCESS" };
    });

    const body = await (await POST(request("test-cron-secret"))).json();

    expect(runDueMock).toHaveBeenCalledTimes(2); // started at 0s and 40s; at 80s the 70s budget is spent
    expect(body.processed).toBe(2);
  });

  it("advances in-flight deferred runs before starting due automations, and a failure there does not stop the tick", async () => {
    const order: string[] = [];
    advanceMock.mockImplementation(async () => (order.push("advance"), [{ runId: "r1", status: "RUNNING" }]));
    findDueMock.mockResolvedValue([{ id: "a-1" }]);
    runDueMock.mockImplementation(async () => (order.push("run"), { runId: "r", status: "RUNNING" }));

    const body = await (await POST(request("test-cron-secret"))).json();

    expect(order).toEqual(["advance", "run"]);
    expect(body).toMatchObject({ advanced: 1, processed: 1 });

    advanceMock.mockRejectedValueOnce(new Error("db down"));
    const second = await (await POST(request("test-cron-secret"))).json();
    expect(second).toMatchObject({ advanced: 0, processed: 1 });
  });
});
