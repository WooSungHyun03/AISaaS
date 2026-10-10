import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { serverEnvMock } = vi.hoisted(() => ({
  serverEnvMock: { NAVER_CLIENT_ID: "client-id" as string | undefined, NAVER_CLIENT_SECRET: "client-secret" as string | undefined },
}));
vi.mock("@/lib/env/server", () => ({ serverEnv: serverEnvMock }));

const { collectNaverBlogMetrics } = await import("./naver-blog");
const { NaverCollectorError } = await import("./naver-types");

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function item(bloggerlink: string, postdate: string) {
  return { title: "제목", description: "설명", link: "https://blog.naver.com/x/1", bloggerlink, postdate };
}

beforeEach(() => {
  serverEnvMock.NAVER_CLIENT_ID = "client-id";
  serverEnvMock.NAVER_CLIENT_SECRET = "client-secret";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const NOW = new Date("2026-10-10T00:00:00.000Z");

describe("collectNaverBlogMetrics: bloggerlink filtering", () => {
  it("counts only items whose bloggerlink matches the tracked blog id, filtering out a same-named-search mismatch", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        items: [
          item("blog.naver.com/myblogid", "20261001"),
          item("https://blog.naver.com/someoneelse", "20261002"), // different blogger, same search term
          item("blog.naver.com/myblogid", "20260920"),
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await collectNaverBlogMetrics("myblogid", undefined, NOW);
    expect(result.matchedPostCount).toBe(2);
  });

  it("normalizes protocol, www./m. prefixes, and a trailing slash before comparing", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        items: [
          item("https://www.blog.naver.com/myblogid/", "20261001"),
          item("http://m.blog.naver.com/myblogid", "20260920"),
          item("BLOG.NAVER.COM/myblogid", "20260901"),
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await collectNaverBlogMetrics("myblogid", undefined, NOW);
    expect(result.matchedPostCount).toBe(3);
  });
});

describe("collectNaverBlogMetrics: postdate parsing", () => {
  it("parses YYYYMMDD into KST dates, day-level gaps, and last/first post dates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse({ items: [item("blog.naver.com/myblogid", "20261005"), item("blog.naver.com/myblogid", "20260925")] }),
      ),
    );

    const result = await collectNaverBlogMetrics("myblogid", undefined, NOW);
    expect(result.lastPostDate).toBe("2026-10-05");
    expect(result.firstPostDate).toBe("2026-09-25");
    expect(result.averageGapDays).toBe(10);
  });

  it("returns INSUFFICIENT_DATA-shaped metrics (matchedPostCount 0) when nothing matches, not an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ items: [] })));
    const result = await collectNaverBlogMetrics("myblogid", undefined, NOW);
    expect(result).toEqual({ matchedPostCount: 0, postsLast30Days: 0, averageGapDays: null, lastPostDate: null, firstPostDate: null });
  });
});

describe("collectNaverBlogMetrics: error cases", () => {
  it("throws RATE_LIMITED on a 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({}, 429)));
    await expect(collectNaverBlogMetrics("myblogid", undefined, NOW)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("throws INVALID_CREDENTIALS on a 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({}, 401)));
    await expect(collectNaverBlogMetrics("myblogid", undefined, NOW)).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("throws INVALID_CREDENTIALS immediately, without calling fetch, when env vars are unset", async () => {
    serverEnvMock.NAVER_CLIENT_ID = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(collectNaverBlogMetrics("myblogid", undefined, NOW)).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws INVALID_RESPONSE when the response body has no items array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ unexpected: true })));
    await expect(collectNaverBlogMetrics("myblogid", undefined, NOW)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("is an instance of NaverCollectorError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({}, 429)));
    await expect(collectNaverBlogMetrics("myblogid", undefined, NOW)).rejects.toBeInstanceOf(NaverCollectorError);
  });
});

describe("collectNaverBlogMetrics: call budget (max 3 calls per diagnosis)", () => {
  it("falls back to the business name query only when the blog id query finds no matches", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [] })) // query #1: blogId, 0 matches
      .mockResolvedValueOnce(jsonResponse({ items: [item("blog.naver.com/myblogid", "20261001")] })); // query #2: business name
    vi.stubGlobal("fetch", fetchMock);

    const result = await collectNaverBlogMetrics("myblogid", "우리동네 빵집", NOW);
    expect(result.matchedPostCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("query")).toBe("myblogid");
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get("query")).toBe("우리동네 빵집");
  });

  it("does not try the business name query when the blog id query already found matches", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ items: [item("blog.naver.com/myblogid", "20261001")] }));
    vi.stubGlobal("fetch", fetchMock);

    await collectNaverBlogMetrics("myblogid", "우리동네 빵집", NOW);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never makes a 4th call, even when every page is full (100 items) and keeps not matching", async () => {
    const fullPageNoMatch = { items: Array.from({ length: 100 }, () => item("blog.naver.com/someoneelse", "20261001")) };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(fullPageNoMatch))
      .mockResolvedValueOnce(jsonResponse(fullPageNoMatch))
      .mockResolvedValueOnce(jsonResponse(fullPageNoMatch))
      .mockResolvedValueOnce(jsonResponse(fullPageNoMatch)); // would be call #4 if the budget weren't enforced
    vi.stubGlobal("fetch", fetchMock);

    const result = await collectNaverBlogMetrics("myblogid", "완전히다른이름", NOW);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.matchedPostCount).toBe(0);
  });

  it("does not issue a second query when businessName equals externalId", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await collectNaverBlogMetrics("myblogid", "myblogid", NOW);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
