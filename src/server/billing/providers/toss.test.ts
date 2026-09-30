import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env/client", () => ({ clientEnv: { NEXT_PUBLIC_TOSS_CLIENT_KEY: "test_ck_dummy" } }));
vi.mock("@/lib/env/server", () => {
  const serverEnv: Record<string, string | undefined> = { TOSS_SECRET_KEY: "test_sk_dummy" };
  return {
    serverEnv,
    requireEnv: (key: string) => {
      const value = serverEnv[key];
      if (!value) throw new Error(`Missing required environment variable: ${key}.`);
      return value;
    },
  };
});

const {
  createCheckoutSessionMock,
  getCheckoutSessionMock,
  claimCheckoutSessionMock,
  saveBillingKeyMock,
  markCheckoutSucceededMock,
  markCheckoutFailedMock,
  activateSubscriptionMock,
  cancelStoredSubscriptionMock,
  getLatestSuccessfulCheckoutMock,
} = vi.hoisted(() => ({
  createCheckoutSessionMock: vi.fn(),
  getCheckoutSessionMock: vi.fn(),
  claimCheckoutSessionMock: vi.fn(),
  saveBillingKeyMock: vi.fn(),
  markCheckoutSucceededMock: vi.fn(),
  markCheckoutFailedMock: vi.fn(),
  activateSubscriptionMock: vi.fn(),
  cancelStoredSubscriptionMock: vi.fn(),
  getLatestSuccessfulCheckoutMock: vi.fn(),
}));

vi.mock("../checkout-sessions", async () => {
  const actual = await vi.importActual<typeof import("../checkout-sessions")>("../checkout-sessions");
  return {
    ...actual,
    createCheckoutSession: createCheckoutSessionMock,
    getCheckoutSession: getCheckoutSessionMock,
    claimCheckoutSession: claimCheckoutSessionMock,
    saveBillingKey: saveBillingKeyMock,
    markCheckoutSucceeded: markCheckoutSucceededMock,
    markCheckoutFailed: markCheckoutFailedMock,
    activateSubscription: activateSubscriptionMock,
    cancelStoredSubscription: cancelStoredSubscriptionMock,
    getLatestSuccessfulCheckout: getLatestSuccessfulCheckoutMock,
  };
});

const { issueBillingKeyMock, chargeBillingKeyMock, deleteBillingKeyMock, TossApiClientMock } = vi.hoisted(() => {
  const issueBillingKeyMock = vi.fn();
  const chargeBillingKeyMock = vi.fn();
  const deleteBillingKeyMock = vi.fn();
  const TossApiClientMock = vi.fn().mockImplementation(function () {
    return { issueBillingKey: issueBillingKeyMock, chargeBillingKey: chargeBillingKeyMock, deleteBillingKey: deleteBillingKeyMock };
  });
  return { issueBillingKeyMock, chargeBillingKeyMock, deleteBillingKeyMock, TossApiClientMock };
});
vi.mock("./toss-api", async () => {
  const actual = await vi.importActual<typeof import("./toss-api")>("./toss-api");
  return { ...actual, TossApiClient: TossApiClientMock };
});

const { BillingCheckoutError } = await import("../checkout-sessions");
const { TossApiError } = await import("./toss-api");
const { TossBillingProvider } = await import("./toss");

const SESSION_ROW = {
  id: "session-1",
  user_id: "user-1",
  plan: "STARTER" as const,
  provider: "toss" as const,
  status: "PROCESSING" as const,
  customer_key: "cus_abc",
  order_id: "order_abc",
  provider_billing_key: null as string | null,
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
  TossApiClientMock.mockImplementation(function () {
    return { issueBillingKey: issueBillingKeyMock, chargeBillingKey: chargeBillingKeyMock, deleteBillingKey: deleteBillingKeyMock };
  });
});

describe("TossBillingProvider.createCheckout", () => {
  it("creates a session and returns a checkout URL carrying its id", async () => {
    createCheckoutSessionMock.mockResolvedValue(SESSION_ROW);

    const result = await new TossBillingProvider().createCheckout({
      userId: "user-1",
      plan: "STARTER",
      successUrl: "https://app.example.com",
      cancelUrl: "https://app.example.com/billing/fail",
    });

    expect(result.provider).toBe("toss");
    expect(result.url).toBe("https://app.example.com/billing/toss-checkout?session=session-1");
    expect(createCheckoutSessionMock).toHaveBeenCalledWith("user-1", "STARTER", "toss");
  });

  it("fails closed instead of falling back to mock when TOSS_SECRET_KEY is not configured", async () => {
    const { serverEnv } = await import("@/lib/env/server");
    const original = serverEnv.TOSS_SECRET_KEY;
    delete serverEnv.TOSS_SECRET_KEY;

    try {
      await expect(
        new TossBillingProvider().createCheckout({
          userId: "user-1",
          plan: "STARTER",
          successUrl: "https://app.example.com",
          cancelUrl: "https://app.example.com/billing/fail",
        }),
      ).rejects.toThrow(/Missing required environment variable: TOSS_SECRET_KEY/);
      expect(createCheckoutSessionMock).not.toHaveBeenCalled();
    } finally {
      serverEnv.TOSS_SECRET_KEY = original;
    }
  });
});

