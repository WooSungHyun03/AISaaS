import { describe, expect, it } from "vitest";
import { parseChannelUrl } from "./url-parser";

const UC_ID = "UC1234567890123456789012"; // UC + 22 chars = 24 total

describe("parseChannelUrl: youtube", () => {
  it("parses an http @handle URL", () => {
    const result = parseChannelUrl("http://youtube.com/@mychannel");
    expect(result).toEqual({ ok: true, platform: "youtube", externalId: "@mychannel", normalizedUrl: "https://youtube.com/@mychannel" });
  });

  it("parses an https @handle URL with www", () => {
    const result = parseChannelUrl("https://www.youtube.com/@mychannel");
    expect(result).toEqual({ ok: true, platform: "youtube", externalId: "@mychannel", normalizedUrl: "https://youtube.com/@mychannel" });
  });

  it("parses the mobile host m.youtube.com", () => {
    const result = parseChannelUrl("https://m.youtube.com/@mychannel");
    expect(result).toEqual({ ok: true, platform: "youtube", externalId: "@mychannel", normalizedUrl: "https://youtube.com/@mychannel" });
  });

  it("ignores a trailing slash", () => {
    const result = parseChannelUrl("https://youtube.com/@mychannel/");
    expect(result).toEqual({ ok: true, platform: "youtube", externalId: "@mychannel", normalizedUrl: "https://youtube.com/@mychannel" });
  });

  it("ignores a query string", () => {
    const result = parseChannelUrl("https://youtube.com/@mychannel?si=abc123");
    expect(result).toEqual({ ok: true, platform: "youtube", externalId: "@mychannel", normalizedUrl: "https://youtube.com/@mychannel" });
  });

  it("is case-insensitive on host and the /channel/ keyword", () => {
    const result = parseChannelUrl(`https://YOUTUBE.COM/CHANNEL/${UC_ID}`);
    expect(result).toEqual({ ok: true, platform: "youtube", externalId: UC_ID, normalizedUrl: `https://youtube.com/channel/${UC_ID}` });
  });

  it("parses a /channel/UC... URL", () => {
    const result = parseChannelUrl(`https://youtube.com/channel/${UC_ID}`);
    expect(result).toEqual({ ok: true, platform: "youtube", externalId: UC_ID, normalizedUrl: `https://youtube.com/channel/${UC_ID}` });
  });

  it("rejects youtu.be as a video link, not a channel URL", () => {
    const result = parseChannelUrl("https://youtu.be/dQw4w9WgXcQ");
    expect(result).toEqual({ ok: false, message: expect.stringContaining("영상 링크") });
  });

  it("rejects a youtube.com URL that is neither a handle nor a channel id", () => {
    const result = parseChannelUrl("https://youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result.ok).toBe(false);
  });
});

describe("parseChannelUrl: naver blog", () => {
  it("parses blog.naver.com/{id}", () => {
    const result = parseChannelUrl("https://blog.naver.com/myblogid");
    expect(result).toEqual({ ok: true, platform: "naver_blog", externalId: "myblogid", normalizedUrl: "https://blog.naver.com/myblogid" });
  });

  it("parses the mobile host m.blog.naver.com", () => {
    const result = parseChannelUrl("https://m.blog.naver.com/myblogid");
    expect(result).toEqual({ ok: true, platform: "naver_blog", externalId: "myblogid", normalizedUrl: "https://blog.naver.com/myblogid" });
  });

  it("parses the legacy PostList.naver?blogId= format", () => {
    const result = parseChannelUrl("https://blog.naver.com/PostList.naver?blogId=myblogid&from=postList");
    expect(result).toEqual({ ok: true, platform: "naver_blog", externalId: "myblogid", normalizedUrl: "https://blog.naver.com/myblogid" });
  });

  it("ignores a trailing slash and a deeper post path", () => {
    const result = parseChannelUrl("https://blog.naver.com/myblogid/223456789012/");
    expect(result).toEqual({ ok: true, platform: "naver_blog", externalId: "myblogid", normalizedUrl: "https://blog.naver.com/myblogid" });
  });

  it("preserves id casing", () => {
    const result = parseChannelUrl("https://blog.naver.com/MyBlogId");
    expect(result).toEqual({ ok: true, platform: "naver_blog", externalId: "MyBlogId", normalizedUrl: "https://blog.naver.com/MyBlogId" });
  });
});

describe("parseChannelUrl: tistory", () => {
  it("parses {name}.tistory.com", () => {
    const result = parseChannelUrl("https://myname.tistory.com");
    expect(result).toEqual({ ok: true, platform: "tistory", externalId: "myname", normalizedUrl: "https://myname.tistory.com/" });
  });

  it("parses with www and a trailing slash", () => {
    const result = parseChannelUrl("https://www.myname.tistory.com/");
    expect(result).toEqual({ ok: true, platform: "tistory", externalId: "myname", normalizedUrl: "https://myname.tistory.com/" });
  });

  it("is case-insensitive on the subdomain", () => {
    const result = parseChannelUrl("https://MyName.tistory.com");
    expect(result).toEqual({ ok: true, platform: "tistory", externalId: "myname", normalizedUrl: "https://myname.tistory.com/" });
  });
});

describe("parseChannelUrl: unsupported formats and the platform hint escape hatch", () => {
  it("rejects an unrelated domain with no hint", () => {
    const result = parseChannelUrl("https://example.com/my-blog");
    expect(result.ok).toBe(false);
  });

  it("rejects an empty or garbage string", () => {
    expect(parseChannelUrl("").ok).toBe(false);
    expect(parseChannelUrl("not a url at all !!").ok).toBe(false);
  });

  it("accepts a custom-domain Tistory blog when platformHint is supplied", () => {
    const result = parseChannelUrl("https://blog.mycompany.com", "tistory");
    expect(result).toEqual({ ok: true, platform: "tistory", externalId: "blog.mycompany.com", normalizedUrl: "https://blog.mycompany.com/" });
  });

  it("ignores an invalid platformHint and still reports unsupported", () => {
    // @ts-expect-error intentionally invalid hint to verify the schema guard
    const result = parseChannelUrl("https://example.com/my-blog", "not-a-platform");
    expect(result.ok).toBe(false);
  });
});
