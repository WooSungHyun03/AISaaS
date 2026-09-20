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
