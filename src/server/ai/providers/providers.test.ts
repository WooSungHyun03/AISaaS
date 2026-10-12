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

describe("MockAIProvider ad-video pipeline", () => {
  const bounds = (durationSec: number, imageCount: number, exactImages: number[] = []) => ({ durationSec, imageCount, videoCount: 1, audioCount: 1, exactImages });

  it.each([20, 25, 30])("plans a %i s ad that satisfies the plan schema, with every reference described", async (durationSec) => {
    const [{ MockAIProvider }, { makeAdPlanSchema }] = await Promise.all([import("./mock"), import("@/server/shorts/ad-plan")]);
    const prompt = `AUTOBIZ_AD_PLAN_V1\nDURATION=${durationSec}\nIMAGE_COUNT=3\nVIDEO_COUNT=1\nAUDIO_COUNT=1\nImages 2 are 'exact' images (a real label).\nThe owner's logo exists; the app overlays it.`;
    const { text } = await new MockAIProvider().generateText({ prompt, system: "상호: 우리 빵집" });
    const plan = makeAdPlanSchema(bounds(durationSec, 3, [2])).parse(JSON.parse(text));
    expect(plan.storyboard[0].startSec).toBe(0);
    expect(plan.storyboard.at(-1)?.endSec).toBe(durationSec);
    expect(plan.references.filter((reference) => reference.type === "image")).toHaveLength(3);
    expect(plan.inserts).toEqual([expect.objectContaining({ imageIndex: 2 })]);
    expect(plan.logo.show).toBe(true);
  });

  it("keeps a fixed topic, and plans no insert or logo when there are none", async () => {
    const [{ MockAIProvider }, { makeAdPlanSchema }] = await Promise.all([import("./mock"), import("@/server/shorts/ad-plan")]);
    const prompt = 'AUTOBIZ_AD_PLAN_V1\nDURATION=25\nIMAGE_COUNT=1\nVIDEO_COUNT=0\nAUDIO_COUNT=0\nUse exactly this planned topic without replacing it: "아침 소금빵".';
    const plan = makeAdPlanSchema(bounds(25, 1)).parse(JSON.parse((await new MockAIProvider().generateText({ prompt })).text));
    expect(plan.topic).toBe("아침 소금빵");
    expect(plan.inserts).toEqual([]);
    expect(plan.logo.show).toBe(false);
  });

  it("recognises what a photo shows from the owner's label, in one batch", async () => {
    const [{ MockAIProvider }, { imageAnalysisSchema }] = await Promise.all([import("./mock"), import("@/server/shorts/image-analysis")]);
    const prompt = 'AUTOBIZ_IMAGE_ANALYSIS_V2\nImage 1 label: "귀여운 곰 마스코트"\nImage 2 label: "매장 내부"\nImage 3 label: "사장님 사진"\nImage 4 label: "시그니처 소금빵"\nImage 5 label: ""';
    const { images } = imageAnalysisSchema.parse(JSON.parse((await new MockAIProvider().generateText({ prompt })).text));
    expect(images.map((item) => item.role)).toEqual(["character", "place", "person", "product", "product"]);
  });

  it("answers the frame QA with a schema-valid, problem-free review", async () => {
    const [{ MockAIProvider }, { aiQaSchema }] = await Promise.all([import("./mock"), import("@/server/shorts/qa")]);
    const result = aiQaSchema.parse(JSON.parse((await new MockAIProvider().generateText({ prompt: "AUTOBIZ_AD_QA_V1" })).text));
    expect(result.problems).toEqual([]);
  });
});

