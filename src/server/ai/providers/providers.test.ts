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

describe("MockAIProvider character skit", () => {
  it("returns a schema-valid skit whose image numbers stay inside the listed references", async () => {
    const [{ MockAIProvider }, { shortsSkitContentSchema }] = await Promise.all([import("./mock"), import("@/server/ai/prompts/shorts")]);
    const provider = new MockAIProvider();

    for (const count of [1, 2, 8]) {
      const references = Array.from({ length: count }, (_, index) => `${index + 1}. 참고 이미지 ${index + 1}`).join("\n");
      const { text } = await provider.generateText({ prompt: `AUTOBIZ_SHORTS_SKIT_V1\n${references}\nRules:` });
      const skit = shortsSkitContentSchema.parse(JSON.parse(text));
      expect(skit.scenes.every((scene) => scene.imageIndex >= 1 && scene.imageIndex <= count)).toBe(true);
    }
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

describe("AnthropicProvider", () => {
  it("throws MISSING_API_KEY without calling the network when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const [{ AnthropicProvider }, { AIProviderError }] = await Promise.all([import("./anthropic"), import("../errors")]);
    const error = await new AnthropicProvider().generateText({ prompt: "hi" }).catch((e) => e);

    expect(error).toBeInstanceOf(AIProviderError);
    expect((error as InstanceType<typeof AIProviderError>).code).toBe("MISSING_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a Messages API request (key header, version, Haiku 4.5, system + max_tokens) and joins the text blocks", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.AI_MODEL;
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ content: [{ type: "text", text: "안녕" }, { type: "text", text: "하세요" }], stop_reason: "end_turn" }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { AnthropicProvider, ANTHROPIC_DEFAULT_MODEL } = await import("./anthropic");
    const result = await new AnthropicProvider().generateText({ system: "시스템", prompt: "질문", maxTokens: 321, temperature: 0.3 });

    expect(result.text).toBe("안녕하세요");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual({
      model: ANTHROPIC_DEFAULT_MODEL,
      max_tokens: 321,
      temperature: 0.3,
      system: "시스템",
      messages: [{ role: "user", content: "질문" }],
    });
    expect(ANTHROPIC_DEFAULT_MODEL).toBe("claude-haiku-4-5-20251001");
  });

  it("uses AI_MODEL when set, and omits the system field when none is given", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.AI_MODEL = "claude-sonnet-5-5";
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { AnthropicProvider } = await import("./anthropic");
    await new AnthropicProvider().generateText({ prompt: "hi" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body).not.toHaveProperty("system");
  });

  it("reports a reply cut off at max_tokens and an empty reply as errors", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const responses = [
      { content: [{ type: "text", text: '{"a":' }], stop_reason: "max_tokens" },
      { content: [], stop_reason: "end_turn" },
    ];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(responses.shift()), { status: 200 }))));

    const [{ AnthropicProvider }, { AIProviderError }] = await Promise.all([import("./anthropic"), import("../errors")]);
    const provider = new AnthropicProvider();
    const truncated = await provider.generateText({ prompt: "x" }).catch((e) => e);
    const empty = await provider.generateText({ prompt: "x" }).catch((e) => e);

    expect(truncated).toBeInstanceOf(AIProviderError);
    expect((truncated as InstanceType<typeof AIProviderError>).code).toBe("INVALID_STRUCTURED_RESPONSE");
    expect((empty as InstanceType<typeof AIProviderError>).code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("maps a 401 to MISSING_API_KEY without retrying", async () => {
    process.env.ANTHROPIC_API_KEY = "bad-key";
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("unauthorized", { status: 401 })));
    vi.stubGlobal("fetch", fetchMock);

    const { AnthropicProvider } = await import("./anthropic");
    const error = await new AnthropicProvider().generateText({ prompt: "x" }).catch((e) => e);

    expect((error as { code: string }).code).toBe("MISSING_API_KEY");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getAIProvider", () => {
  it("selects the Anthropic provider for AI_PROVIDER=anthropic", async () => {
    process.env.AI_PROVIDER = "anthropic";
    const { getAIProvider } = await import("../index");
    expect(getAIProvider().name).toBe("anthropic");
  });
});
