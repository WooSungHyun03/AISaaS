import { afterEach, describe, expect, it, vi } from "vitest";
import { isMockAiText, MOCK_AI_MARKER } from "./mock-marker";
import { MockAIProvider } from "./providers/mock";

describe("mock AI placeholder", () => {
  it("is recognised in the exact text the mock provider returns for an unknown prompt", async () => {
    const { text } = await new MockAIProvider().generateText({ prompt: "아무 요청" });
    expect(text.startsWith(MOCK_AI_MARKER)).toBe(true);
    expect(isMockAiText(text)).toBe(true);
    expect(isMockAiText("구독자가 50명 늘었어요.")).toBe(false);
    expect(isMockAiText(null)).toBe(false);
  });
});

describe("getAIProvider in production", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function load(env: Record<string, string>) {
    vi.resetModules();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    return import("./index");
  }

  it("refuses to serve the mock provider's placeholders in production, with a clear configuration error", async () => {
    const { getAIProvider, isMockAiBlocked } = await load({ NODE_ENV: "production", AI_PROVIDER: "mock", ALLOW_MOCK_AI: "false" });
    expect(isMockAiBlocked()).toBe(true);
    await expect(getAIProvider().generateText({ prompt: "x" })).rejects.toMatchObject({ code: "MISSING_API_KEY" });
  });

  it("allows the mock provider for a demo image that opted in, and always outside production", async () => {
    const demo = await load({ NODE_ENV: "production", AI_PROVIDER: "mock", ALLOW_MOCK_AI: "true" });
    expect(demo.isMockAiBlocked()).toBe(false);
    expect(demo.getAIProvider().name).toBe("mock");
    const dev = await load({ NODE_ENV: "development", AI_PROVIDER: "mock", ALLOW_MOCK_AI: "false" });
    expect(dev.isMockAiBlocked()).toBe(false);
  });

  it("never serves the mock on Vercel's real production, even if ALLOW_MOCK_AI=true was left in that environment", async () => {
    const prod = await load({ NODE_ENV: "production", VERCEL_ENV: "production", AI_PROVIDER: "mock", ALLOW_MOCK_AI: "true" });
    expect(prod.isMockAiBlocked()).toBe(true);
    await expect(prod.getAIProvider().generateText({ prompt: "x" })).rejects.toMatchObject({ code: "MISSING_API_KEY" });
    // a preview deployment (or any non-Vercel demo image) that opted in keeps working
    const preview = await load({ NODE_ENV: "production", VERCEL_ENV: "preview", AI_PROVIDER: "mock", ALLOW_MOCK_AI: "true" });
    expect(preview.isMockAiBlocked()).toBe(false);
  });
});
