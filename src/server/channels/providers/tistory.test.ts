import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const { httpsRequestMock, lookupMock } = vi.hoisted(() => ({
  httpsRequestMock: vi.fn(),
  lookupMock: vi.fn().mockResolvedValue([{ address: "93.184.215.14", family: 4 }]),
}));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));
vi.mock("node:https", () => ({ request: httpsRequestMock }));

const { collectTistoryRssMetrics } = await import("./tistory");
const { DiagnosisError } = await import("@/server/marketing/diagnosis");

afterEach(() => {
  vi.clearAllMocks();
  httpsRequestMock.mockReset();
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: "93.184.215.14", family: 4 }]);
});

type MockRequest = EventEmitter & { end: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; setTimeout: ReturnType<typeof vi.fn> };
type MockResponse = EventEmitter & { statusCode: number; headers: Record<string, string>; destroy: ReturnType<typeof vi.fn> };

function makeMockRequest(): MockRequest {
  const request = new EventEmitter() as MockRequest;
  request.end = vi.fn();
  request.destroy = vi.fn((err?: Error) => {
    if (err) queueMicrotask(() => request.emit("error", err));
  });
  request.setTimeout = vi.fn();
  return request;
}

function makeMockResponse(status: number, headers: Record<string, string> = {}): MockResponse {
  const response = Object.assign(new EventEmitter(), { statusCode: status, headers }) as MockResponse;
  response.destroy = vi.fn((err?: Error) => {
    if (err) queueMicrotask(() => response.emit("error", err));
  });
  return response;
}

function mockOneRequest(response: MockResponse, body = "") {
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

const XML_HEADERS = { "content-type": "application/xml; charset=utf-8" };

/** Trimmed from the real notice.tistory.com/rss response fetched 2026-10-10 — entity-escaped, no CDATA. */
const REAL_SHAPE_ENTITY_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>TISTORY</title>
    <link>https://notice.tistory.com/</link>
    <item>
      <title>[사전안내] 이모티콘, 스티커 기능 사용 종료 안내</title>
      <link>https://notice.tistory.com/2704</link>
      <description>&lt;p data-ke-size=&quot;size16&quot;&gt;안녕하세요. 티스토리팀입니다.&lt;/p&gt;</description>
      <author>TISTORY</author>
      <guid isPermaLink="true">https://notice.tistory.com/2704</guid>
      <pubDate>Mon, 24 Aug 2026 17:01:12 +0900</pubDate>
    </item>
    <item>
      <title>[안내] 불법촬영물 유통 방지 조치 대상 확대 안내</title>
      <link>https://notice.tistory.com/2702</link>
      <description>&lt;p&gt;안녕하세요. 티스토리입니다.&lt;/p&gt;</description>
      <pubDate>Thu, 25 Jun 2026 11:08:31 +0900</pubDate>
    </item>
  </channel>
</rss>`;

/** Constructed (not observed live) — some custom-skin Tistory feeds CDATA-wrap title/description. No live example was found during research; this covers that shape defensively. */
const CDATA_VARIANT_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title><![CDATA[내 블로그]]></title>
    <item>
      <title><![CDATA[소금빵 맛집 후기 & 추천]]></title>
      <link><![CDATA[https://myname.tistory.com/10]]></link>
      <description><![CDATA[<p>오늘은 소금빵 맛집을 다녀왔어요.</p>]]></description>
      <pubDate>Fri, 09 Oct 2026 09:00:00 +0900</pubDate>
    </item>
    <item>
      <title><![CDATA[카페 신메뉴 소개]]></title>
      <pubDate><![CDATA[Fri, 02 Oct 2026 09:00:00 +0900]]></pubDate>
    </item>
  </channel>
</rss>`;

describe("collectTistoryRssMetrics: real-shaped fixtures", () => {
  it("parses pubDate from an entity-escaped feed (no CDATA) with no title/description extraction", async () => {
    mockOneRequest(makeMockResponse(200, XML_HEADERS), REAL_SHAPE_ENTITY_FEED);
    const result = await collectTistoryRssMetrics("https://notice.tistory.com/");

    expect(result.unavailableReason).toBeNull();
    expect(result.posts).toEqual([
      { publishedAt: new Date("2026-08-24T17:01:12+09:00").toISOString() },
      { publishedAt: new Date("2026-06-25T11:08:31+09:00").toISOString() },
    ]);
  });

  it("parses pubDate from a CDATA-wrapped feed, including a CDATA-wrapped pubDate tag itself", async () => {
    mockOneRequest(makeMockResponse(200, XML_HEADERS), CDATA_VARIANT_FEED);
    const result = await collectTistoryRssMetrics("https://myname.tistory.com/");

    expect(result.unavailableReason).toBeNull();
    expect(result.posts).toEqual([
      { publishedAt: new Date("2026-10-09T09:00:00+09:00").toISOString() },
      { publishedAt: new Date("2026-10-02T09:00:00+09:00").toISOString() },
    ]);
  });

  it("requests {blogUrl}/rss, reusing the stored channel URL rather than rebuilding it from externalId", async () => {
    mockOneRequest(makeMockResponse(200, XML_HEADERS), "<rss><channel></channel></rss>");
    await collectTistoryRssMetrics("https://blog.mycompany.com/");
    const requestedUrl = httpsRequestMock.mock.calls[0][0] as string;
    expect(requestedUrl).toBe("https://blog.mycompany.com/rss");
  });
});

describe("collectTistoryRssMetrics: pubDate edge cases", () => {
  it("accepts GMT and skips an unparseable date instead of throwing", async () => {
    const feed = `<rss><channel>
      <item><pubDate>Fri, 09 Oct 2026 09:00:00 GMT</pubDate></item>
      <item><pubDate>이건 날짜가 아니에요</pubDate></item>
    </channel></rss>`;
    mockOneRequest(makeMockResponse(200, XML_HEADERS), feed);
    const result = await collectTistoryRssMetrics("https://myname.tistory.com/");
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].publishedAt).toBe(new Date("2026-10-09T09:00:00Z").toISOString());
  });

  it("returns an empty, non-error result for a feed with 0 items", async () => {
    mockOneRequest(makeMockResponse(200, XML_HEADERS), "<rss><channel></channel></rss>");
    const result = await collectTistoryRssMetrics("https://myname.tistory.com/");
    expect(result).toEqual({ posts: [], observedCapped: false, unavailableReason: null });
  });

  it("flags observedCapped when the feed returns exactly 30 items", async () => {
    const items = Array.from({ length: 30 }, (_, i) => `<item><pubDate>${new Date(Date.UTC(2026, 9, 1 + i)).toUTCString()}</pubDate></item>`).join("");
    mockOneRequest(makeMockResponse(200, XML_HEADERS), `<rss><channel>${items}</channel></rss>`);
    const result = await collectTistoryRssMetrics("https://myname.tistory.com/");
    expect(result.posts).toHaveLength(30);
    expect(result.observedCapped).toBe(true);
  });

  it("does not flag observedCapped when fewer than 30 items come back", async () => {
    const items = Array.from({ length: 5 }, (_, i) => `<item><pubDate>${new Date(Date.UTC(2026, 9, 1 + i)).toUTCString()}</pubDate></item>`).join("");
    mockOneRequest(makeMockResponse(200, XML_HEADERS), `<rss><channel>${items}</channel></rss>`);
    const result = await collectTistoryRssMetrics("https://myname.tistory.com/");
    expect(result.observedCapped).toBe(false);
  });
});

