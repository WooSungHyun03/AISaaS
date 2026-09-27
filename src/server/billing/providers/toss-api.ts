import "server-only";

const TOSS_API_URL = "https://api.tosspayments.com";

interface TossErrorPayload {
  code?: string;
  message?: string;
}

export interface TossBillingKeyResponse {
  billingKey: string;
  customerKey: string;
}

export interface TossPaymentResponse {
  paymentKey: string;
  orderId: string;
  status: string;
  totalAmount: number;
}

export class TossApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "TossApiError";
  }
}

type Fetcher = typeof fetch;

export class TossApiClient {
  constructor(
    private readonly secretKey: string,
    private readonly fetcher: Fetcher = fetch,
    private readonly baseUrl = TOSS_API_URL,
  ) {}

  private async request<T>(path: string, init: RequestInit, idempotencyKey?: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString("base64")}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          ...init.headers,
        },
        signal: init.signal ?? AbortSignal.timeout(65_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network request failed";
      throw new TossApiError("TOSS_NETWORK_ERROR", message, 503);
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as TossErrorPayload;
      throw new TossApiError(body.code ?? "TOSS_API_ERROR", body.message ?? "토스페이먼츠 요청에 실패했습니다.", response.status);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  issueBillingKey(authKey: string, customerKey: string, idempotencyKey: string) {
    return this.request<TossBillingKeyResponse>(
      "/v1/billing/authorizations/issue",
      { method: "POST", body: JSON.stringify({ authKey, customerKey }) },
      idempotencyKey,
    );
  }

  chargeBillingKey(params: {
    billingKey: string;
    customerKey: string;
    amount: number;
    orderId: string;
    orderName: string;
    idempotencyKey: string;
  }) {
    return this.request<TossPaymentResponse>(
      `/v1/billing/${encodeURIComponent(params.billingKey)}`,
      {
        method: "POST",
        body: JSON.stringify({
          customerKey: params.customerKey,
          amount: params.amount,
          orderId: params.orderId,
          orderName: params.orderName,
        }),
      },
      params.idempotencyKey,
    );
  }

  deleteBillingKey(billingKey: string) {
    return this.request<void>(`/v1/billing/${encodeURIComponent(billingKey)}`, { method: "DELETE" });
  }
}