describe("TossBillingProvider.completeCheckout", () => {
  it("rejects a callback missing the Toss auth/customer key params", async () => {
    const error = await new TossBillingProvider()
      .completeCheckout({ userId: "user-1", sessionId: "session-1" })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(BillingCheckoutError);
    expect((error as InstanceType<typeof BillingCheckoutError>).code).toBe("INVALID_CALLBACK");
    expect(getCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("rejects when the callback's customerKey doesn't match the stored session", async () => {
    getCheckoutSessionMock.mockResolvedValue(SESSION_ROW);

    const error = await new TossBillingProvider()
      .completeCheckout({ userId: "user-1", sessionId: "session-1", authKey: "auth", customerKey: "cus_wrong" })
      .catch((caught) => caught);

    expect((error as InstanceType<typeof BillingCheckoutError>).code).toBe("CUSTOMER_KEY_MISMATCH");
    expect(claimCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("returns idempotently without calling Toss again when the session already succeeded", async () => {
    getCheckoutSessionMock.mockResolvedValue(SESSION_ROW);
    claimCheckoutSessionMock.mockResolvedValue({ ...SESSION_ROW, status: "SUCCEEDED" });

    const result = await new TossBillingProvider().completeCheckout({
      userId: "user-1",
      sessionId: "session-1",
      authKey: "auth",
      customerKey: "cus_abc",
    });

    expect(result).toEqual({ plan: "STARTER", provider: "toss" });
    expect(issueBillingKeyMock).not.toHaveBeenCalled();
    expect(chargeBillingKeyMock).not.toHaveBeenCalled();
  });

  it("issues a billing key, charges it, verifies the amount, and activates the subscription (success path)", async () => {
    getCheckoutSessionMock.mockResolvedValue(SESSION_ROW);
    claimCheckoutSessionMock.mockResolvedValue(SESSION_ROW);
    issueBillingKeyMock.mockResolvedValue({ billingKey: "billing-key-1", customerKey: "cus_abc" });
    chargeBillingKeyMock.mockResolvedValue({
      paymentKey: "pay_1",
      orderId: "order_abc",
      status: "DONE",
      totalAmount: 19000,
    });

    const result = await new TossBillingProvider().completeCheckout({
      userId: "user-1",
      sessionId: "session-1",
      authKey: "one-time-auth",
      customerKey: "cus_abc",
    });

    expect(issueBillingKeyMock).toHaveBeenCalledWith("one-time-auth", "cus_abc", "session-1-issue");
    expect(saveBillingKeyMock).toHaveBeenCalledWith("session-1", "billing-key-1");
    expect(chargeBillingKeyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        billingKey: "billing-key-1",
        customerKey: "cus_abc",
        amount: 19000,
        orderId: "order_abc",
        idempotencyKey: "session-1-charge",
      }),
    );
    expect(activateSubscriptionMock).toHaveBeenCalledWith("user-1", "STARTER", "toss", "session-1");
    expect(markCheckoutSucceededMock).toHaveBeenCalledWith("session-1", "pay_1");
    expect(result).toEqual({ plan: "STARTER", provider: "toss" });
  });

  it("reuses an already-issued billing key instead of issuing a new one on a retried callback", async () => {
    const withBillingKey = { ...SESSION_ROW, provider_billing_key: "existing-key" };
    getCheckoutSessionMock.mockResolvedValue(withBillingKey);
    claimCheckoutSessionMock.mockResolvedValue(withBillingKey);
    chargeBillingKeyMock.mockResolvedValue({
      paymentKey: "pay_1",
      orderId: "order_abc",
      status: "DONE",
      totalAmount: 19000,
    });

    await new TossBillingProvider().completeCheckout({
      userId: "user-1",
      sessionId: "session-1",
      authKey: "one-time-auth",
      customerKey: "cus_abc",
    });

    expect(issueBillingKeyMock).not.toHaveBeenCalled();
    expect(saveBillingKeyMock).not.toHaveBeenCalled();
    expect(chargeBillingKeyMock).toHaveBeenCalledWith(expect.objectContaining({ billingKey: "existing-key" }));
  });

  it("rejects when the issued billing key's customerKey doesn't match the session, and marks the checkout failed", async () => {
    getCheckoutSessionMock.mockResolvedValue(SESSION_ROW);
    claimCheckoutSessionMock.mockResolvedValue(SESSION_ROW);
    issueBillingKeyMock.mockResolvedValue({ billingKey: "billing-key-1", customerKey: "cus_someone_else" });

    const error = await new TossBillingProvider()
      .completeCheckout({ userId: "user-1", sessionId: "session-1", authKey: "auth", customerKey: "cus_abc" })
      .catch((caught) => caught);

    expect((error as InstanceType<typeof BillingCheckoutError>).code).toBe("CUSTOMER_KEY_MISMATCH");
    expect(markCheckoutFailedMock).toHaveBeenCalledWith("session-1", "CUSTOMER_KEY_MISMATCH", expect.any(String));
    expect(activateSubscriptionMock).not.toHaveBeenCalled();
  });

  it("rejects when Toss's charge response doesn't match the expected order/amount/status, and marks the checkout failed", async () => {
    getCheckoutSessionMock.mockResolvedValue(SESSION_ROW);
    claimCheckoutSessionMock.mockResolvedValue(SESSION_ROW);
    issueBillingKeyMock.mockResolvedValue({ billingKey: "billing-key-1", customerKey: "cus_abc" });
    chargeBillingKeyMock.mockResolvedValue({
      paymentKey: "pay_1",
      orderId: "order_abc",
      status: "DONE",
      totalAmount: 999,
    });

    const error = await new TossBillingProvider()
      .completeCheckout({ userId: "user-1", sessionId: "session-1", authKey: "auth", customerKey: "cus_abc" })
      .catch((caught) => caught);

    expect((error as InstanceType<typeof BillingCheckoutError>).code).toBe("PAYMENT_VERIFICATION_FAILED");
    expect(markCheckoutFailedMock).toHaveBeenCalledWith("session-1", "PAYMENT_VERIFICATION_FAILED", expect.any(String));
    expect(activateSubscriptionMock).not.toHaveBeenCalled();
  });

  it("propagates a declined-card TossApiError and marks the checkout failed with its provider code", async () => {
    getCheckoutSessionMock.mockResolvedValue(SESSION_ROW);
    claimCheckoutSessionMock.mockResolvedValue(SESSION_ROW);
    issueBillingKeyMock.mockRejectedValue(new TossApiError("REJECT_CARD_COMPANY", "카드사에서 거절했습니다.", 400));

    const error = await new TossBillingProvider()
      .completeCheckout({ userId: "user-1", sessionId: "session-1", authKey: "auth", customerKey: "cus_abc" })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(TossApiError);
    expect((error as InstanceType<typeof TossApiError>).code).toBe("REJECT_CARD_COMPANY");
    expect(markCheckoutFailedMock).toHaveBeenCalledWith("session-1", "REJECT_CARD_COMPANY", "카드사에서 거절했습니다.");
  });

  it("propagates a network failure and marks the checkout failed instead of retrying a possible charge", async () => {
    getCheckoutSessionMock.mockResolvedValue(SESSION_ROW);
    claimCheckoutSessionMock.mockResolvedValue(SESSION_ROW);
    issueBillingKeyMock.mockResolvedValue({ billingKey: "billing-key-1", customerKey: "cus_abc" });
    chargeBillingKeyMock.mockRejectedValue(new TossApiError("TOSS_NETWORK_ERROR", "network down", 503));

    const error = await new TossBillingProvider()
      .completeCheckout({ userId: "user-1", sessionId: "session-1", authKey: "auth", customerKey: "cus_abc" })
      .catch((caught) => caught);

    expect((error as InstanceType<typeof TossApiError>).code).toBe("TOSS_NETWORK_ERROR");
    expect(markCheckoutFailedMock).toHaveBeenCalledWith("session-1", "TOSS_NETWORK_ERROR", "network down");
    expect(chargeBillingKeyMock).toHaveBeenCalledTimes(1);
  });
});

describe("TossBillingProvider.cancelSubscription", () => {
  it("cancels the stored subscription and best-effort deletes the Toss billing key", async () => {
    getLatestSuccessfulCheckoutMock.mockResolvedValue({ ...SESSION_ROW, provider_billing_key: "billing-key-1" });
    deleteBillingKeyMock.mockResolvedValue(undefined);

    await new TossBillingProvider().cancelSubscription({ userId: "user-1" });

    expect(cancelStoredSubscriptionMock).toHaveBeenCalledWith("user-1");
    expect(deleteBillingKeyMock).toHaveBeenCalledWith("billing-key-1");
  });

  it("still cancels locally even when the Toss billing-key delete call fails", async () => {
    getLatestSuccessfulCheckoutMock.mockResolvedValue({ ...SESSION_ROW, provider_billing_key: "billing-key-1" });
    deleteBillingKeyMock.mockRejectedValue(new TossApiError("TOSS_API_ERROR", "delete failed", 500));

    await expect(new TossBillingProvider().cancelSubscription({ userId: "user-1" })).resolves.toBeUndefined();
    expect(cancelStoredSubscriptionMock).toHaveBeenCalledWith("user-1");
  });

  it("skips the Toss delete call entirely when there was never a stored billing key", async () => {
    getLatestSuccessfulCheckoutMock.mockResolvedValue(null);

    await new TossBillingProvider().cancelSubscription({ userId: "user-1" });

    expect(cancelStoredSubscriptionMock).toHaveBeenCalledWith("user-1");
    expect(deleteBillingKeyMock).not.toHaveBeenCalled();
  });
});

describe("TossBillingProvider.handleWebhook", () => {
  it("resolves without throwing — this integration has no configured billing webhook", async () => {
    await expect(
      new TossBillingProvider().handleWebhook({ payload: "{}", headers: {} }),
    ).resolves.toBeUndefined();
  });
});
