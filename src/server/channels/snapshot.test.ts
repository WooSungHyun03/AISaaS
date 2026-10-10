import { describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

const { saveMetricSnapshot } = await import("./snapshot");

function makeClient(result: { data: unknown; error: unknown }) {
  const upsert = vi.fn().mockResolvedValue(result);
  return { from: vi.fn(() => ({ upsert })), upsert };
}

describe("saveMetricSnapshot", () => {
  it("upserts on (channel_id, metric, recorded_date) — same-day re-collection overwrites, not errors", async () => {
    const client = makeClient({ data: null, error: null });
    createClientMock.mockResolvedValue(client);

    await saveMetricSnapshot({ channelId: "channel-1", metric: "viewCount", value: 1234, source: "mock", recordedAt: new Date("2026-10-10T00:00:00.000Z") });

    expect(client.upsert).toHaveBeenCalledWith(
      { channel_id: "channel-1", metric: "viewCount", value: 1234, source: "mock", recorded_at: "2026-10-10T00:00:00.000Z" },
      { onConflict: "channel_id,metric,recorded_date" },
    );
  });

  it("throws ChannelsError when the upsert fails", async () => {
    const client = makeClient({ data: null, error: new Error("boom") });
    createClientMock.mockResolvedValue(client);

    await expect(saveMetricSnapshot({ channelId: "channel-1", metric: "viewCount", value: 1, source: "mock" })).rejects.toMatchObject({
      name: "ChannelsError",
      code: "DATABASE_ERROR",
    });
  });

  it("the source parameter's type excludes DEMO_SEED (compile-time check — see snapshot-source.ts)", () => {
    // @ts-expect-error DEMO_SEED is not a valid ChannelSnapshotSource; no app code path can write it.
    const invalid: Parameters<typeof saveMetricSnapshot>[0] = { channelId: "c", metric: "m", value: 1, source: "DEMO_SEED" };
    expect(invalid).toBeDefined();
  });
});
