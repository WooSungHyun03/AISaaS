import { afterEach, describe, expect, it, vi } from "vitest";

const { naverCollectorMock } = vi.hoisted(() => ({ naverCollectorMock: vi.fn() }));
vi.mock("./providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./providers")>()),
  getNaverBlogCollector: () => naverCollectorMock,
}));

const { NAVER_ROBOTS_BLOCKED_NOTE, previewChannel } = await import("./preview");

const EMPTY = { matchedPostCount: 0, postsLast30Days: 0, averageGapDays: null, lastPostDate: null, firstPostDate: null, basis: "rss" as const };

afterEach(() => vi.clearAllMocks());

describe("previewChannel — naver_blog", () => {
  it("explains that the RSS was not read (robots.txt) instead of telling the owner their RSS is off", async () => {
    naverCollectorMock.mockResolvedValue({ ...EMPTY, blockedByRobots: true });
    const result = await previewChannel("https://blog.naver.com/myblog");
    expect(result).toMatchObject({ ok: true, preview: { platform: "naver_blog", verified: false, note: NAVER_ROBOTS_BLOCKED_NOTE } });
  });

  it("keeps the 'RSS off or no posts' note when the RSS was read and was empty", async () => {
    naverCollectorMock.mockResolvedValue(EMPTY);
    const result = await previewChannel("https://blog.naver.com/myblog");
    expect(result.ok && result.preview.note).toMatch(/RSS 공개가 꺼져/);
  });
});
