import { describe, expect, it } from "vitest";
import { validateSnsLink } from "./sns-links";

describe("validateSnsLink", () => {
  it("accepts a link on the channel's own domain, including subdomains", () => {
    expect(validateSnsLink("instagram", "https://www.instagram.com/ourcafe")).toBeNull();
    expect(validateSnsLink("naver_blog", "https://blog.naver.com/ourcafe")).toBeNull();
    expect(validateSnsLink("youtube", "https://youtu.be/abc")).toBeNull();
    expect(validateSnsLink("naver_place", "https://m.place.naver.com/restaurant/1")).toBeNull();
  });

  it("rejects another site saved under a channel name", () => {
    expect(validateSnsLink("instagram", "https://example.com/ourcafe")).toContain("인스타그램 링크가 아니에요");
    expect(validateSnsLink("kakao_channel", "https://instagram.com/x")).toContain("카카오톡");
  });

  it("rejects look-alike hosts and non-web schemes", () => {
    expect(validateSnsLink("instagram", "https://instagram.com.evil.example/x")).not.toBeNull();
    expect(validateSnsLink("instagram", "https://notinstagram.com/x")).not.toBeNull();
    expect(validateSnsLink("instagram", "javascript:alert(1)")).not.toBeNull();
    expect(validateSnsLink("instagram", "not a url")).toContain("형식");
  });
});
