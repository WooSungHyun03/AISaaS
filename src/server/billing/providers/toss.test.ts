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
  getLegacyPlanFromCheckoutMock,
  createProductOrderMock,
  getProductOrderByCheckoutSessionMock,
  completeProductOrderMock,
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
  getLegacyPlanFromCheckoutMock: vi.fn((session: { product_id: string }) => session.product_id),
  createProductOrderMock: vi.fn(),
  getProductOrderByCheckoutSessionMock: vi.fn(),
  completeProductOrderMock: vi.fn(),
}));

vi.mock("../orders", () => ({
  createProductOrder: createProductOrderMock,
  getProductOrderByCheckoutSession: getProductOrderByCheckoutSessionMock,
  completeProductOrder: completeProductOrderMock,
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
    getLegacyPlanFromCheckout: getLegacyPlanFromCheckoutMock,
  };
});

const { issueBillingKeyMock, chargeBillingKeyMock, confirmPaymentMock, deleteBillingKeyMock, TossApiClientMock } = vi.hoisted(() => {
  const issueBillingKeyMock = vi.fn();
  const chargeBillingKeyMock = vi.fn();
  const confirmPaymentMock = vi.fn();
  const deleteBillingKeyMock = vi.fn();
  const TossApiClientMock = vi.fn().mockImplementation(function () {
    return { issueBillingKey: issueBillingKeyMock, chargeBillingKey: chargeBillingKeyMock, confirmPayment: confirmPaymentMock, deleteBillingKey: deleteBillingKeyMock };
  });
  return { issueBillingKeyMock, chargeBillingKeyMock, confirmPaymentMock, deleteBillingKeyMock, TossApiClientMock };
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
  product_id: "STARTER",
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
    return { issueBillingKey: issueBillingKeyMock, chargeBillingKey: chargeBillingKeyMock, confirmPayment: confirmPaymentMock, deleteBillingKey: deleteBillingKeyMock };
  });
});

describe("TossBillingProvider product orders", () => {
  const productSession = { ...SESSION_ROW, product_id: "SHORTS_3", order_id: "order_product_1" };

  it("creates a product order only when both Toss keys are test keys", async () => {
    createProductOrderMock.mockResolvedValue({ session: productSession, order: { id: "order-db-1" } });

    const result = await new TossBillingProvider().createOrder({
      userId: "user-1",
      productId: "SHORTS_3",
      successUrl: "https://app.example.com",
      cancelUrl: "https://app.example.com/billing/fail",
    });

    expect(createProductOrderMock).toHaveBeenCalledWith("user-1", "SHORTS_3", "toss");
    expect(result.url).toBe("https://app.example.com/billing/toss-checkout?session=session-1");
  });

  it("rejects a live Toss secret before creating an order", async () => {
    const { serverEnv } = await import("@/lib/env/server");
    const original = serverEnv.TOSS_SECRET_KEY;
    serverEnv.TOSS_SECRET_KEY = "live_sk_must_not_charge";
    try {
      await expect(new TossBillingProvider().createOrder({
        userId: "user-1",
        productId: "SHORTS_3",
        successUrl: "https://app.example.com",
        cancelUrl: "https://app.example.com/billing/fail",
      })).rejects.toThrow(/test keys only/);
      expect(createProductOrderMock).not.toHaveBeenCalled();
    } finally {
      serverEnv.TOSS_SECRET_KEY = original;
    }
  });

  it("approves the exact one-time amount and grants credits once through the DB boundary", async () => {
    getCheckoutSessionMock.mockResolvedValue(productSession);
    claimCheckoutSessionMock.mockResolvedValue(productSession);
    getProductOrderByCheckoutSessionMock.mockResolvedValue({ id: "order-db-1", price_krw: 19900 });
    confirmPaymentMock.mockResolvedValue({ paymentKey: "pay-1", orderId: "order_product_1", status: "DONE", totalAmount: 19900 });
    completeProductOrderMock.mockResolvedValue({ order: { id: "order-db-1" }, grantId: "grant-1" });

    const result = await new TossBillingProvider().confirmOrder({
      userId: "user-1",
      sessionId: "session-1",
      paymentKey: "pay-1",
      providerOrderId: "order_product_1",
      amount: 19900,
    });

    expect(confirmPaymentMock).toHaveBeenCalledWith({ paymentKey: "pay-1", orderId: "order_product_1", amount: 19900, idempotencyKey: "session-1-confirm" });
    expect(completeProductOrderMock).toHaveBeenCalledWith("order-db-1", "pay-1");
    expect(result).toEqual({ orderId: "order-db-1", productId: "SHORTS_3", grantId: "grant-1", provider: "toss" });
  });

  it("does not call Toss again when an already-completed callback is retried", async () => {
    const succeeded = { ...productSession, status: "SUCCEEDED", provider_payment_key: "pay-1" };
    getCheckoutSessionMock.mockResolvedValue(succeeded);
    claimCheckoutSessionMock.mockResolvedValue(succeeded);
    getProductOrderByCheckoutSessionMock.mockResolvedValue({ id: "order-db-1", price_krw: 19900 });
    completeProductOrderMock.mockResolvedValue({ order: { id: "order-db-1" }, grantId: "grant-1" });

    await new TossBillingProvider().confirmOrder({ userId: "user-1", sessionId: "session-1", paymentKey: "pay-1", providerOrderId: "order_product_1", amount: 19900 });

    expect(confirmPaymentMock).not.toHaveBeenCalled();
    expect(completeProductOrderMock).toHaveBeenCalledTimes(1);
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
