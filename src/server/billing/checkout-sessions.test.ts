import { afterEach, describe, expect, it, vi } from "vitest";

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ from: fromMock })) }));

const {
  BillingCheckoutError,
  activateSubscription,
  cancelStoredSubscription,
  claimCheckoutSession,
  createCheckoutSession,
  getCheckoutSession,
  getLatestSuccessfulCheckout,
  markCheckoutCanceled,
  markCheckoutFailed,
  markCheckoutSucceeded,
  saveBillingKey,
} = await import("./checkout-sessions");

/**
 * Minimal chainable stand-in for the Supabase query builder — every builder
 * method returns the same object, and the object itself resolves like the
 * real client for a chain that never terminates in `.single()`/`.maybeSingle()`.
 */
function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: typeof result) => unknown) => resolve(result),
  };
  return builder;
}

const SESSION_ROW = {
  id: "session-1",
  user_id: "user-1",
  plan: "STARTER" as const,
  provider: "toss" as const,
  status: "PENDING" as const,
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

describe("createCheckoutSession", () => {
  it("inserts a row with a unique opaque customer key and order id", async () => {
    const inserted = makeBuilder({ data: SESSION_ROW, error: null });
    fromMock.mockReturnValueOnce(inserted);

    const result = await createCheckoutSession("user-1", "STARTER", "toss");

    expect(fromMock).toHaveBeenCalledWith("billing_checkout_sessions");
    const payload = (inserted.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.user_id).toBe("user-1");
    expect(payload.plan).toBe("STARTER");
    expect(payload.provider).toBe("toss");
    expect(payload.customer_key).toMatch(/^cus_/);
    expect(payload.order_id).toMatch(/^order_[0-9a-f]+$/);
    expect(result).toEqual(SESSION_ROW);
  });

  it("propagates the underlying DB error", async () => {
    fromMock.mockReturnValueOnce(makeBuilder({ data: null, error: { message: "insert failed" } }));
    await expect(createCheckoutSession("user-1", "PRO", "mock")).rejects.toEqual({ message: "insert failed" });
  });
});

describe("getCheckoutSession", () => {
  it("scopes the lookup to id and user id", async () => {
    const builder = makeBuilder({ data: SESSION_ROW, error: null });
    fromMock.mockReturnValueOnce(builder);

    const result = await getCheckoutSession("session-1", "user-1");

    expect(builder.eq).toHaveBeenCalledWith("id", "session-1");
    expect(builder.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(result).toEqual(SESSION_ROW);
  });

  it("throws a BillingCheckoutError instead of returning null when no session is found", async () => {
    fromMock.mockReturnValueOnce(makeBuilder({ data: null, error: null }));
    const error = await getCheckoutSession("missing", "user-1").catch((caught) => caught);
    expect(error).toBeInstanceOf(BillingCheckoutError);
    expect((error as InstanceType<typeof BillingCheckoutError>).code).toBe("CHECKOUT_NOT_FOUND");
  });
});

describe("claimCheckoutSession", () => {
  it("transitions a PENDING session to PROCESSING", async () => {
    fromMock.mockReturnValueOnce(makeBuilder({ data: SESSION_ROW, error: null }));
    const claimed = makeBuilder({ data: { ...SESSION_ROW, status: "PROCESSING" }, error: null });
    fromMock.mockReturnValueOnce(claimed);

    const result = await claimCheckoutSession("session-1", "user-1", "toss");

    expect(claimed.update).toHaveBeenCalledWith({ status: "PROCESSING", error_code: null, error_message: null });
    expect(claimed.in).toHaveBeenCalledWith("status", ["PENDING", "FAILED"]);
    expect(result.status).toBe("PROCESSING");
  });

  it("returns the existing session idempotently when it already succeeded, without writing anything", async () => {
    fromMock.mockReturnValueOnce(makeBuilder({ data: { ...SESSION_ROW, status: "SUCCEEDED" }, error: null }));

    const result = await claimCheckoutSession("session-1", "user-1", "toss");

    expect(result.status).toBe("SUCCEEDED");
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a mismatched provider", async () => {
    fromMock.mockReturnValueOnce(makeBuilder({ data: { ...SESSION_ROW, provider: "mock" }, error: null }));
    const error = await claimCheckoutSession("session-1", "user-1", "toss").catch((caught) => caught);
    expect((error as InstanceType<typeof BillingCheckoutError>).code).toBe("PROVIDER_MISMATCH");
  });

  it("rejects a session already being processed by another request", async () => {
    fromMock.mockReturnValueOnce(makeBuilder({ data: { ...SESSION_ROW, status: "PROCESSING" }, error: null }));
    const error = await claimCheckoutSession("session-1", "user-1", "toss").catch((caught) => caught);
    expect((error as InstanceType<typeof BillingCheckoutError>).code).toBe("CHECKOUT_IN_PROGRESS");
  });

  it("rejects a canceled session", async () => {
    fromMock.mockReturnValueOnce(makeBuilder({ data: { ...SESSION_ROW, status: "CANCELED" }, error: null }));
    const error = await claimCheckoutSession("session-1", "user-1", "toss").catch((caught) => caught);
    expect((error as InstanceType<typeof BillingCheckoutError>).code).toBe("CHECKOUT_CANCELED");
  });

  it("rejects an expired session before ever attempting to claim it", async () => {
    const expired = { ...SESSION_ROW, expires_at: new Date(Date.now() - 1000).toISOString() };
    fromMock.mockReturnValueOnce(makeBuilder({ data: expired, error: null }));

    const error = await claimCheckoutSession("session-1", "user-1", "toss").catch((caught) => caught);

    expect((error as InstanceType<typeof BillingCheckoutError>).code).toBe("CHECKOUT_EXPIRED");
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a race where a concurrent claim already moved the row out of PENDING/FAILED", async () => {
    fromMock.mockReturnValueOnce(makeBuilder({ data: SESSION_ROW, error: null }));
    fromMock.mockReturnValueOnce(makeBuilder({ data: null, error: null }));

    const error = await claimCheckoutSession("session-1", "user-1", "toss").catch((caught) => caught);

    expect((error as InstanceType<typeof BillingCheckoutError>).code).toBe("CHECKOUT_IN_PROGRESS");
  });
});

describe("saveBillingKey / markCheckoutSucceeded / markCheckoutFailed / markCheckoutCanceled", () => {
  it("saveBillingKey writes the billing key scoped by session id", async () => {
    const builder = makeBuilder({ data: null, error: null });
    fromMock.mockReturnValueOnce(builder);
    await saveBillingKey("session-1", "billing-key-1");
    expect(builder.update).toHaveBeenCalledWith({ provider_billing_key: "billing-key-1" });
    expect(builder.eq).toHaveBeenCalledWith("id", "session-1");
  });

  it("markCheckoutSucceeded clears any previous error and stamps completed_at", async () => {
    const builder = makeBuilder({ data: null, error: null });
    fromMock.mockReturnValueOnce(builder);
    await markCheckoutSucceeded("session-1", "pay_1");
    const payload = (builder.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.status).toBe("SUCCEEDED");
    expect(payload.provider_payment_key).toBe("pay_1");
    expect(payload.error_code).toBeNull();
    expect(typeof payload.completed_at).toBe("string");
  });

  it("markCheckoutFailed truncates an overly long provider message", async () => {
    const builder = makeBuilder({ data: null, error: null });
    fromMock.mockReturnValueOnce(builder);
    await markCheckoutFailed("session-1", "REJECT_CARD_COMPANY", "x".repeat(1000));
    const payload = (builder.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.status).toBe("FAILED");
    expect(payload.error_message).toHaveLength(500);
  });

  it("markCheckoutCanceled only touches a PENDING/FAILED row, never an already-succeeded one", async () => {
    const builder = makeBuilder({ data: null, error: null });
    fromMock.mockReturnValueOnce(builder);
    await markCheckoutCanceled("session-1");
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "CANCELED", error_code: "PAY_PROCESS_CANCELED" }),
    );
    expect(builder.in).toHaveBeenCalledWith("status", ["PENDING", "FAILED"]);
  });
});

