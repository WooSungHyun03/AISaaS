import { afterEach, describe, expect, it, vi } from "vitest";

const { createClientMock, collectAndPersistChannelMock, recordCollectionFailureMock, startRunMock, finishRunMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  collectAndPersistChannelMock: vi.fn().mockResolvedValue({ status: "SUCCESS", metricsSaved: 3, contentSaved: 1 }),
  recordCollectionFailureMock: vi.fn().mockResolvedValue(undefined),
  startRunMock: vi.fn().mockResolvedValue("run-1"),
  finishRunMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("./collect-pipeline", () => ({ collectAndPersistChannel: collectAndPersistChannelMock }));
vi.mock("./persist", async (importOriginal) => ({ ...(await importOriginal<typeof import("./persist")>()), recordCollectionFailure: recordCollectionFailureMock }));
vi.mock("./collection-runs", () => ({ startCollectionRun: startRunMock, finishCollectionRun: finishRunMock }));

const { collectChannelNow } = await import("./collect-now");

const NOW = new Date("2026-10-10T12:00:00.000Z"); // KST 2026-10-10 21:00

function makeClient({
  channel = { id: "channel-1", business_id: "business-1", platform: "youtube", external_id: "@x", url: "" },
  channelError = null as unknown,
  existingSnapshot = null as unknown,
  snapshotCheckError = null as unknown,
}: {
  channel?: Record<string, unknown> | null;
  channelError?: unknown;
  existingSnapshot?: unknown;
  snapshotCheckError?: unknown;
} = {}) {
  const channelMaybeSingle = vi.fn().mockResolvedValue({ data: channel, error: channelError });
  const channelEq = vi.fn(() => ({ maybeSingle: channelMaybeSingle }));
  const channelSelect = vi.fn(() => ({ eq: channelEq }));

  const snapshotMaybeSingle = vi.fn().mockResolvedValue({ data: existingSnapshot, error: snapshotCheckError });
  const snapshotLimit = vi.fn(() => ({ maybeSingle: snapshotMaybeSingle }));
  const snapshotEqDate = vi.fn(() => ({ limit: snapshotLimit }));
  const snapshotEqChannel = vi.fn(() => ({ eq: snapshotEqDate }));
  const snapshotSelect = vi.fn(() => ({ eq: snapshotEqChannel }));

  const businessMaybeSingle = vi.fn().mockResolvedValue({ data: { name: "사업체" }, error: null });
  const businessEq = vi.fn(() => ({ maybeSingle: businessMaybeSingle }));
  const businessSelect = vi.fn(() => ({ eq: businessEq }));

  const from = vi.fn((table: string) => {
    if (table === "tracked_channels") return { select: channelSelect };
    if (table === "marketing_metric_snapshots") return { select: snapshotSelect };
    return { select: businessSelect };
  });

  return { from, snapshotEqDate };
}

afterEach(() => {
  vi.clearAllMocks();
  collectAndPersistChannelMock.mockResolvedValue({ status: "SUCCESS", metricsSaved: 3, contentSaved: 1 });
});

describe("collectChannelNow", () => {
  it("collects when no snapshot exists yet today (KST)", async () => {
    const client = makeClient();
    createClientMock.mockResolvedValue(client);

    const result = await collectChannelNow("channel-1", NOW);

    expect(result).toEqual({ status: "collected" });
    expect(collectAndPersistChannelMock).toHaveBeenCalledTimes(1);
    expect(client.snapshotEqDate).toHaveBeenCalledWith("recorded_date", "2026-10-10");
  });

  it("refuses (server-side) without collecting when a snapshot already exists today, regardless of UI state", async () => {
    const client = makeClient({ existingSnapshot: { id: "existing-snapshot" } });
    createClientMock.mockResolvedValue(client);

    const result = await collectChannelNow("channel-1", NOW);

    expect(result).toEqual({ status: "already_collected_today" });
    expect(collectAndPersistChannelMock).not.toHaveBeenCalled();
  });

  it("throws when the channel doesn't exist (or isn't the caller's, per RLS)", async () => {
    const client = makeClient({ channel: null });
    createClientMock.mockResolvedValue(client);
    await expect(collectChannelNow("channel-1", NOW)).rejects.toMatchObject({ name: "ChannelsError", code: "DATABASE_ERROR" });
  });

  it("throws ChannelsError when the channel lookup query fails", async () => {
    const client = makeClient({ channelError: new Error("boom") });
    createClientMock.mockResolvedValue(client);
    await expect(collectChannelNow("channel-1", NOW)).rejects.toMatchObject({ code: "DATABASE_ERROR" });
  });

  it("throws ChannelsError when the today's-snapshot check fails", async () => {
    const client = makeClient({ snapshotCheckError: new Error("boom") });
    createClientMock.mockResolvedValue(client);
    await expect(collectChannelNow("channel-1", NOW)).rejects.toMatchObject({ code: "DATABASE_ERROR" });
  });

  it("logs the manual run, and a blog with no public data is reported as unavailable (not collected)", async () => {
    createClientMock.mockResolvedValue(makeClient());
    collectAndPersistChannelMock.mockResolvedValue({ status: "UNAVAILABLE", metricsSaved: 0, contentSaved: 0 });

    const result = await collectChannelNow("channel-1", NOW);

    expect(result).toEqual({ status: "unavailable" });
    expect(startRunMock).toHaveBeenCalledWith(expect.objectContaining({ trigger: "MANUAL_USER" }));
    expect(finishRunMock).toHaveBeenCalledWith("run-1", expect.objectContaining({ total: 1, succeeded: 0, failed: 1 }));
  });

  it("records a collector failure on the channel, closes the run as failed and rethrows", async () => {
    createClientMock.mockResolvedValue(makeClient());
    collectAndPersistChannelMock.mockRejectedValue(new Error("boom"));

    await expect(collectChannelNow("channel-1", NOW)).rejects.toThrow("boom");

    expect(recordCollectionFailureMock).toHaveBeenCalledWith("channel-1", expect.any(Error), NOW);
    expect(finishRunMock).toHaveBeenCalledWith("run-1", expect.objectContaining({ failed: 1, errorSummary: "boom" }));
  });
});
