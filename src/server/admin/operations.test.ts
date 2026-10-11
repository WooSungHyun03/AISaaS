import { beforeEach, describe, expect, it, vi } from "vitest";

const refundPayment = vi.fn();
vi.mock("@/server/billing", () => ({ getBillingProviderByName: () => ({ refundPayment }) }));

const { executeRefund, setUserAccountStatus } = await import("./operations");

function resultBuilder(result: unknown) {
  const builder = {
    select: vi.fn(() => builder), eq: vi.fn(() => builder), maybeSingle: vi.fn(async () => result),
    single: vi.fn(async () => result), update: vi.fn(() => builder),
  };
  return builder;
}

describe("admin operations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("applies an Auth ban and profile suspension together", async () => {
    const authUpdate = vi.fn().mockResolvedValue({ data: {}, error: null });
    const profiles = resultBuilder({ data: null, error: null });
    const admin = { auth: { admin: { updateUserById: authUpdate } }, from: vi.fn(() => profiles) };

    await setUserAccountStatus(admin as never, { userId: "user-1", status: "SUSPENDED", reason: "운영 정책 위반" });

    expect(authUpdate).toHaveBeenCalledWith("user-1", { ban_duration: "876000h" });
    expect(profiles.update).toHaveBeenCalledWith(expect.objectContaining({ account_status: "SUSPENDED", suspension_reason: "운영 정책 위반" }));
  });

  it("keeps an approved refund retryable and records failure without changing its status", async () => {
    const request = { id: "request-1", user_id: "user-1", order_id: "order-1", status: "APPROVED", refund_idempotency_key: "refund-request-1", expected_refund_krw: 5_000 };
    const order = { id: "order-1", provider: "toss", checkout_session_id: "session-1", price_krw: 10_000, product_id: "BLOG_5" };
    const tableResults: Record<string, unknown> = {
      refund_requests: { data: request, error: null }, profiles: { data: { email: "member@example.com" }, error: null },
      billing_orders: { data: order, error: null }, credit_grants: { data: { remaining: 2 }, error: null },
      billing_checkout_sessions: { data: { provider_payment_key: "pay-1" }, error: null },
    };
    const rpc = vi.fn(async (name: string) => name === "admin_record_refund_failure" ? { data: 1, error: null } : { data: null, error: null });
    const admin = { from: vi.fn((table: string) => resultBuilder(tableResults[table])), rpc };
    refundPayment.mockRejectedValueOnce(new Error("temporary Toss outage"));

    await expect(executeRefund(admin as never, "request-1")).rejects.toThrow("temporary Toss outage");
    expect(refundPayment).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "refund-request-1", amount: 5_000 }));
    expect(rpc).toHaveBeenCalledWith("admin_record_refund_failure", { p_request_id: "request-1", p_error: "temporary Toss outage" });
    expect(rpc).not.toHaveBeenCalledWith("admin_finalize_refund_request", expect.anything());
  });
});
