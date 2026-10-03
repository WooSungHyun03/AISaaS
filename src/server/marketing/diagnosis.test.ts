import type { LookupAddress } from "node:dns";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const { httpRequestMock, httpsRequestMock, lookupMock, generateStructuredMock } = vi.hoisted(() => ({
  httpRequestMock: vi.fn(),
  httpsRequestMock: vi.fn(),
  lookupMock: vi.fn().mockResolvedValue([{ address: "93.184.215.14", family: 4 }]),
  generateStructuredMock: vi.fn(),
}));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));
vi.mock("node:http", () => ({ request: httpRequestMock }));
vi.mock("node:https", () => ({ request: httpsRequestMock }));
vi.mock("@/server/ai/generate", () => ({ generateStructured: generateStructuredMock }));

const { diagnoseWebsite, fetchPublicHtml, DiagnosisError } = await import("./diagnosis");

afterEach(() => vi.clearAllMocks());

type MockRequest = EventEmitter & {
  end: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  setTimeout: ReturnType<typeof vi.fn>;
};

function makeMockRequest(): MockRequest {
  const request = new EventEmitter() as MockRequest;
  request.end = vi.fn();
  request.destroy = vi.fn((err?: Error) => {
    if (err) queueMicrotask(() => request.emit("error", err));
  });
  request.setTimeout = vi.fn();
  return request;
}

type MockResponse = EventEmitter & { statusCode: number; headers: Record<string, string>; destroy: ReturnType<typeof vi.fn> };

function makeMockResponse(status: number, headers: Record<string, string> = {}): MockResponse {
  const response = Object.assign(new EventEmitter(), { statusCode: status, headers }) as MockResponse;
  response.destroy = vi.fn((err?: Error) => {
    if (err) queueMicrotask(() => response.emit("error", err));
  });
  return response;
}

/** Wires one https.request() call to respond with `response`, emitting `body` as a single chunk unless the status is a redirect (no body consumed on 3xx). */
function mockOneRequest(response: MockResponse, body = "<html></html>") {
  httpsRequestMock.mockImplementationOnce((_url: string, _options: object, callback: (res: MockResponse) => void) => {
    const request = makeMockRequest();
    queueMicrotask(() => {
      callback(response);
      if (response.statusCode < 300 || response.statusCode >= 400) {
        response.emit("data", Buffer.from(body));
        response.emit("end");
      }
    });
    return request;
  });
}

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" };

describe("fetchPublicHtml — SSRF blocking", () => {
  it("blocks a hostname that resolves to localhost/loopback", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }] as LookupAddress[]);

    const error = await fetchPublicHtml("http://localhost/").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DiagnosisError);
    expect((error as InstanceType<typeof DiagnosisError>).code).toBe("BLOCKED_TARGET");
    expect(httpsRequestMock).not.toHaveBeenCalled();
    expect(httpRequestMock).not.toHaveBeenCalled();
  });

  it("blocks a hostname that resolves to a private IPv4 address", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }] as LookupAddress[]);

    const error = await fetchPublicHtml("https://example.com/").catch((e: unknown) => e);

    expect((error as InstanceType<typeof DiagnosisError>).code).toBe("BLOCKED_TARGET");
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it("blocks the cloud metadata address 169.254.169.254", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }] as LookupAddress[]);

    const error = await fetchPublicHtml("https://example.com/").catch((e: unknown) => e);

    expect((error as InstanceType<typeof DiagnosisError>).code).toBe("BLOCKED_TARGET");
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it("blocks an IPv6 private/ULA address", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "fd00::1", family: 6 }] as LookupAddress[]);

    const error = await fetchPublicHtml("https://example.com/").catch((e: unknown) => e);

    expect((error as InstanceType<typeof DiagnosisError>).code).toBe("BLOCKED_TARGET");
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it("rejects a non-http(s) scheme before any DNS lookup", async () => {
    const error = await fetchPublicHtml("file:///etc/passwd").catch((e: unknown) => e);

    expect((error as InstanceType<typeof DiagnosisError>).code).toBe("INVALID_URL");
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("blocks a public URL that redirects to a private IP, by re-validating the redirect target before connecting", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "93.184.215.14", family: 4 }]); // first hop: public
    lookupMock.mockResolvedValueOnce([{ address: "10.0.0.9", family: 4 }]); // redirect target: private

    mockOneRequest(makeMockResponse(302, { location: "https://internal.example.com/" }));

    const error = await fetchPublicHtml("https://example.com/").catch((e: unknown) => e);

    expect((error as InstanceType<typeof DiagnosisError>).code).toBe("BLOCKED_TARGET");
    // Only the first (public) hop actually connects — the redirect target is
    // blocked at DNS-validation time, before a second request is ever made.
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after exceeding the redirect limit", async () => {
    // MAX_REDIRECTS=3: the initial request plus 3 redirect hops all return
    // 302 — the 4th hop's own redirectsLeft has hit 0, so it rejects without
    // a 5th request ever being made.
    for (let i = 0; i < 4; i++) {
      mockOneRequest(makeMockResponse(302, { location: `https://example.com/next-${i}` }));
    }

    const error = await fetchPublicHtml("https://example.com/start").catch((e: unknown) => e);

    expect((error as InstanceType<typeof DiagnosisError>).code).toBe("TOO_MANY_REDIRECTS");
    expect(httpsRequestMock).toHaveBeenCalledTimes(4);
  });
});