describe("activateSubscription / cancelStoredSubscription", () => {
  it("upserts a one-month ACTIVE subscription keyed by user id, storing only the opaque session id", async () => {
    const builder = makeBuilder({ data: null, error: null });
    (builder as Record<string, unknown>).upsert = vi.fn(() => builder);
    fromMock.mockReturnValueOnce(builder);

    await activateSubscription("user-1", "PRO", "toss", "session-1");

    const [payload, options] = (builder.upsert as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.user_id).toBe("user-1");
    expect(payload.plan).toBe("PRO");
    expect(payload.status).toBe("ACTIVE");
    expect(payload.provider).toBe("toss");
    expect(payload.provider_customer_id).toBe("session-1");
    expect(payload.provider_subscription_id).toBe("session-1");
    expect(new Date(payload.current_period_end).getTime()).toBeGreaterThan(new Date(payload.current_period_start).getTime());
    expect(options).toEqual({ onConflict: "user_id" });
  });

  it("cancelStoredSubscription marks the row CANCELED scoped by user id", async () => {
    const builder = makeBuilder({ data: null, error: null });
    fromMock.mockReturnValueOnce(builder);
    await cancelStoredSubscription("user-1");
    expect(builder.update).toHaveBeenCalledWith({ status: "CANCELED" });
    expect(builder.eq).toHaveBeenCalledWith("user_id", "user-1");
  });
});

describe("getLatestSuccessfulCheckout", () => {
  it("returns the most recent SUCCEEDED session for the given provider", async () => {
    const builder = makeBuilder({ data: SESSION_ROW, error: null });
    fromMock.mockReturnValueOnce(builder);

    const result = await getLatestSuccessfulCheckout("user-1", "toss");

    expect(builder.eq).toHaveBeenCalledWith("status", "SUCCEEDED");
    expect(builder.order).toHaveBeenCalledWith("completed_at", { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(1);
    expect(result).toEqual(SESSION_ROW);
  });

  it("returns null when there is no successful checkout yet", async () => {
    fromMock.mockReturnValueOnce(makeBuilder({ data: null, error: null }));
    const result = await getLatestSuccessfulCheckout("user-1", "toss");
    expect(result).toBeNull();
  });
});
