import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, diagnoseChannelMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  diagnoseChannelMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("./diagnose", () => ({ diagnoseChannel: diagnoseChannelMock }));

const { registerAndDiagnoseChannel } = await import("./register");

const SAMPLE_DIAGNOSIS = {
  channel: "youtube",
  overallScore: 70,
  activityScore: 70,
  consistencyScore: 70,
  contentScore: 70,
  metrics: {},
  findings: [],
  recommendations: [],
  dataSource: "mock",
  collectedAt: "2026-10-10T00:00:00.000Z",
  completeness: "COMPLETE",
};

function makeTrackedChannelsTable({
  selectResult,
  insertResult,
  reselectResult,
}: {
  selectResult: { data: unknown; error: unknown };
  insertResult?: { data: unknown; error: unknown };
  reselectResult?: { data: unknown; error: unknown };
}) {
  const selectChain = {
    eq: vi.fn(() => selectChain),
    maybeSingle: vi.fn().mockResolvedValue(selectResult),
    single: vi.fn().mockResolvedValue(reselectResult ?? selectResult),
  };
  const insertSingleChain = { single: vi.fn().mockResolvedValue(insertResult) };
  const insertChain = { select: vi.fn(() => insertSingleChain) };
  const insertSpy = vi.fn(() => insertChain);
  return { select: vi.fn(() => selectChain), insert: insertSpy, selectChain, insertSpy };
}

function makeClient({
  trackedChannels,
  businessResult = { data: { name: "우리동네 빵집" }, error: null },
}: {
  trackedChannels: ReturnType<typeof makeTrackedChannelsTable>;
  businessResult?: { data: unknown; error: unknown };
}) {
  const businessesTable = { select: vi.fn(() => businessesTable), eq: vi.fn(() => businessesTable), maybeSingle: vi.fn().mockResolvedValue(businessResult) };
  const from = vi.fn((name: string) => (name === "businesses" ? businessesTable : trackedChannels));
  return { from };
}

beforeEach(() => {
  diagnoseChannelMock.mockResolvedValue(SAMPLE_DIAGNOSIS);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("registerAndDiagnoseChannel", () => {
  it("returns ok: false without touching Supabase when the URL can't be parsed", async () => {
    const result = await registerAndDiagnoseChannel("business-1", "not a url at all###");
    expect(result).toMatchObject({ ok: false });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("creates a new tracked_channels row when none exists yet, then diagnoses it", async () => {
    const insertedRow = { id: "channel-1", external_id: "@mychannel", url: "https://youtube.com/@mychannel", platform: "youtube" };
    const trackedChannels = makeTrackedChannelsTable({ selectResult: { data: null, error: null }, insertResult: { data: insertedRow, error: null } });
    createClientMock.mockResolvedValue(makeClient({ trackedChannels }));

    const result = await registerAndDiagnoseChannel("business-1", "https://youtube.com/@mychannel");

    expect(trackedChannels.insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ business_id: "business-1", platform: "youtube", external_id: "@mychannel" }),
    );
    expect(diagnoseChannelMock).toHaveBeenCalledWith(
      { id: "channel-1", business_id: "business-1", external_id: "@mychannel", url: "https://youtube.com/@mychannel", platform: "youtube" },
      "우리동네 빵집",
    );
    expect(result).toEqual({ ok: true, channelId: "channel-1", diagnosis: SAMPLE_DIAGNOSIS });
  });

  it("reuses an existing tracked_channels row instead of inserting a duplicate", async () => {
    const existingRow = { id: "channel-9", external_id: "@mychannel", url: "https://youtube.com/@mychannel", platform: "youtube" };
    const trackedChannels = makeTrackedChannelsTable({ selectResult: { data: existingRow, error: null } });
    createClientMock.mockResolvedValue(makeClient({ trackedChannels }));

    const result = await registerAndDiagnoseChannel("business-1", "https://youtube.com/@mychannel");

    expect(trackedChannels.insertSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, channelId: "channel-9" });
  });

  it("re-selects instead of failing when a concurrent request already inserted the same channel (unique violation)", async () => {
    const raceWinnerRow = { id: "channel-9", external_id: "@mychannel", url: "https://youtube.com/@mychannel", platform: "youtube" };
    const trackedChannels = makeTrackedChannelsTable({
      selectResult: { data: null, error: null },
      insertResult: { data: null, error: { code: "23505", message: "duplicate key" } },
      reselectResult: { data: raceWinnerRow, error: null },
    });
    createClientMock.mockResolvedValue(makeClient({ trackedChannels }));

    const result = await registerAndDiagnoseChannel("business-1", "https://youtube.com/@mychannel");
    expect(result).toMatchObject({ ok: true, channelId: "channel-9" });
  });

  it("passes platformHint through to the URL parser for a host it can't classify on its own", async () => {
    const insertedRow = { id: "channel-5", external_id: "blog.mycustomdomain.com", url: "https://blog.mycustomdomain.com/", platform: "tistory" };
    const trackedChannels = makeTrackedChannelsTable({ selectResult: { data: null, error: null }, insertResult: { data: insertedRow, error: null } });
    createClientMock.mockResolvedValue(makeClient({ trackedChannels }));

    await registerAndDiagnoseChannel("business-1", "https://blog.mycustomdomain.com", "tistory");

    expect(trackedChannels.insertSpy).toHaveBeenCalledWith(expect.objectContaining({ platform: "tistory", external_id: "blog.mycustomdomain.com" }));
  });

  it("throws ChannelsError when the existence check fails", async () => {
    const trackedChannels = makeTrackedChannelsTable({ selectResult: { data: null, error: new Error("boom") } });
    createClientMock.mockResolvedValue(makeClient({ trackedChannels }));

    await expect(registerAndDiagnoseChannel("business-1", "https://youtube.com/@mychannel")).rejects.toMatchObject({ name: "ChannelsError", code: "DATABASE_ERROR" });
  });

  it("throws ChannelsError when insert fails for a reason other than a unique violation", async () => {
    const trackedChannels = makeTrackedChannelsTable({
      selectResult: { data: null, error: null },
      insertResult: { data: null, error: { code: "42501", message: "rls denied" } },
    });
    createClientMock.mockResolvedValue(makeClient({ trackedChannels }));

    await expect(registerAndDiagnoseChannel("business-1", "https://youtube.com/@mychannel")).rejects.toMatchObject({ name: "ChannelsError", code: "DATABASE_ERROR" });
  });

  it("propagates diagnoseChannel's own error without swallowing it", async () => {
    const insertedRow = { id: "channel-1", external_id: "@mychannel", url: "https://youtube.com/@mychannel", platform: "youtube" };
    const trackedChannels = makeTrackedChannelsTable({ selectResult: { data: null, error: null }, insertResult: { data: insertedRow, error: null } });
    createClientMock.mockResolvedValue(makeClient({ trackedChannels }));
    diagnoseChannelMock.mockRejectedValueOnce(new Error("provider down"));

    await expect(registerAndDiagnoseChannel("business-1", "https://youtube.com/@mychannel")).rejects.toThrow("provider down");
  });
});
