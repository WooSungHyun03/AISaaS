import { describe, expect, it } from "vitest";
import { markupToPost, postToMarkup } from "./markup";
import { blogPostSchema, countCharsNoSpaces, postBodyText, stripInlineMarkup, type BlogPost } from "./post";
import { escapeHtml, inlineToHtml, renderBlogHtml, renderBlogText } from "./render";

const post: BlogPost = {
  title: "성수동 소금빵 맛집, 아침 8시에 줄 서는 이유",
  sections: [
    { blocks: [{ type: "paragraph", text: "새벽 5시부터 반죽을 굽는 **우리동네 빵집**입니다 🍞" }, { type: "quote", text: "갓 구운 빵은 ==한 시간== 안에 먹어야 제일 맛있어요" }] },
    {
      heading: "🥐 소금빵이 특별한 이유",
      blocks: [
        { type: "paragraph", text: "버터를 아끼지 않아 겉은 바삭하고 속은 촉촉해요." },
        { type: "photo", slot: "갓 구운 소금빵 단면 클로즈업", caption: "겉바속촉" },
        { type: "list", style: "check", items: ["매일 아침 직접 반죽", "국산 밀가루 사용"] },
        { type: "callout", label: "💡 꿀팁", text: "오전 9시 전에 오면 **갓 나온 빵**을 만날 수 있어요." },
      ],
    },
    { heading: "📍 매장 정보", blocks: [{ type: "info", rows: [{ label: "위치", value: "서울 성동구 성수동" }, { label: "영업시간", value: "08:00 ~ 20:00" }] }, { type: "divider" }, { type: "list", style: "number", items: ["하나", "둘"] }] },
  ],
  hashtags: ["성수동빵집", "소금빵"],
};

describe("blog markup round trip", () => {
  it("writes and re-reads every block type without losing anything", () => {
    const markup = postToMarkup(post);
    expect(markup).toContain("# 성수동 소금빵 맛집");
    expect(markup).toContain("## 🥐 소금빵이 특별한 이유");
    expect(markup).toContain("> 갓 구운 빵은");
    expect(markup).toContain("[사진] 갓 구운 소금빵 단면 클로즈업 | 겉바속촉");
    expect(markup).toContain("[포인트] 💡 꿀팁 |");
    expect(markup).toContain("[정보] 위치 | 서울 성동구 성수동");
    expect(markup).toContain("#성수동빵집 #소금빵");

    expect(markupToPost(markup)).toEqual(post);
  });

  it("is tolerant: unknown lines become paragraphs and a lone list item stays a paragraph", () => {
    const parsed = markupToPost("# 제목\n\n그냥 문장\n이어지는 줄\n\n- 하나만\n\n[사진]\n\n## 소제목\n\n내용");
    expect(parsed.title).toBe("제목");
    expect(parsed.sections[0].blocks).toEqual([
      { type: "paragraph", text: "그냥 문장 이어지는 줄" },
      { type: "paragraph", text: "하나만" },
    ]);
    expect(parsed.sections[1]).toMatchObject({ heading: "소제목" });
    expect(blogPostSchema.safeParse(parsed).success).toBe(true);
  });

  it("never throws on empty or odd input and always returns a valid post", () => {
    for (const markup of ["", "   ", "## ", "[정보]", "#", "# \n## \n---"]) {
      expect(blogPostSchema.safeParse(markupToPost(markup)).success).toBe(true);
    }
  });

  it("keeps a hashtag line distinct from the title and headings", () => {
    const parsed = markupToPost("# 제목\n\n본문\n\n#가게 #메뉴");
    expect(parsed.title).toBe("제목");
    expect(parsed.hashtags).toEqual(["가게", "메뉴"]);
  });
});

describe("blog rendering", () => {
  it("escapes everything and only turns the two inline markers into tags", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(inlineToHtml("**굵게** ==강조== <b>x</b> **끝")).toBe(
      `<strong>굵게</strong> <span style="background-color:#FEF08A;padding:0 2px;"><strong>강조</strong></span> &lt;b&gt;x&lt;/b&gt; **끝`,
    );
  });

  it("renders no active content even for hostile text", () => {
    const hostile: BlogPost = { title: "t", sections: [{ heading: `<img src=x onerror=alert(1)>`, blocks: [{ type: "paragraph", text: `<iframe src="https://evil.example"></iframe> javascript:alert(1)` }, { type: "callout", label: "<b>", text: "<script>1</script>" }] }], hashtags: ["<x>"] };
    for (const platform of ["naver", "tistory", "generic"] as const) {
      const html = renderBlogHtml(hostile, platform);
      expect(html).not.toMatch(/<(script|iframe|img)\b/i);
      expect(html).not.toMatch(/<[^>]*\son\w+=/i); // an "onerror=" that stays escaped text is inert
    }
  });

  it("uses styled paragraphs for Naver and semantic tags for Tistory", () => {
    const naver = renderBlogHtml(post, "naver");
    expect(naver).not.toContain("<h2");
    expect(naver).not.toContain("<table");
    expect(naver).toContain("font-size:23px");
    expect(naver).toContain("<blockquote");
    expect(naver).toContain("📷");
    expect(naver).toContain("위치</strong> : 서울 성동구 성수동");

    const tistory = renderBlogHtml(post, "tistory");
    expect(tistory).toContain("<h2");
    expect(tistory).toContain("<table");
    expect(tistory).toContain("<ol");
    expect(tistory).toContain("font-family:");
    expect(tistory).toContain("#성수동빵집 #소금빵");
  });

  it("renders a plain-text version with photo slots and the hashtag line", () => {
    const text = renderBlogText(post);
    expect(text).toContain("🥐 소금빵이 특별한 이유");
    expect(text).toContain("[사진 자리] 갓 구운 소금빵 단면 클로즈업");
    expect(text).toContain("위치: 서울 성동구 성수동");
    expect(text).not.toContain("**");
    expect(text.trim().endsWith("#성수동빵집 #소금빵")).toBe(true);
  });
});

describe("post helpers", () => {
  it("counts the way Korean bloggers do and ignores markup, photo slots and info rows", () => {
    expect(stripInlineMarkup("**가나** ==다라==")).toBe("가나 다라");
    expect(countCharsNoSpaces("가 나\n다 라")).toBe(4);
    const body = postBodyText(post);
    expect(body).toContain("소금빵이 특별한 이유");
    expect(body).not.toContain("사진");
    expect(body).not.toContain("08:00");
  });
});
