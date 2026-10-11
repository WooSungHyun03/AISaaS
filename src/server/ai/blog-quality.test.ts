import { describe, expect, it } from "vitest";
import { assessBlogPost, assignIssues, BLOG_LENGTH } from "./blog-quality";
import { blogOutlineSchema, blogSectionOutputSchema } from "./prompts/blog";
import { mockBlogOutline, mockBlogSection } from "./providers/mock-blog";
import { blogPostSchema, countCharsNoSpaces, postBodyText, type BlogPost } from "@/server/blog/post";

const system = "상호: 우리동네 빵집\n이번 글의 핵심 키워드: 소금빵, 성수동 빵집";

/** The mock provider's full pipeline output, exactly as the handler would assemble it. */
function mockPost(): BlogPost {
  const outline = blogOutlineSchema.parse(JSON.parse(mockBlogOutline('Plan one marketing blog post about "소금빵 맛있게 먹는 법"', system)));
  const sections = [mockBlogSection("AUTOBIZ_BLOG_SECTION_V1\nKIND=intro", system)];
  outline.sections.forEach((section, index) => {
    const prompt = [
      "AUTOBIZ_BLOG_SECTION_V1",
      `KIND=body INDEX=${index}`,
      `Write the section "${section.heading}": 2-3 paragraphs.`,
      section.photo ? `Include one photo block where it fits best: slot = "${section.photo}", plus a short caption.` : "Include no photo block.",
      section.extra === "quote" ? "Include one quote block (one memorable line)." : section.extra === "callout" ? 'Include one callout block with a label like "💡 꿀팁".' : section.extra === "list" ? "Include one list block (check or bullet style)." : "",
    ].join(" ");
    sections.push(mockBlogSection(prompt, system));
  });
  sections.push(mockBlogSection("AUTOBIZ_BLOG_SECTION_V1\nKIND=closing", system));
  const kinds = ["intro", ...outline.sections.map((section) => section.heading), "closing"];
  return blogPostSchema.parse({
    title: outline.title,
    sections: sections.map((raw, index) => ({
      heading: index === 0 || index === sections.length - 1 ? undefined : kinds[index],
      blocks: blogSectionOutputSchema.parse(JSON.parse(raw)).blocks,
    })),
    hashtags: ["소금빵", "성수동빵집"],
  });
}

const facts = "상호: 우리동네 빵집\n위치: 서울 성동구 성수동\n소개: 매일 아침 직접 굽는 동네 베이커리";
const keywords = ["소금빵", "성수동 빵집"];

describe("assessBlogPost", () => {
  it("passes a complete post: long enough, emphasised, emoji, photo spots, quote and callout", () => {
    const post = mockPost();
    expect(countCharsNoSpaces(postBodyText(post))).toBeGreaterThanOrEqual(BLOG_LENGTH.minTotal);
    expect(assessBlogPost({ post, keywords, facts })).toEqual([]);
  });

  it("flags a thin post and points at the thinnest sections", () => {
    const post = mockPost();
    const thin: BlogPost = { ...post, sections: post.sections.map((section, index) => (index === 2 ? { ...section, blocks: [{ type: "paragraph", text: "짧아요." }] } : section)) };
    const issues = assessBlogPost({ post: thin, keywords, facts });
    // still long overall, but the section itself is short
    expect(issues.some((issue) => issue.kind === "length" || issue.section === 2)).toBe(true);

    const tiny: BlogPost = { ...post, sections: post.sections.map((section) => ({ ...section, blocks: section.blocks.slice(0, 1) })) };
    const tinyIssues = assessBlogPost({ post: tiny, keywords, facts });
    expect(tinyIssues.some((issue) => issue.section === null && issue.kind === "length")).toBe(true);
    expect(tinyIssues.filter((issue) => issue.kind === "length" && issue.section !== null).length).toBeGreaterThan(0);
  });

  it("flags AI-sounding phrases and unprovable claims in the section they appear in", () => {
    const post = mockPost();
    const bad: BlogPost = {
      ...post,
      sections: post.sections.map((section, index) =>
        index === 3 ? { ...section, blocks: [{ type: "paragraph", text: "결론적으로 저희는 최고의 빵집이고 압도적인 맛입니다." }, ...section.blocks] } : section),
    };
    const issues = assessBlogPost({ post: bad, keywords, facts }).filter((issue) => issue.section === 3);
    expect(issues.map((issue) => issue.kind)).toEqual(expect.arrayContaining(["wording"]));
    expect(issues.map((issue) => issue.message).join(" ")).toContain("결론적으로");
    expect(issues.map((issue) => issue.message).join(" ")).toContain("최고의");
  });

  it("flags numbers with units that the facts never mentioned, but allows ones they did", () => {
    const post = mockPost();
    const invented: BlogPost = {
      ...post,
      sections: post.sections.map((section, index) => (index === 2 ? { ...section, blocks: [{ type: "paragraph", text: "매일 오전 7시에 문을 열고 3,500원에 팝니다." }, ...section.blocks] } : section)),
    };
    const flagged = assessBlogPost({ post: invented, keywords, facts }).filter((issue) => issue.section === 2 && issue.message.includes("숫자"));
    expect(flagged).toHaveLength(1);
    expect(flagged[0].message).toContain("7시");
    expect(flagged[0].message).toContain("3,500원");

    const allowed = assessBlogPost({ post: invented, keywords, facts: `${facts}\n오전 7시 오픈, 소금빵 3,500원` }).filter((issue) => issue.message.includes("숫자"));
    expect(allowed).toHaveLength(0);
  });

  it("requires the structural features of an ad blog: photos, quote, callout, emphasis, emoji headings", () => {
    const post = mockPost();
    const plain: BlogPost = {
      ...post,
      sections: post.sections.map((section) => ({
        heading: section.heading?.replace(/^\S+\s/, ""),
        blocks: section.blocks.filter((block) => block.type === "paragraph").map((block) => ("text" in block ? { ...block, text: block.text.replace(/\*\*|==/g, "").replace(/\p{Extended_Pictographic}/gu, "") } : block)),
      })),
    };
    const kinds = new Set(assessBlogPost({ post: plain, keywords, facts }).map((issue) => issue.kind));
    for (const kind of ["photos", "quote", "callout", "emphasis", "emoji"] as const) expect(kinds.has(kind)).toBe(true);
  });

  it("flags keyword stuffing", () => {
    const post = mockPost();
    const stuffed: BlogPost = { ...post, sections: [{ blocks: [{ type: "paragraph", text: `소금빵 ${"소금빵 ".repeat(12)}` }] }, ...post.sections] };
    expect(assessBlogPost({ post: stuffed, keywords, facts }).some((issue) => issue.kind === "keyword" && issue.message.includes("소금빵"))).toBe(true);
  });

  it("flags a monotone ending and repeated sentence openings", () => {
    const post = mockPost();
    const sentence = (index: number) => `이번 이야기는 정말 조용히 시작되었어요 ${"가나다라마바사".charAt(index % 7)}${index}.`;
    const monotone: BlogPost = { ...post, sections: [...post.sections, { heading: "😀 반복", blocks: [{ type: "paragraph", text: Array.from({ length: 14 }, (_, index) => sentence(index)).join(" ") }] }] };
    const messages = assessBlogPost({ post: monotone, keywords, facts }).map((issue) => issue.message).join(" ");
    expect(messages).toMatch(/문장 끝|비슷한 문장 시작/);
  });
});

