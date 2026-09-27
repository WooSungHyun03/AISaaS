import { afterEach, describe, expect, it, vi } from "vitest";
import { isConnectorError } from "@/server/shared/errors";

vi.mock("@/lib/env/server", () => ({
  serverEnv: { RESEND_API_KEY: "re_test_key", RESEND_FROM_EMAIL: "hello@example.com" },
}));

const { ResendConnector } = await import("./resend");

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const SEND_PARAMS = {
  to: { email: "subscriber@example.com", name: "구독자" },
  subject: "이번 주 소식",
  html: "<p>안녕하세요</p>",
  idempotencyKey: "run-1:sub-1",
};

describe("ResendConnector.send", () => {
  it("isConfigured() is true once both env vars are present", () => {
    expect(new ResendConnector().isConfigured()).toBe(true);
  });

  it("sends with the from address, recipient, subject/html, and passes the idempotency key through", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "msg-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new ResendConnector().send(SEND_PARAMS);

    expect(result).toEqual({ messageId: "msg-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers["Authorization"]).toBe("Bearer re_test_key");
    expect(init.headers["Idempotency-Key"]).toBe("run-1:sub-1");
    expect(JSON.parse(init.body)).toEqual({
      from: "hello@example.com",
      to: ["subscriber@example.com"],
      subject: "이번 주 소식",
      html: "<p>안녕하세요</p>",
    });
  });

  it("does not retry a 401 — surfaces AUTH_FAILED immediately", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { message: "invalid api key" }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await new ResendConnector().send(SEND_PARAMS).catch((e) => e);

    expect(isConnectorError(error)).toBe(true);
    expect(error.code).toBe("AUTH_FAILED");
    expect(error.retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 422 (validation error, e.g. malformed recipient) — surfaces UPSTREAM_CLIENT_ERROR", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(422, { message: "invalid `to` field" }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await new ResendConnector().send(SEND_PARAMS).catch((e) => e);

    expect(isConnectorError(error)).toBe(true);
    expect(error.code).toBe("UPSTREAM_CLIENT_ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx once (bounded) and succeeds on the second attempt, reusing the same idempotency key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { message: "down" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "msg-2" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new ResendConnector().send(SEND_PARAMS);

    expect(result).toEqual({ messageId: "msg-2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstKey = fetchMock.mock.calls[0][1].headers["Idempotency-Key"];
    const secondKey = fetchMock.mock.calls[1][1].headers["Idempotency-Key"];
    expect(firstKey).toBe(secondKey);
  });

  it("exhausts its bounded retry on repeated 5xx and throws UPSTREAM_SERVER_ERROR (never more than 1 retry)", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(500, { message: "down" })));
    vi.stubGlobal("fetch", fetchMock);

    const error = await new ResendConnector().send(SEND_PARAMS).catch((e) => e);

    expect(isConnectorError(error)).toBe(true);
    expect(error.code).toBe("UPSTREAM_SERVER_ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("classifies a raw network failure as NETWORK_FAILURE", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    const error = await new ResendConnector().send(SEND_PARAMS).catch((e) => e);

    expect(isConnectorError(error)).toBe(true);
    expect(error.code).toBe("NETWORK_FAILURE");
  });

  it("classifies an abort as TIMEOUT", async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });
    vi.stubGlobal("fetch", fetchMock);

    const error = await new ResendConnector().send(SEND_PARAMS).catch((e) => e);

    expect(isConnectorError(error)).toBe(true);
    expect(error.code).toBe("TIMEOUT");
  });
});