describe("fetchPublicHtml — happy path", () => {
  it("fetches a normal public URL with exactly one request", async () => {
    mockOneRequest(makeMockResponse(200, HTML_HEADERS), "<html><title>Hi</title></html>");

    const result = await fetchPublicHtml("https://example.com/");

    expect(result.html).toBe("<html><title>Hi</title></html>");
    expect(result.finalUrl).toBe("https://example.com/");
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
  });

  it("rejects non-text/html responses", async () => {
    mockOneRequest(makeMockResponse(200, { "content-type": "application/pdf" }));

    const error = await fetchPublicHtml("https://example.com/file.pdf").catch((e: unknown) => e);

    expect((error as InstanceType<typeof DiagnosisError>).code).toBe("UNSUPPORTED_CONTENT");
  });

  it("rejects a response body over the size cap", async () => {
    httpsRequestMock.mockImplementationOnce((_url: string, _options: object, callback: (res: MockResponse) => void) => {
      const request = makeMockRequest();
      const response = makeMockResponse(200, HTML_HEADERS);
      queueMicrotask(() => {
        callback(response);
        response.emit("data", Buffer.alloc(2_000_001));
      });
      return request;
    });

    const error = await fetchPublicHtml("https://example.com/").catch((e: unknown) => e);

    expect((error as InstanceType<typeof DiagnosisError>).code).toBe("TOO_LARGE");
  });
});

const BUSINESS = { name: "우리가게", industry: "카페" };
const VALID_AI_RESULT = {
  score: 72,
  missingChannels: ["instagram"],
  contentStatus: "최근 6개월간 업데이트가 없습니다.",
  snsActivity: "SNS 연동이 확인되지 않습니다.",
  recommendations: ["인스타그램 계정을 연결하세요."],
  mainOffering: null,
  strengths: null,
  marketingGoal: null,
};

describe("diagnoseWebsite", () => {
  it("fetches once, extracts signals, and returns the AI's structured diagnosis", async () => {
    mockOneRequest(
      makeMockResponse(200, HTML_HEADERS),
      '<html><head><title>우리가게</title><meta name="description" content="맛있는 커피"></head><body>환영합니다</body></html>',
    );
    generateStructuredMock.mockResolvedValue(VALID_AI_RESULT);

    const result = await diagnoseWebsite(BUSINESS, "https://example.com/");

    expect(result).toMatchObject(VALID_AI_RESULT);
    expect(result.sourceUrl).toBe("https://example.com/");
    expect(result.rawSummary).toBe("우리가게 — 맛있는 커피");
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
    expect(generateStructuredMock).toHaveBeenCalledTimes(1);
    const promptArg = generateStructuredMock.mock.calls[0][0];
    expect(promptArg.prompt).toContain("맛있는 커피");
    expect(promptArg.system).toContain("지시");
  });

  it("surfaces an AI_INVALID_RESPONSE error when the AI's output never matches the schema", async () => {
    mockOneRequest(makeMockResponse(200, HTML_HEADERS), "<html></html>");
    generateStructuredMock.mockRejectedValue(new Error("AI response did not match the expected structure after 2 attempts."));

    const error = await diagnoseWebsite(BUSINESS, "https://example.com/").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DiagnosisError);
    expect((error as InstanceType<typeof DiagnosisError>).code).toBe("AI_INVALID_RESPONSE");
  });

  it("deterministically finds social/blog/place/channel links in <a href> attributes, independent of what the AI returns", async () => {
    mockOneRequest(
      makeMockResponse(200, HTML_HEADERS),
      '<html><body>'
        + '<a href="https://www.instagram.com/ourcafe">IG</a>'
        + '<a href="https://blog.naver.com/ourcafe">Blog</a>'
        + '<a href="https://map.naver.com/p/entry/place/123456">Place</a>'
        + '<a href="https://pf.kakao.com/_ourcafe">Channel</a>'
        + '</body></html>',
    );
    generateStructuredMock.mockResolvedValue(VALID_AI_RESULT);

    const result = await diagnoseWebsite(BUSINESS, "https://example.com/");

    expect(result.snsLinks).toEqual({
      instagram: "https://www.instagram.com/ourcafe",
      naver_blog: "https://blog.naver.com/ourcafe",
      naver_place: "https://map.naver.com/p/entry/place/123456",
      kakao_channel: "https://pf.kakao.com/_ourcafe",
    });
  });

  it("passes through AI-confident profile suggestions, and omits them (null) when the AI isn't sure", async () => {
    mockOneRequest(makeMockResponse(200, HTML_HEADERS), "<html></html>");
    generateStructuredMock.mockResolvedValue({
      ...VALID_AI_RESULT,
      mainOffering: "핸드드립 커피와 디저트",
      strengths: "직접 로스팅한 원두",
      marketingGoal: null,
    });

    const result = await diagnoseWebsite(BUSINESS, "https://example.com/");

    expect(result.mainOffering).toBe("핸드드립 커피와 디저트");
    expect(result.strengths).toBe("직접 로스팅한 원두");
    expect(result.marketingGoal).toBeNull();
  });
});
