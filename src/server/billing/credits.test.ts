import { beforeEach, describe, expect, it, vi } from "vitest";
import { FREE_TRIAL_CREDITS } from "./products";

const { createAdminClientMock, rpcMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  rpcMock: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

const { ensureTrialCredits, isInsufficientCreditError, releaseCreditByReference, settleCreditByReference } = await import("./credits");

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClientMock.mockReturnValue({ rpc: rpcMock });
});

describe("ensureTrialCredits", () => {
  it("passes the single configured offer to the idempotent DB RPC", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    const now = new Date("2026-10-11T00:00:00.000Z");

    await expect(ensureTrialCredits("user-1", now)).resolves.toBe(true);

    expect(rpcMock).toHaveBeenCalledWith("ensure_trial_credits", {
      p_user_id: "user-1",
      p_blog_amount: FREE_TRIAL_CREDITS.amounts.BLOG,
      p_shorts_amount: FREE_TRIAL_CREDITS.amounts.SHORTS,
      p_expires_at: "2026-11-10T00:00:00.000Z",
      p_reference_id: FREE_TRIAL_CREDITS.referenceId,
    });
  });

  it("reports an already-claimed trial without treating it as an error", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    await expect(ensureTrialCredits("user-1")).resolves.toBe(false);
  });
});

describe("run reference helpers", () => {
  it("settles and releases by automation run id", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    await expect(settleCreditByReference("run-1")).resolves.toBe(true);
    await expect(releaseCreditByReference("run-2", "failed")).resolves.toBe(true);
    expect(rpcMock).toHaveBeenNthCalledWith(1, "settle_credit_by_reference", { p_reference_id: "run-1" });
    expect(rpcMock).toHaveBeenNthCalledWith(2, "release_credit_by_reference", { p_reference_id: "run-2", p_reason: "failed" });
  });

  it("recognizes the DB's insufficient-credit error", () => {
    expect(isInsufficientCreditError({ code: "P0001", message: "insufficient BLOG credits: missing 1" })).toBe(true);
    expect(isInsufficientCreditError(new Error("network failed"))).toBe(false);
  });
});
