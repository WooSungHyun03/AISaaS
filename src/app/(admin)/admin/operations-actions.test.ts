import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const setUserAccountStatus = vi.fn();
const executeRefund = vi.fn();

vi.mock("@/server/admin/access", () => ({ requireAdmin }));
vi.mock("@/server/admin/audit", () => ({ recordAdminAudit: vi.fn() }));
vi.mock("@/server/admin/operations", () => ({ setUserAccountStatus, executeRefund, reviewRefund: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { setAccountStatusAction } = await import("./users/[id]/actions");
const { executeRefundAction } = await import("./refunds/[id]/actions");

describe("admin operations Server Action authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blocks a direct account status mutation when requireAdmin rejects", async () => {
    requireAdmin.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(setAccountStatusAction("11111111-1111-4111-8111-111111111111", { ok: false, message: "" }, new FormData())).rejects.toThrow("FORBIDDEN");
    expect(setUserAccountStatus).not.toHaveBeenCalled();
  });

  it("blocks a direct refund execution when requireAdmin rejects", async () => {
    requireAdmin.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(executeRefundAction("22222222-2222-4222-8222-222222222222", { ok: false, message: "" }, new FormData())).rejects.toThrow("FORBIDDEN");
    expect(executeRefund).not.toHaveBeenCalled();
  });
});
