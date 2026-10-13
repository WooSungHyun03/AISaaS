import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb } from "@/test/fake-db";

const { createClientMock, diagnoseChannelMock, resolveMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  diagnoseChannelMock: vi.fn(),
  resolveMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("./diagnose", () => ({ diagnoseChannel: diagnoseChannelMock }));
vi.mock("./preview", () => ({ resolveParsedChannel: resolveMock }));

const { registerAndDiagnoseChannel } = await import("./register");

const SAMPLE_DIAGNOSIS = { channel: "youtube", overallScore: 70, activityScore: 70, consistencyScore: 70, contentScore: 70, metrics: {}, findings: [], recommendations: [], dataSource: "mock", collectedAt: "2026-10-10T00:00:00.000Z", completeness: "COMPLETE" };
const UC = "UCabcdefghijklmnopqrstuv";

const resolvedYouTube = (overrides: Record<string, unknown> = {}) => ({
  ok: true as const,
  preview: { platform: "youtube", externalId: UC, normalizedUrl: "https://youtube.com/@mychannel", displayName: "우리 채널", thumbnailUrl: "https://yt3.ggpht.com/m", summary: "구독자 1,200명", verified: true, note: null, ...overrides },
});

function useDb(seed: Record<string, Record<string, unknown>[]> = {}) {
  const db = makeFakeDb({ businesses: [{ id: "business-1", name: "우리동네 빵집" }], ...seed });
  createClientMock.mockResolvedValue(db.client);
  return db;
}

beforeEach(() => {
  diagnoseChannelMock.mockResolvedValue(SAMPLE_DIAGNOSIS);
  resolveMock.mockResolvedValue(resolvedYouTube());
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("registerAndDiagnoseChannel: hourly diagnosis limit", () => {
  it("keeps the channel saved and succeeds without a diagnosis instead of failing half-way", async () => {
    const db = useDb();
    const { DiagnosisRateLimitError } = await import("./diagnosis-rate-limit");
    diagnoseChannelMock.mockRejectedValue(new DiagnosisRateLimitError());

    const result = await registerAndDiagnoseChannel("business-1", "https://youtube.com/@mychannel");

    expect(db.tables.tracked_channels).toHaveLength(1);
    expect(result).toEqual({ ok: true, channelId: db.tables.tracked_channels[0].id, diagnosis: null });
  });

  it("still surfaces any other diagnosis failure", async () => {
    useDb();
    diagnoseChannelMock.mockRejectedValue(new Error("boom"));
    await expect(registerAndDiagnoseChannel("business-1", "https://youtube.com/@mychannel")).rejects.toThrow("boom");
  });
});

describe("registerAndDiagnoseChannel", () => {
  it("returns ok: false without touching Supabase when the URL can't be parsed", async () => {
    const result = await registerAndDiagnoseChannel("business-1", "not a url at all###");
    expect(result).toMatchObject({ ok: false });
    expect(createClientMock).not.toHaveBeenCalled();
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("stores the CANONICAL channel id (not the @handle) with name, image and the next 06:00 KST, then diagnoses it", async () => {
    const db = useDb();

    const result = await registerAndDiagnoseChannel("business-1", "https://youtube.com/@mychannel");

    const row = db.tables.tracked_channels[0];
    expect(row).toMatchObject({ business_id: "business-1", platform: "youtube", external_id: UC, url: "https://youtube.com/@mychannel", display_name: "우리 채널", thumbnail_url: "https://yt3.ggpht.com/m" });
    // the daily schedule is fixed to 06:00 KST (21:00 UTC), and is set on insert because the user client cannot update the row later
    expect(String(row.next_snapshot_at)).toMatch(/T21:00:00\.000Z$/);
    expect(Date.parse(String(row.next_snapshot_at))).toBeGreaterThan(Date.now());
    expect(diagnoseChannelMock).toHaveBeenCalledWith({ id: row.id, business_id: "business-1", external_id: UC, url: "https://youtube.com/@mychannel", platform: "youtube" }, "우리동네 빵집");
    expect(result).toEqual({ ok: true, channelId: row.id, diagnosis: SAMPLE_DIAGNOSIS });
  });

  it("refuses a channel that does not exist before anything is saved", async () => {
    const db = useDb();
    resolveMock.mockResolvedValue({ ok: false, message: "채널을 찾을 수 없어요." });
    const result = await registerAndDiagnoseChannel("business-1", "https://youtube.com/@nobody");
    expect(result).toEqual({ ok: false, message: "채널을 찾을 수 없어요." });
    expect(db.tables.tracked_channels ?? []).toHaveLength(0);
    expect(diagnoseChannelMock).not.toHaveBeenCalled();
  });

  it("reuses an existing row for the same canonical id instead of inserting a duplicate", async () => {
    const db = useDb({ tracked_channels: [{ id: "channel-9", business_id: "business-1", platform: "youtube", external_id: UC, url: "https://youtube.com/@mychannel" }] });
    const result = await registerAndDiagnoseChannel("business-1", "https://youtube.com/@mychannel");
    expect(db.tables.tracked_channels).toHaveLength(1);
    expect(result).toMatchObject({ ok: true, channelId: "channel-9" });
  });

  it("recognises a channel registered earlier under its @handle: no second row under the channel id", async () => {
    const db = useDb({ tracked_channels: [{ id: "legacy", business_id: "business-1", platform: "youtube", external_id: "@mychannel", url: "https://youtube.com/@mychannel" }] });
    const result = await registerAndDiagnoseChannel("business-1", "https://youtube.com/@mychannel");
    expect(db.tables.tracked_channels).toHaveLength(1);
    expect(result).toMatchObject({ ok: true, channelId: "legacy" });
  });

  it("passes platformHint through to the URL parser for a host it can't classify on its own", async () => {
    const db = useDb();
    resolveMock.mockResolvedValue({ ok: true, preview: { platform: "tistory", externalId: "blog.mycustomdomain.com", normalizedUrl: "https://blog.mycustomdomain.com/", displayName: null, thumbnailUrl: null, summary: null, verified: false, note: "공개된 글이 보이지 않아요." } });
    await registerAndDiagnoseChannel("business-1", "https://blog.mycustomdomain.com", "tistory");
    expect(resolveMock.mock.calls[0][0]).toMatchObject({ platform: "tistory", externalId: "blog.mycustomdomain.com" });
    expect(db.tables.tracked_channels[0]).toMatchObject({ platform: "tistory", external_id: "blog.mycustomdomain.com" });
  });

  it("re-selects instead of failing when a concurrent request already inserted the same channel (unique violation)", async () => {
    const winner = { id: "channel-9", external_id: UC, url: "https://youtube.com/@mychannel", platform: "youtube" };
    let selects = 0;
    const chain = (result: () => unknown) => {
      const api: Record<string, unknown> = {};
      for (const name of ["select", "eq", "in"]) api[name] = () => api;
      api.single = () => Promise.resolve(result());
      api.maybeSingle = () => Promise.resolve(result());
      api.insert = () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } }) }) });
      api.then = (resolve: (value: unknown) => unknown) => Promise.resolve(selects++ === 0 ? { data: [], error: null } : { data: [winner], error: null }).then(resolve);
      return api;
    };
    createClientMock.mockResolvedValue({ from: (name: string) => (name === "businesses" ? chain(() => ({ data: { name: "빵집" }, error: null })) : chain(() => ({ data: winner, error: null }))) });
    const result = await registerAndDiagnoseChannel("business-1", "https://youtube.com/@mychannel");
    expect(result).toMatchObject({ ok: true, channelId: "channel-9" });
  });

  it("throws ChannelsError when the existence check or the insert fails (not for a unique violation)", async () => {
    const failing = (error: unknown, onInsert = false) => {
      const api: Record<string, unknown> = {};
      for (const name of ["select", "eq", "in"]) api[name] = () => api;
      api.maybeSingle = () => Promise.resolve({ data: { name: "빵집" }, error: null });
      api.insert = () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error }) }) });
      api.then = (resolve: (value: unknown) => unknown) => Promise.resolve(onInsert ? { data: [], error: null } : { data: null, error }).then(resolve);
      return api;
    };
    createClientMock.mockResolvedValue({ from: (name: string) => (name === "businesses" ? failing(null) : failing(new Error("boom"))) });
    await expect(registerAndDiagnoseChannel("business-1", "https://youtube.com/@mychannel")).rejects.toMatchObject({ name: "ChannelsError", code: "DATABASE_ERROR" });

    createClientMock.mockResolvedValue({ from: (name: string) => (name === "businesses" ? failing(null) : failing({ code: "42501", message: "rls denied" }, true)) });
    await expect(registerAndDiagnoseChannel("business-1", "https://youtube.com/@mychannel")).rejects.toMatchObject({ name: "ChannelsError", code: "DATABASE_ERROR" });
  });

  it("propagates diagnoseChannel's own error without swallowing it", async () => {
    useDb();
    diagnoseChannelMock.mockRejectedValueOnce(new Error("provider down"));
    await expect(registerAndDiagnoseChannel("business-1", "https://youtube.com/@mychannel")).rejects.toThrow("provider down");
  });
});