describe("collectTistoryRssMetrics: graceful degradation", () => {
  it("returns unavailableReason instead of throwing on a 404", async () => {
    mockOneRequest(makeMockResponse(404, XML_HEADERS));
    const result = await collectTistoryRssMetrics("https://myname.tistory.com/");
    expect(result).toEqual({ posts: [], observedCapped: false, unavailableReason: expect.any(String) });
  });

  it("returns unavailableReason instead of throwing on a 403 (private blog)", async () => {
    mockOneRequest(makeMockResponse(403, XML_HEADERS));
    const result = await collectTistoryRssMetrics("https://myname.tistory.com/");
    expect(result.unavailableReason).toBeTruthy();
  });

  it("returns unavailableReason when the response isn't XML at all", async () => {
    mockOneRequest(makeMockResponse(200, { "content-type": "text/html" }), "<html>not rss</html>");
    const result = await collectTistoryRssMetrics("https://myname.tistory.com/");
    expect(result.unavailableReason).toBeTruthy();
  });
});

describe("collectTistoryRssMetrics: SSRF (also applies to custom domains, not just *.tistory.com)", () => {
  it("rejects (throws) when a custom domain resolves to a private address", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const error = await collectTistoryRssMetrics("https://blog.mycompany.com/").catch((e) => e);
    expect(error).toBeInstanceOf(DiagnosisError);
    expect(error).toMatchObject({ code: "BLOCKED_TARGET" });
  });

  it("rejects (throws) when a *.tistory.com host resolves to a private address", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    await expect(collectTistoryRssMetrics("https://myname.tistory.com/")).rejects.toMatchObject({ code: "BLOCKED_TARGET" });
  });
});
