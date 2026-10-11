import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const answerInquiry = vi.fn();
const recordAdminAudit = vi.fn();

vi.mock("@/server/admin/access", () => ({ requireAdmin }));
vi.mock("@/server/admin/audit", () => ({ recordAdminAudit }));
vi.mock("@/server/inquiries/inquiries", () => ({ answerInquiry }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { answerInquiryAction } = await import("./actions");

describe("answerInquiryAction authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops a direct Server Action call when requireAdmin rejects it", async () => {
    requireAdmin.mockRejectedValueOnce(new Error("FORBIDDEN"));

    await expect(answerInquiryAction(
      "11111111-1111-4111-8111-111111111111",
      {},
      new FormData(),
    )).rejects.toThrow("FORBIDDEN");
    expect(answerInquiry).not.toHaveBeenCalled();
    expect(recordAdminAudit).not.toHaveBeenCalled();
  });
});
