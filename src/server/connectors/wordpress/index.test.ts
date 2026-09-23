import type { LookupAddress } from "node:dns";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isConnectorError } from "@/server/shared/errors";
import { WordPressConnector, normalizeWordPressSiteUrl } from "./index";

const { httpsRequestMock, lookupMock } = vi.hoisted(() => ({
  httpsRequestMock: vi.fn(),
  lookupMock: vi.fn().mockResolvedValue([{ address: "93.184.215.14", family: 4 }]),
}));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));
vi.mock("node:https", () => ({ request: httpsRequestMock }));

afterEach(() => vi.clearAllMocks());

type MockRequest = EventEmitter & {
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  setTimeout: ReturnType<typeof vi.fn>;
  fireTimeout: () => void;
};

function makeMockRequest(): MockRequest {
  const request = new EventEmitter() as MockRequest;
  request.write = vi.fn();
  request.end = vi.fn();
  request.destroy = vi.fn((err?: Error) => {
    if (err) queueMicrotask(() => request.emit("error", err));
  });
  let timeoutCallback: (() => void) | undefined;
  request.setTimeout = vi.fn((_ms: number, cb: () => void) => {
    timeoutCallback = cb;
  });
  request.fireTimeout = () => timeoutCallback?.();
  return request;
}

/** Responds with a JSON body and the given status once the request completes. */
function respondWith(request: MockRequest, callback: (response: EventEmitter & { statusCode?: number }) => void, status: number, body: unknown = {}) {
  const response = Object.assign(new EventEmitter(), { statusCode: status });
  queueMicrotask(() => {
    callback(response);
    response.emit("data", Buffer.from(JSON.stringify(body)));
    response.emit("end");
  });
  return request;
}

const CONNECTION = { siteUrl: "https://example.com", username: "writer", appPassword: "secret" };

describe("normalizeWordPressSiteUrl", () => {
  it("accepts public HTTPS origins and rejects local or insecure targets", () => {
    expect(normalizeWordPressSiteUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeWordPressSiteUrl("https://example.com/blog/")).toBe("https://example.com/blog");
    expect(() => normalizeWordPressSiteUrl("http://example.com")).toThrow();
    expect(() => normalizeWordPressSiteUrl("https://127.0.0.1")).toThrow();
    expect(() => normalizeWordPressSiteUrl("https://example.com:8443")).toThrow();
  });
});

describe("WordPressConnector happy path", () => {
  it("checks credentials and sends the requested draft status to the validated address", async () => {
    let capturedRequest: MockRequest | undefined;
    httpsRequestMock.mockImplementation((_url: string, _options: object, callback: (response: EventEmitter & { statusCode?: number }) => void) => {
      const request = makeMockRequest();
      capturedRequest = request;
      return respondWith(request, callback, 200, { id: 17, link: "https://example.com/?p=17" });
    });

    const connector = new WordPressConnector(CONNECTION);
    await connector.testConnection();
    const saved = await connector.publish({ title: "제목", content: "본문" }, "draft");

    expect(httpsRequestMock.mock.calls[0][0]).toBe("https://example.com/wp-json/wp/v2/users/me");
    expect(httpsRequestMock.mock.calls[1][1].lookup).toBeTypeOf("function");
    expect(JSON.parse(capturedRequest!.write.mock.calls[0][0])).toEqual({ title: "제목", content: "본문", status: "draft" });
    expect(saved.externalUrl).toBe("https://example.com/?p=17");
    expect(saved.externalId).toBe("17");
  });

  it("defaults publish status to \"publish\" when not specified", async () => {
    httpsRequestMock.mockImplementation((_url: string, _options: object, callback: (response: EventEmitter & { statusCode?: number }) => void) => {
      return respondWith(makeMockRequest(), callback, 200, { id: 1, link: "https://example.com/?p=1" });
    });

    const connector = new WordPressConnector(CONNECTION);
    await connector.publish({ title: "제목", content: "본문" });

    expect(JSON.parse(httpsRequestMock.mock.results[0].value.write.mock.calls[0][0]).status).toBe("publish");
  });
});

