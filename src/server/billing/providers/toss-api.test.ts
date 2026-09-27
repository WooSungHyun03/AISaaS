import { describe, expect, it, vi } from "vitest";
import { TossApiClient, TossApiError } from "./toss-api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("TossApiClient", () => {
  it("issues a billing key with server-side Basic auth and an idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { billingKey: "billing-secret", customerKey: "cus_123" }));
    const client = new TossApiClient("test_sk_secret", fetchMock as typeof fetch, "https://toss.test");

    const result = await client.issueBillingKey("one-time-auth", "cus_123", "session-issue");

    expect(result.billingKey).toBe("billing-secret");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://toss.test/v1/billing/authorizations/issue",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from("test_sk_secret:").toString("base64")}`,
          "Idempotency-Key": "session-issue",
        }),
      }),
    );
  });

  it("charges the exact supplied amount and reuses the caller's stable order id", async () => {
    const payment = { paymentKey: "pay_1", orderId: "order_123456", status: "DONE", totalAmount: 19000 };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, payment));
    const client = new TossApiClient("test_sk_secret", fetchMock as typeof fetch, "https://toss.test");

    await client.chargeBillingKey({
      billingKey: "billing-secret",
      customerKey: "cus_123",
      amount: 19000,
      orderId: "order_123456",
      orderName: "AutoBiz Starter 월 구독",
      idempotencyKey: "session-charge",
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      customerKey: "cus_123",
      amount: 19000,
      orderId: "order_123456",
      orderName: "AutoBiz Starter 월 구독",
    });
    expect(init.headers).toEqual(expect.objectContaining({ "Idempotency-Key": "session-charge" }));
  });

  it("preserves Toss decline codes for the failure screen", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { code: "REJECT_CARD_COMPANY", message: "declined" }));
    const client = new TossApiClient("test_sk_secret", fetchMock as typeof fetch, "https://toss.test");

    const error = await client.issueBillingKey("auth", "cus_123", "session-issue").catch((caught) => caught);

    expect(error).toBeInstanceOf(TossApiError);
    expect((error as TossApiError).code).toBe("REJECT_CARD_COMPANY");
    expect((error as TossApiError).status).toBe(400);
  });

  it("classifies an uncertain network failure without retrying a possible charge", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    const client = new TossApiClient("test_sk_secret", fetchMock as typeof fetch, "https://toss.test");

    const error = await client.chargeBillingKey({
      billingKey: "billing-secret",
      customerKey: "cus_123",
      amount: 49000,
      orderId: "order_123456",
      orderName: "AutoBiz Pro 월 구독",
      idempotencyKey: "session-charge",
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(TossApiError);
    expect((error as TossApiError).code).toBe("TOSS_NETWORK_ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
