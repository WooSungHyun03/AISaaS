import { afterEach, describe, expect, it, vi } from "vitest";

const { createClientMock, createAdminClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

const { removeTrackedChannel } = await import("./remove");

function userClient(channel: Record<string, unknown> | null, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: channel, error });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  return { from: vi.fn(() => ({ select })), eq };
}

function adminClient(error: unknown = null) {
  const eqBusiness = vi.fn().mockResolvedValue({ error });
  const eqId = vi.fn(() => ({ eq: eqBusiness }));
  const del = vi.fn(() => ({ eq: eqId }));
  return { from: vi.fn(() => ({ delete: del })), del, eqId, eqBusiness };
}

afterEach(() => vi.clearAllMocks());

describe("removeTrackedChannel", () => {
  it("deletes only the channel the caller can read through RLS", async () => {
    createClientMock.mockResolvedValue(userClient({ id: "channel-1", business_id: "business-1" }));
    const admin = adminClient();
    createAdminClientMock.mockReturnValue(admin);

    await expect(removeTrackedChannel("channel-1")).resolves.toEqual({ status: "removed" });
    expect(admin.from).toHaveBeenCalledWith("tracked_channels");
    expect(admin.eqId).toHaveBeenCalledWith("id", "channel-1");
    expect(admin.eqBusiness).toHaveBeenCalledWith("business_id", "business-1");
  });

  it("never touches the service-role client for a channel outside the caller's businesses", async () => {
    createClientMock.mockResolvedValue(userClient(null));

    await expect(removeTrackedChannel("someone-elses-channel")).resolves.toEqual({ status: "not_found" });
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("surfaces read and delete failures as ChannelsError", async () => {
    createClientMock.mockResolvedValue(userClient(null, { message: "boom" }));
    await expect(removeTrackedChannel("channel-1")).rejects.toMatchObject({ name: "ChannelsError", code: "DATABASE_ERROR" });

    createClientMock.mockResolvedValue(userClient({ id: "channel-1", business_id: "business-1" }));
    createAdminClientMock.mockReturnValue(adminClient({ message: "denied" }));
    await expect(removeTrackedChannel("channel-1")).rejects.toMatchObject({ name: "ChannelsError", code: "DATABASE_ERROR" });
  });
});
