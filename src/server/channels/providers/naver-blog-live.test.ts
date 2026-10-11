import { afterEach, describe, expect, it, vi } from "vitest";

const { rssMock, searchMock, envMock } = vi.hoisted(() => ({
  rssMock: vi.fn(),
  searchMock: vi.fn(),
  envMock: { NAVER_CLIENT_ID: undefined as string | undefined, NAVER_CLIENT_SECRET: undefined as string | undefined },
}));
vi.mock("@/lib/env/server", () => ({ serverEnv: envMock }));
vi.mock("./naver-blog-rss", () => ({ collectNaverBlogRssMetrics: rssMock }));
vi.mock("./naver-blog", () => ({ collectNaverBlogMetrics: searchMock }));

const { collectNaverBlogLive } = await import("./naver-blog-live");

const EMPTY = { matchedPostCount: 0, postsLast30Days: 0, averageGapDays: null, lastPostDate: null, firstPostDate: null, basis: "rss" as const };
const SOME = { ...EMPTY, matchedPostCount: 3, postsLast30Days: 2 };
const NOW = new Date("2026-10-11T00:00:00.000Z");

afterEach(() => {
  vi.clearAllMocks();
  envMock.NAVER_CLIENT_ID = undefined;
  envMock.NAVER_CLIENT_SECRET = undefined;
});

describe("collectNaverBlogLive", () => {
  it("uses the RSS result when it has posts, without touching the search API", async () => {
    rssMock.mockResolvedValue(SOME);
    envMock.NAVER_CLIENT_ID = "id";
    envMock.NAVER_CLIENT_SECRET = "secret";
    expect(await collectNaverBlogLive("blog", "가게", NOW)).toBe(SOME);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("needs no keys: an empty RSS without search keys is simply 'no posts seen'", async () => {
    rssMock.mockResolvedValue(EMPTY);
    expect(await collectNaverBlogLive("blog", "가게", NOW)).toBe(EMPTY);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("falls back to search (labelled as search) only when RSS shows nothing and keys exist", async () => {
    rssMock.mockResolvedValue(EMPTY);
    envMock.NAVER_CLIENT_ID = "id";
    envMock.NAVER_CLIENT_SECRET = "secret";
    searchMock.mockResolvedValue({ ...SOME, basis: undefined });
    expect(await collectNaverBlogLive("blog", "가게", NOW)).toMatchObject({ matchedPostCount: 3, basis: "search" });
  });

  it("does not turn a failing search fallback into an error", async () => {
    rssMock.mockResolvedValue(EMPTY);
    envMock.NAVER_CLIENT_ID = "id";
    envMock.NAVER_CLIENT_SECRET = "secret";
    searchMock.mockRejectedValue(new Error("429"));
    expect(await collectNaverBlogLive("blog", "가게", NOW)).toBe(EMPTY);
  });
});
