import { describe, expect, it } from "vitest";
import { toSafeAutomationRunOutput } from "./run-output";

describe("toSafeAutomationRunOutput", () => {
  it("returns only display-safe AI result fields", () => {
    const result = toSafeAutomationRunOutput({
      title: "AI 제목",
      topic: "자동화 주제",
      bodyHtml: "<p>본문 <strong>내용</strong></p>",
      keywords: ["AI", "마케팅"],
      externalUrl: "https://blog.example.com/post-1",
      wordpressStatus: "publish",
    });

    expect(result).toMatchObject({
      title: "AI 제목",
      topic: "자동화 주제",
      body: "본문 내용",
      keywords: ["AI", "마케팅"],
      externalUrl: "https://blog.example.com/post-1",
      destinationStatus: "publish",
    });
  });

  it("never exposes credentials, tokens, or unknown nested provider data", () => {
    const result = toSafeAutomationRunOutput({
      title: "안전한 제목",
      accessToken: "secret-token",
      password: "secret-password",
      credential: { apiKey: "secret-key" },
      providerResponse: { authorization: "Bearer secret" },
    });

    expect(JSON.stringify(result)).toBe(JSON.stringify({
      title: "안전한 제목",
      topic: null,
      summary: null,
      body: null,
      callToAction: null,
      keywords: [],
      externalUrl: null,
      destinationStatus: null,
      hook: null,
      seoKeywords: [],
      imageSuggestion: null,
      videoUrl: null,
      caption: null,
      script: null,
      scenes: [],
      format: null,
      animationMode: null,
      animationNote: null,
      publicationResults: {},
    }));
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("rejects non-http external URLs and strips executable HTML", () => {
    const result = toSafeAutomationRunOutput({
      bodyHtml: "<script>alert('secret')</script><p>공개 본문</p>",
      externalUrl: "javascript:alert(1)",
    });

    expect(result?.body).toBe("공개 본문");
    expect(result?.externalUrl).toBeNull();
  });

  it("surfaces hook/seoKeywords/imageSuggestion for a blog run that has them", () => {
    const result = toSafeAutomationRunOutput({
      title: "제목",
      hook: "이 글을 꼭 읽어야 하는 이유",
      seoKeywords: ["SEO 키워드1", "SEO 키워드2"],
      imageSuggestion: "도입부 직후: 완성된 디저트 클로즈업 사진",
    });

    expect(result).toMatchObject({
      hook: "이 글을 꼭 읽어야 하는 이유",
      seoKeywords: ["SEO 키워드1", "SEO 키워드2"],
      imageSuggestion: "도입부 직후: 완성된 디저트 클로즈업 사진",
    });
  });

  it("defaults hook/seoKeywords/imageSuggestion to null/empty for a run from before those fields existed", () => {
    const result = toSafeAutomationRunOutput({ title: "구버전 결과", bodyHtml: "<p>본문</p>" });

    expect(result).toMatchObject({ hook: null, seoKeywords: [], imageSuggestion: null });
  });

  it("allowlists Shorts preview and platform publication fields", () => {
    const result = toSafeAutomationRunOutput({
      hook: "첫 3초 후킹",
      script: "짧은 대본",
      caption: "게시 설명 #태그1 #태그2 #태그3",
      videoUrl: "https://cdn.example.com/short.mp4",
      scenes: [{ text: "첫 장면", visualPrompt: "render prompt", durationSec: 3 }],
      publicationResults: {
        youtube: { externalId: "video-1", externalUrl: "https://youtube.com/watch?v=video-1", privacy: "private", token: "never" },
      },
    });

    expect(result).toMatchObject({
      hook: "첫 3초 후킹",
      script: "짧은 대본",
      videoUrl: "https://cdn.example.com/short.mp4",
      scenes: [{ text: "첫 장면", durationSec: 3 }],
      publicationResults: { youtube: { externalId: "video-1", privacy: "private" } },
    });
    expect(JSON.stringify(result)).not.toContain("visualPrompt");
    expect(JSON.stringify(result)).not.toContain("never");
  });
});
