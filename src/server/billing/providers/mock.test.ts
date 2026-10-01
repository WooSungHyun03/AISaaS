import { afterEach, describe, expect, it, vi } from "vitest";

const {
  createCheckoutSessionMock,
  claimCheckoutSessionMock,
  activateSubscriptionMock,
  markCheckoutSucceededMock,
  markCheckoutFailedMock,
  cancelStoredSubscriptionMock,
} = vi.hoisted(() => ({
  createCheckoutSessionMock: vi.fn(),
  claimCheckoutSessionMock: vi.fn(),
  activateSubscriptionMock: vi.fn(),
  markCheckoutSucceededMock: vi.fn(),
  markCheckoutFailedMock: vi.fn(),
  cancelStoredSubscriptionMock: vi.fn(),
}));

vi.mock("../checkout-sessions", () => ({
  createCheckoutSession: createCheckoutSessionMock,
  claimCheckoutSession: claimCheckoutSessionMock,
  activateSubscription: activateSubscriptionMock,
  markCheckoutSucceeded: markCheckoutSucceededMock,
  markCheckoutFailed: markCheckoutFailedMock,
  cancelStoredSubscription: cancelStoredSubscriptionMock,
}));

const { MockBillingProvider } = await import("./mock");

const SESSION_ROW = {
  id: "session-1",
  user_id: "user-1",
  plan: "PRO" as const,
  provider: "mock" as const,
  status: "PROCESSING" as const,
  customer_key: "cus_abc",
  order_id: "order_abc",
  provider_billing_key: null,
  provider_payment_key: null,
  error_code: null,
  error_message: null,
  expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  completed_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  vi.resetAllMocks();
});

describe("MockBillingProvider.createCheckout", () => {
  it("creates a session and returns a URL to the in-app mock checkout page", async () => {
    createCheckoutSessionMock.mockResolvedValue(SESSION_ROW);

    const result = await new MockBillingProvider().createCheckout({
      userId: "user-1",
      plan: "PRO",
      successUrl: "https://app.example.com",
      cancelUrl: "https://app.example.com/billing/fail",
    });

    expect(createCheckoutSessionMock).toHaveBeenCalledWith("user-1", "PRO", "mock");
    expect(result).toEqual({ url: "https://app.example.com/billing/mock-checkout?session=session-1", provider: "mock" });
  });
});

describe("MockBillingProvider.completeCheckout", () => {
  it("activates the subscription and marks the checkout succeeded", async () => {
    claimCheckoutSessionMock.mockResolvedValue(SESSION_ROW);

    const result = await new MockBillingProvider().completeCheckout({ userId: "user-1", sessionId: "session-1" });

    expect(activateSubscriptionMock).toHaveBeenCalledWith("user-1", "PRO", "mock", "session-1");
    expect(markCheckoutSucceededMock).toHaveBeenCalledWith("session-1", expect.stringMatching(/^mock_pay_/));
    expect(result).toEqual({ plan: "PRO", provider: "mock" });
  });

  it("returns idempotently without re-activating when the session already succeeded", async () => {
    claimCheckoutSessionMock.mockResolvedValue({ ...SESSION_ROW, status: "SUCCEEDED" });

    const result = await new MockBillingProvider().completeCheckout({ userId: "user-1", sessionId: "session-1" });

    expect(result).toEqual({ plan: "PRO", provider: "mock" });
    expect(activateSubscriptionMock).not.toHaveBeenCalled();
  });

  it("marks the checkout failed and rethrows when activating the subscription fails", async () => {
    claimCheckoutSessionMock.mockResolvedValue(SESSION_ROW);
    activateSubscriptionMock.mockRejectedValue(new Error("db unavailable"));

    await expect(new MockBillingProvider().completeCheckout({ userId: "user-1", sessionId: "session-1" })).rejects.toThrow(
      "db unavailable",
    );
    expect(markCheckoutFailedMock).toHaveBeenCalledWith("session-1", "MOCK_CHECKOUT_FAILED", "db unavailable");
  });
});

describe("MockBillingProvider.cancelSubscription", () => {
  it("cancels the stored subscription", async () => {
    await new MockBillingProvider().cancelSubscription({ userId: "user-1" });
    expect(cancelStoredSubscriptionMock).toHaveBeenCalledWith("user-1");
  });
});

describe("MockBillingProvider.handleWebhook", () => {
  it("rejects external webhook calls — mock completion is only authenticated through completeCheckout", async () => {
    await expect(new MockBillingProvider().handleWebhook({ payload: "{}", headers: {} })).rejects.toThrow(
      /does not accept external webhooks/,
    );
  });
});
