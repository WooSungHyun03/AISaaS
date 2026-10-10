import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { processDueMock, cleanupMock, envState } = vi.hoisted(() => ({
  processDueMock: vi.fn(),
  cleanupMock: vi.fn(),
  envState: { CRON_SECRET: "test-cron-secret" as string | undefined },
}));

vi.mock("@/lib/env/server", () => ({ serverEnv: envState }));
vi.mock("@/server/channels/collect-pipeline", () => ({ processDueChannels: processDueMock, cleanupOldSnapshots: cleanupMock }));

const { POST } = await import("./route");

const request = (secret?: string) =>
  new Request("http://localhost/api/cron/collect-metrics", { method: "POST", headers: secret ? { "x-cron-secret": secret } : {} });

beforeEach(() => {
  envState.CRON_SECRET = "test-cron-secret";
  cleanupMock.mockResolvedValue(0);
  processDueMock.mockResolvedValue({ processed: 0, failed: 0, paused: 0 });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/cron/collect-metrics", () => {
  it("rejects a missing or wrong secret without touching the database", async () => {
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request("wrong"))).status).toBe(401);
    expect(cleanupMock).not.toHaveBeenCalled();
    expect(processDueMock).not.toHaveBeenCalled();
  });

  it("rejects every request when CRON_SECRET is not configured", async () => {
    envState.CRON_SECRET = undefined;
    expect((await POST(request("anything"))).status).toBe(401);
  });

  it("cleans up old snapshots, then processes due channels, and reports both", async () => {
    cleanupMock.mockResolvedValue(12);
    processDueMock.mockResolvedValue({ processed: 3, failed: 1, paused: 0 });

    const response = await POST(request("test-cron-secret"));
    const body = await response.json();

    expect(cleanupMock.mock.invocationCallOrder[0]).toBeLessThan(processDueMock.mock.invocationCallOrder[0]);
    expect(body).toEqual({ processed: 3, failed: 1, paused: 0, cleaned: 12 });
  });

  it("still processes due channels even if cleanup fails", async () => {
    cleanupMock.mockRejectedValue(new Error("db down"));
    processDueMock.mockResolvedValue({ processed: 1, failed: 0, paused: 0 });

    const body = await (await POST(request("test-cron-secret"))).json();
    expect(body).toEqual({ processed: 1, failed: 0, paused: 0, cleaned: 0 });
  });
});