describe("assignIssues", () => {
  it("hands whole-post issues to the sections best placed to fix them", () => {
    const post = mockPost();
    const stripped: BlogPost = { ...post, sections: post.sections.map((section) => ({ ...section, blocks: section.blocks.filter((block) => block.type !== "photo" && block.type !== "callout" && block.type !== "quote") })) };
    const assigned = assignIssues(stripped, assessBlogPost({ post: stripped, keywords, facts }));
    const all = [...assigned.values()].flat().join("\n");
    expect(all).toContain("[사진]");
    expect(all).toContain("quote");
    expect(all).toContain("callout");
    // issues go to body sections or the intro, never to an index that does not exist
    for (const index of assigned.keys()) expect(index).toBeLessThan(stripped.sections.length);
  });

  it("keeps section-specific issues on their own section", () => {
    const issues = [{ section: 4, kind: "wording" as const, message: "표현을 빼 주세요" }];
    expect(assignIssues(mockPost(), issues).get(4)).toEqual(["표현을 빼 주세요"]);
  });
});

describe("assessBlogPost — claims that must not be invented", () => {
  function withParagraph(text: string): BlogPost {
    const post = mockPost();
    return { ...post, sections: post.sections.map((section, index) => (index === 2 ? { ...section, blocks: [{ type: "paragraph", text }, ...section.blocks] } : section)) };
  }
  const messagesFor = (post: BlogPost, extra: Partial<Parameters<typeof assessBlogPost>[0]> = {}) =>
    assessBlogPost({ post, keywords, facts, ...extra }).filter((issue) => issue.section === 2).map((issue) => issue.message).join(" ");

  it("flags invented customer praise, review quotes and ratings", () => {
    for (const text of ["많은 분들이 저희 빵을 찾아주세요.", "손님들이 극찬하는 소금빵이에요.", "후기를 보면 다시 오시는 분이 많아요.", "평점 4.8의 인기 가게예요."]) {
      expect(messagesFor(withParagraph(text))).toContain("평가를 지어내지 마세요");
    }
  });

  it("lets the post talk about reviews when the owner's own facts mention them", () => {
    expect(messagesFor(withParagraph("손님들이 극찬하는 소금빵이에요."), { facts: `${facts}\n사장님 메모: 네이버 후기에서 극찬을 받았어요` })).not.toContain("평가를 지어내지 마세요");
  });

  it("flags effect claims only for products, and not when the owner stated them", () => {
    const post = withParagraph("꾸준히 바르면 주름 개선과 피부 재생에 도움을 줘요.");
    expect(messagesFor(post, { promotionType: "PRODUCT" })).toContain("효능·효과");
    expect(messagesFor(post, { promotionType: "STORE" })).not.toContain("효능·효과");
    expect(messagesFor(post, { promotionType: "PRODUCT", facts: `${facts}\n주요 특징: 주름 개선 기능성 인증, 피부 재생 성분` })).not.toContain("효능·효과");
  });

  it("treats ratings and multiples written with a unit as numbers that need a source", () => {
    expect(messagesFor(withParagraph("만족도 조사에서 4.9점, 작업 시간이 3배 빨라졌어요."))).toContain("제공되지 않은 숫자");
  });
});
