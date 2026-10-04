import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe("OpenAIProvider", () => {
  it("throws MISSING_API_KEY without calling the network when OPENAI_API_KEY is unset", async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // Both imported fresh from the same (just-reset) module registry so
    // `instanceof` below refers to the same class the provider throws.
    const [{ OpenAIProvider }, { AIProviderError }] = await Promise.all([import("./openai"), import("../errors")]);
    const provider = new OpenAIProvider();

    const error = await provider.generateText({ prompt: "hi" }).catch((e) => e);

    expect(error).toBeInstanceOf(AIProviderError);
    expect((error as InstanceType<typeof AIProviderError>).code).toBe("MISSING_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns generated text on a successful call", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: "hello world" } }] }), { status: 200 }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { OpenAIProvider } = await import("./openai");
    const provider = new OpenAIProvider();

    const result = await provider.generateText({ prompt: "hi" });

    expect(result.text).toBe("hello world");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("api.openai.com");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });
});

describe("GeminiProvider", () => {
  it("throws MISSING_API_KEY without calling the network when GEMINI_API_KEY is unset", async () => {
    delete process.env.GEMINI_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const [{ GeminiProvider }, { AIProviderError }] = await Promise.all([import("./gemini"), import("../errors")]);
    const provider = new GeminiProvider();

    const error = await provider.generateText({ prompt: "hi" }).catch((e) => e);

    expect(error).toBeInstanceOf(AIProviderError);
    expect((error as InstanceType<typeof AIProviderError>).code).toBe("MISSING_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns generated text on a successful call", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "hello from gemini" }] } }] }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { GeminiProvider } = await import("./gemini");
    const provider = new GeminiProvider();

    const result = await provider.generateText({ prompt: "hi" });

    expect(result.text).toBe("hello from gemini");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("generativelanguage.googleapis.com");
    expect(url).toContain("test-key");
  });
});

describe("MockAIProvider", () => {
  it("returns deterministic structured items for a marketing calendar request", async () => {
    const { MockAIProvider } = await import("./mock");
    const provider = new MockAIProvider();

    const result = await provider.generateText({
      prompt: [
        "AUTOBIZ_CALENDAR_PLAN_V1",
        "PLAN_START=2026-03-01",
        "PLAN_END=2026-03-14",
        "WEEKS=2",
        "BUSINESS_NAME=성장 카페",
      ].join("\n"),
    });
    const items = JSON.parse(result.text) as Array<{ date: string; platform: string; topic: string }>;

    expect(items).toHaveLength(6);
    expect(items.map((item) => item.platform)).toEqual([
      "blog", "instagram_reels", "youtube_shorts",
      "blog", "instagram_reels", "youtube_shorts",
    ]);
    expect(items[0]).toMatchObject({ date: "2026-03-01", topic: expect.stringContaining("성장 카페") });
  });

  it("returns deterministic structured Shorts topic and scene responses", async () => {
    const { MockAIProvider } = await import("./mock");
    const provider = new MockAIProvider();

    const topic = await provider.generateText({ prompt: "AUTOBIZ_SHORTS_TOPIC_V1" });
    const content = await provider.generateText({ prompt: "AUTOBIZ_SHORTS_CONTENT_V1" });
    const parsedTopic = JSON.parse(topic.text) as { topic: string };
    const parsedContent = JSON.parse(content.text) as { scenes: unknown[]; caption: string; privacy: string };

    expect(parsedTopic.topic).toBeTruthy();
    expect(parsedContent.scenes).toHaveLength(4);
    expect(parsedContent.caption).toContain("#업무자동화");
    expect(parsedContent.privacy).toBe("private");
  });
});

describe("MockAIProvider (local dev / CI) produces schema-valid output for every pipeline", () => {
  it("covers the website narrative, blog topic + body and passes the blog quality gate", async () => {
    const [{ MockAIProvider }, { websiteDiagnosisNarrativeSchema }, { blogTopicSchema, blogBodySchema }, { assessBlogBody }] = await Promise.all([
      import("./mock"),
      import("@/server/marketing/diagnosis"),
      import("../prompts/blog"),
      import("../blog-quality"),
    ]);
    const provider = new MockAIProvider();

    const narrative = await provider.generateText({ prompt: "x\n===WEBPAGE_DATA_START===\ny\n===WEBPAGE_DATA_END===" });
    expect(websiteDiagnosisNarrativeSchema.safeParse(JSON.parse(narrative.text)).success).toBe(true);

    const topic = await provider.generateText({ prompt: "Pick one specific blog topic relevant to this business." });
    expect(blogTopicSchema.safeParse(JSON.parse(topic.text)).success).toBe(true);
    const planned = await provider.generateText({ prompt: 'Use exactly this planned topic without replacing it: "봄맞이 메뉴". Create one title.' });
    expect(JSON.parse(planned.text).topic).toBe("봄맞이 메뉴");

    const body = await provider.generateText({ prompt: 'Write the full marketing blog post body for the topic "봄맞이 메뉴" with the title "t".' });
    const parsed = blogBodySchema.parse(JSON.parse(body.text));
    expect(assessBlogBody({ bodyHtml: parsed.bodyHtml, keywords: parsed.keywords })).toEqual([]);
  });
});