describe("MockAIProvider (local dev / CI) produces schema-valid output for every pipeline", () => {
  it("covers the website narrative and every blog stage (plan, draft, fix, review)", async () => {
    const [{ MockAIProvider }, { websiteDiagnosisNarrativeSchema }, { blogPlanSchema, blogDraftSchema, blogFixSchema, blogReviewSchema }] = await Promise.all([
      import("./mock"),
      import("@/server/marketing/diagnosis"),
      import("../prompts/blog"),
    ]);
    const provider = new MockAIProvider();

    const narrative = await provider.generateText({ prompt: "x\n===WEBPAGE_DATA_START===\ny\n===WEBPAGE_DATA_END===" });
    expect(websiteDiagnosisNarrativeSchema.safeParse(JSON.parse(narrative.text)).success).toBe(true);

    const planned = await provider.generateText({ system: "상호: 우리 빵집", prompt: 'AUTOBIZ_BLOG_PLAN_V2\nPlan one marketing blog post about exactly this planned topic, without replacing it: "봄맞이 메뉴".' });
    const plan = blogPlanSchema.parse(JSON.parse(planned.text));
    expect(plan.topic).toBe("봄맞이 메뉴");
    expect(plan.sections.length).toBeGreaterThanOrEqual(5);

    const brief = plan.sections.map((section, index) => `${index + 1}. ${section.heading} — purpose: x.`).join("\n");
    const draft = await provider.generateText({ system: "상호: 우리 빵집", prompt: `AUTOBIZ_BLOG_DRAFT_V2\nPost title: ${plan.title}\n${brief}` });
    expect(blogDraftSchema.parse(JSON.parse(draft.text)).sections).toHaveLength(plan.sections.length + 2);

    const fix = await provider.generateText({ system: "상호: 우리 빵집", prompt: `AUTOBIZ_BLOG_FIX_V2\n${brief}\nSECTION 2 (heading: ${plan.sections[1].heading})\nCurrent blocks: []` });
    expect(blogFixSchema.parse(JSON.parse(fix.text)).sections[0]).toMatchObject({ index: 2, heading: plan.sections[1].heading });

    const review = await provider.generateText({ prompt: "AUTOBIZ_BLOG_REVIEW_V2" });
    expect(blogReviewSchema.parse(JSON.parse(review.text)).unsupported).toEqual([]);
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

  it("uses AI_QUALITY_MODEL only for the quality tier and falls back to AI_MODEL", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.AI_MODEL = "claude-haiku-4-5-20251001";
    process.env.AI_QUALITY_MODEL = "claude-sonnet-5-5";
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { AnthropicProvider } = await import("./anthropic");
    const provider = new AnthropicProvider();

    await provider.generateText({ prompt: "fast" });
    await provider.generateText({ prompt: "slow", tier: "quality" });
    delete process.env.AI_QUALITY_MODEL;
    vi.resetModules();
    const { AnthropicProvider: Fresh } = await import("./anthropic");
    await new Fresh().generateText({ prompt: "slow", tier: "quality" });

    const models = fetchMock.mock.calls.map((call) => (JSON.parse(call[1].body as string) as { model: string }).model);
    expect(models).toEqual(["claude-haiku-4-5-20251001", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"]);
    delete process.env.AI_MODEL;
  });

  it("sends images as base64 blocks before the prompt text", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.AI_MODEL;
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ content: [{ type: "text", text: "{}" }] }), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { AnthropicProvider } = await import("./anthropic");

    await new AnthropicProvider().generateText({ prompt: "이 이미지를 설명해줘", images: [{ mediaType: "image/png", base64: "QUJD" }] });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { messages: Array<{ content: unknown }> };
    expect(body.messages[0].content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } },
      { type: "text", text: "이 이미지를 설명해줘" },
    ]);
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

describe("providers without vision", () => {
  it("refuse image input instead of silently dropping it", async () => {
    process.env.OPENAI_API_KEY = "k";
    process.env.GEMINI_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn());
    vi.resetModules();
    const [{ OpenAIProvider }, { GeminiProvider }] = await Promise.all([import("./openai"), import("./gemini")]);
    const images = [{ mediaType: "image/png" as const, base64: "QUJD" }];
    await expect(new OpenAIProvider().generateText({ prompt: "x", images })).rejects.toMatchObject({ code: "UNSUPPORTED_INPUT" });
    await expect(new GeminiProvider().generateText({ prompt: "x", images })).rejects.toMatchObject({ code: "UNSUPPORTED_INPUT" });
  });
});
