import { afterEach, describe, expect, it, vi } from "vitest";
import { AIProviderError } from "./errors";
import { fetchWithRetry } from "./http";

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchWithRetry", () => {
  it("returns the response on first success, no retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRetry("https://example.test", {}, { provider: "test", maxRetries: 2 });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 (rate limited) and succeeds on the next attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: "slow down" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithRetry("https://example.test", {}, { provider: "test", maxRetries: 2 });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 401 — surfaces MISSING_API_KEY immediately", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: "bad key" }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await fetchWithRetry("https://example.test", {}, { provider: "test", maxRetries: 3 }).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(AIProviderError);
    expect((error as AIProviderError).code).toBe("MISSING_API_KEY");
    expect((error as AIProviderError).retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exhausts a bounded number of retries on repeated 5xx and throws PROVIDER_UNAVAILABLE", async () => {
    // A fresh Response per call — reusing one instance would throw on the
    // second `.text()` read (body already consumed), which is not what this
    // test is exercising.
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(503, { error: "down" })));
    vi.stubGlobal("fetch", fetchMock);

    const error = await fetchWithRetry("https://example.test", {}, { provider: "test", maxRetries: 1 }).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(AIProviderError);
    expect((error as AIProviderError).code).toBe("PROVIDER_UNAVAILABLE");
    // Initial attempt + 1 retry = 2 calls, never more (no infinite retry).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("classifies a raw network failure (fetch rejection) as NETWORK_FAILURE", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    const error = await fetchWithRetry("https://example.test", {}, { provider: "test", maxRetries: 0 }).catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(AIProviderError);
    expect((error as AIProviderError).code).toBe("NETWORK_FAILURE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies an aborted request (timeout) as TIMEOUT", async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const abortError = new Error("aborted");
            abortError.name = "AbortError";
            reject(abortError);
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await fetchWithRetry(
      "https://example.test",
      {},
      { provider: "test", maxRetries: 0, timeoutMs: 10 },
    ).catch((e) => e);

    expect(error).toBeInstanceOf(AIProviderError);
    expect((error as AIProviderError).code).toBe("TIMEOUT");
  });
});
