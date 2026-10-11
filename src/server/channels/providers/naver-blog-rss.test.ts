import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchPublicXmlMock } = vi.hoisted(() => ({ fetchPublicXmlMock: vi.fn() }));
vi.mock("@/server/marketing/diagnosis", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/marketing/diagnosis")>()),
  fetchPublicXml: fetchPublicXmlMock,
}));

const { collectNaverBlogRssMetrics } = await import("./naver-blog-rss");
const { DiagnosisError } = await import("@/server/marketing/diagnosis");

const NOW = new Date("2026-10-11T03:00:00.000Z"); // 12:00 KST

function feed(pubDates: string[]) {
  const items = pubDates.map((date, index) => `<item><title><![CDATA[글 ${index}]]></title><pubDate>${date}</pubDate></item>`).join("");
  // The channel's own pubDate must never be counted as a post.
  return `<rss version="2.0"><channel><title>t</title><pubDate>Sun, 11 Oct 2026 21:17:52 +0900</pubDate>${items}</channel></rss>`;
}

afterEach(() => vi.clearAllMocks());

describe("collectNaverBlogRssMetrics", () => {
  it("reads the blog's own latest posts from the public RSS, by KST date", async () => {
    fetchPublicXmlMock.mockResolvedValue({
      html: feed([
        "Sat, 10 Oct 2026 23:30:00 +0900",
        "Mon, 05 Oct 2026 10:00:00 +0900",
        "Thu, 01 Oct 2026 09:00:00 +0900",
        "Mon, 31 Aug 2026 09:00:00 +0900",
      ]),
      finalUrl: "https://rss.blog.naver.com/myblog.xml",
    });

    const metrics = await collectNaverBlogRssMetrics("myblog", NOW);

    expect(fetchPublicXmlMock).toHaveBeenCalledWith("https://rss.blog.naver.com/myblog.xml");
    expect(metrics).toMatchObject({ matchedPostCount: 4, postsLast30Days: 3, lastPostDate: "2026-10-10", firstPostDate: "2026-08-31", basis: "rss" });
    // gaps: 5, 4, 31 days
    expect(metrics.averageGapDays).toBeCloseTo(13.3, 1);
  });

  it("is honest about a blog that shows nothing: zero posts, no invented data", async () => {
    fetchPublicXmlMock.mockResolvedValue({ html: "<rss><channel><title/></channel></rss>", finalUrl: "" });
    expect(await collectNaverBlogRssMetrics("emptyblog", NOW)).toEqual({ matchedPostCount: 0, postsLast30Days: 0, averageGapDays: null, lastPostDate: null, firstPostDate: null, basis: "rss" });
  });

  it("treats an unreachable or odd RSS as 'no posts seen' instead of failing the whole diagnosis", async () => {
    fetchPublicXmlMock.mockRejectedValue(new DiagnosisError("FETCH_FAILED", "HTTP 500"));
    await expect(collectNaverBlogRssMetrics("myblog", NOW)).resolves.toMatchObject({ matchedPostCount: 0 });
  });

  it("still throws for a blocked target, and rejects ids that could redirect the request elsewhere", async () => {
    fetchPublicXmlMock.mockRejectedValue(new DiagnosisError("BLOCKED_TARGET", "private"));
    await expect(collectNaverBlogRssMetrics("myblog", NOW)).rejects.toBeInstanceOf(DiagnosisError);
    for (const bad of ["../etc/passwd", "a b", "x/../../y", "evil.com#", ""]) {
      await expect(collectNaverBlogRssMetrics(bad, NOW)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });
});
