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
});