describe("WordPressConnector HTTP status classification", () => {
  const cases: Array<[number, string]> = [
    [401, "AUTH_FAILED"],
    [403, "PERMISSION_DENIED"],
    [404, "UPSTREAM_CLIENT_ERROR"],
    [500, "UPSTREAM_SERVER_ERROR"],
    [503, "UPSTREAM_SERVER_ERROR"],
  ];

  for (const [status, code] of cases) {
    it(`classifies testConnection() HTTP ${status} as ${code}`, async () => {
      httpsRequestMock.mockImplementation((_url: string, _options: object, callback: (response: EventEmitter & { statusCode?: number }) => void) => {
        return respondWith(makeMockRequest(), callback, status);
      });

      const connector = new WordPressConnector(CONNECTION);
      const error = await connector.testConnection().catch((e: unknown) => e);
      expect(isConnectorError(error)).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((error as any).code).toBe(code);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((error as any).connector ?? (error as any).domain).toBe("wordpress");
    });

    it(`classifies publish() HTTP ${status} as ${code}`, async () => {
      httpsRequestMock.mockImplementation((_url: string, _options: object, callback: (response: EventEmitter & { statusCode?: number }) => void) => {
        return respondWith(makeMockRequest(), callback, status);
      });

      const connector = new WordPressConnector(CONNECTION);
      const error = await connector.publish({ title: "t", content: "c" }).catch((e: unknown) => e);
      expect(isConnectorError(error)).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((error as any).code).toBe(code);
    });
  }
});

/** Waits until the (async, promise-chained) DNS lookup resolves and the mocked `https.request` is actually invoked. */
async function waitForRequest() {
  while (httpsRequestMock.mock.calls.length === 0) {
    await Promise.resolve();
  }
}

describe("WordPressConnector transport failure classification", () => {
  it("classifies a request timeout as ConnectorError TIMEOUT", async () => {
    httpsRequestMock.mockImplementation(() => makeMockRequest());

    const connector = new WordPressConnector(CONNECTION);
    const promise = connector.testConnection();
    await waitForRequest();
    const request: MockRequest = httpsRequestMock.mock.results[0].value;
    request.fireTimeout();

    const error = await promise.catch((e: unknown) => e);
    expect(isConnectorError(error)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((error as any).code).toBe("TIMEOUT");
  });

  it("classifies a raw connection error (not preceded by a timeout) as NETWORK_FAILURE", async () => {
    httpsRequestMock.mockImplementation(() => {
      const request = makeMockRequest();
      queueMicrotask(() => request.emit("error", new Error("ECONNREFUSED")));
      return request;
    });

    const connector = new WordPressConnector(CONNECTION);
    const error = await connector.testConnection().catch((e: unknown) => e);
    expect(isConnectorError(error)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((error as any).code).toBe("NETWORK_FAILURE");
  });

  it("classifies an oversized response body as NETWORK_FAILURE", async () => {
    httpsRequestMock.mockImplementation((_url: string, _options: object, callback: (response: EventEmitter & { statusCode?: number }) => void) => {
      const request = makeMockRequest();
      const response = Object.assign(new EventEmitter(), { statusCode: 200 }) as EventEmitter & { statusCode: number; destroy: ReturnType<typeof vi.fn> };
      response.destroy = vi.fn((err?: Error) => {
        if (err) queueMicrotask(() => response.emit("error", err));
      });
      queueMicrotask(() => {
        callback(response);
        response.emit("data", Buffer.alloc(1_000_001));
      });
      return request;
    });

    const connector = new WordPressConnector(CONNECTION);
    const error = await connector.testConnection().catch((e: unknown) => e);
    expect(isConnectorError(error)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((error as any).code).toBe("NETWORK_FAILURE");
  });

  it("classifies an unresolvable site address as INVALID_TARGET instead of a raw DNS error", async () => {
    lookupMock.mockRejectedValueOnce(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }));

    const connector = new WordPressConnector(CONNECTION);
    const error = await connector.testConnection().catch((e: unknown) => e);
    expect(isConnectorError(error)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((error as any).code).toBe("INVALID_TARGET");
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it("classifies a site that resolves to a private/internal address as INVALID_TARGET", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }] as LookupAddress[]);

    const connector = new WordPressConnector(CONNECTION);
    const error = await connector.testConnection().catch((e: unknown) => e);
    expect(isConnectorError(error)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((error as any).code).toBe("INVALID_TARGET");
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });
});

describe("WordPressConnector configuration", () => {
  it("throws NOT_CONFIGURED when built from env vars that are absent", async () => {
    const connector = new WordPressConnector();
    expect(connector.isConfigured()).toBe(false);
    const error = await connector.testConnection().catch((e: unknown) => e);
    expect(isConnectorError(error)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((error as any).code).toBe("NOT_CONFIGURED");
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });
});
