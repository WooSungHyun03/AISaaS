import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, createAdminClientMock, loggerMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/logger", () => ({ logger: loggerMock }));

const { recordDiagnosisAttempt, DiagnosisRateLimitError } = await import("./diagnosis-rate-limit");

const NOW = new Date("2026-10-10T12:00:00.000Z");

/** select("id", {count, head:true}).eq().gte() has no terminal single()/maybeSingle() — the chain itself is awaited, so it must be thenable. */
function makeCountBuilder(result: { count: number | null; error: unknown }) {
  const builder = {
    eq: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function makeClient({ countResult, insertResult = { error: null } }: { countResult: { count: number | null; error: unknown }; insertResult?: { error: unknown } }) {
  const insertSpy = vi.fn().mockResolvedValue(insertResult);
  const table = { select: vi.fn(() => makeCountBuilder(countResult)), insert: insertSpy };
  return { from: vi.fn(() => table), insertSpy };
}

function makeAdminClient(deleteResult: { error: unknown } = { error: null }) {
  const ltSpy = vi.fn().mockResolvedValue(deleteResult);
  const deleteSpy = vi.fn(() => ({ lt: ltSpy }));
  const table = { delete: deleteSpy };
  return { from: vi.fn(() => table), deleteSpy, ltSpy };
}

beforeEach(() => {
  createAdminClientMock.mockReturnValue(makeAdminClient());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordDiagnosisAttempt", () => {
  it("records a new attempt when under the hourly limit", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99); // skip the opportunistic cleanup sweep
    const client = makeClient({ countResult: { count: 2, error: null } });
    createClientMock.mockResolvedValue(client);

    await recordDiagnosisAttempt("business-1", NOW);

    expect(client.insertSpy).toHaveBeenCalledWith({ business_id: "business-1", created_at: NOW.toISOString() });
  });

  it("throws DiagnosisRateLimitError and does not insert when already at the hourly limit", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const client = makeClient({ countResult: { count: 5, error: null } });
    createClientMock.mockResolvedValue(client);

    await expect(recordDiagnosisAttempt("business-1", NOW)).rejects.toBeInstanceOf(DiagnosisRateLimitError);
    expect(client.insertSpy).not.toHaveBeenCalled();
  });

  it("throws ChannelsError when the count query fails", async () => {
    const client = makeClient({ countResult: { count: null, error: new Error("boom") } });
    createClientMock.mockResolvedValue(client);

    await expect(recordDiagnosisAttempt("business-1", NOW)).rejects.toMatchObject({ name: "ChannelsError", code: "DATABASE_ERROR" });
  });

  it("throws ChannelsError when the insert fails", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const client = makeClient({ countResult: { count: 0, error: null }, insertResult: { error: new Error("boom") } });
    createClientMock.mockResolvedValue(client);

    await expect(recordDiagnosisAttempt("business-1", NOW)).rejects.toMatchObject({ name: "ChannelsError", code: "DATABASE_ERROR" });
  });

  it("sweeps old rows via the service-role client when the cleanup roll succeeds", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // always below CLEANUP_PROBABILITY
    const client = makeClient({ countResult: { count: 0, error: null } });
    createClientMock.mockResolvedValue(client);
    const admin = makeAdminClient();
    createAdminClientMock.mockReturnValue(admin);

    await recordDiagnosisAttempt("business-1", NOW);

    expect(admin.deleteSpy).toHaveBeenCalledTimes(1);
    expect(admin.ltSpy).toHaveBeenCalledWith("created_at", new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString());
  });

  it("does not sweep when the cleanup roll misses", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const client = makeClient({ countResult: { count: 0, error: null } });
    createClientMock.mockResolvedValue(client);
    const admin = makeAdminClient();
    createAdminClientMock.mockReturnValue(admin);

    await recordDiagnosisAttempt("business-1", NOW);

    expect(admin.deleteSpy).not.toHaveBeenCalled();
  });

  it("swallows a cleanup failure instead of failing the caller's attempt", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const client = makeClient({ countResult: { count: 0, error: null } });
    createClientMock.mockResolvedValue(client);
    createAdminClientMock.mockReturnValue(makeAdminClient({ error: new Error("cleanup boom") }));

    await expect(recordDiagnosisAttempt("business-1", NOW)).resolves.toBeUndefined();
    expect(loggerMock.warn).toHaveBeenCalledWith("channel_diagnosis_attempts_cleanup_failed", expect.objectContaining({ message: expect.stringContaining("cleanup boom") }));
  });
});
