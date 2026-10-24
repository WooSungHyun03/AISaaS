import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { AIProviderError } from "./errors";
import type { AIProvider, GenerateTextResult } from "./provider";

const { getAIProviderMock } = vi.hoisted(() => ({ getAIProviderMock: vi.fn() }));

vi.mock("./index", () => ({
  getAIProvider: getAIProviderMock,
}));

const { generateStructured } = await import("./generate");

function fakeProvider(generateText: (prompt: string) => Promise<GenerateTextResult>): AIProvider {
  return {
    name: "fake",
    generateText: async ({ prompt }) => generateText(prompt),
  };
}

const schema = z.object({ title: z.string(), topic: z.string() });

describe("generateStructured", () => {
  it("parses and validates a well-formed JSON response on the first attempt", async () => {
    const generateText = vi.fn().mockResolvedValue({ text: '{"title": "Hello", "topic": "greeting"}' });
    getAIProviderMock.mockReturnValue(fakeProvider(generateText));

    const result = await generateStructured({ prompt: "write something", schema });

    expect(result).toEqual({ title: "Hello", topic: "greeting" });
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("strips markdown fences before parsing", async () => {
    const generateText = vi.fn().mockResolvedValue({ text: '```json\n{"title": "A", "topic": "B"}\n```' });
    getAIProviderMock.mockReturnValue(fakeProvider(generateText));

    const result = await generateStructured({ prompt: "write something", schema });

    expect(result).toEqual({ title: "A", topic: "B" });
  });

  it("retries once on invalid JSON, then throws AIProviderError if it still fails", async () => {
    const generateText = vi.fn().mockResolvedValue({ text: "not json at all" });
    getAIProviderMock.mockReturnValue(fakeProvider(generateText));

    const error = await generateStructured({ prompt: "write something", schema }).catch((e) => e);

    expect(error).toBeInstanceOf(AIProviderError);
    expect((error as AIProviderError).code).toBe("INVALID_STRUCTURED_RESPONSE");
    // Exactly one retry — never unbounded.
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("retries once when JSON parses but fails schema validation, then succeeds", async () => {
    const generateText = vi
      .fn()
      .mockResolvedValueOnce({ text: '{"title": "missing topic"}' })
      .mockResolvedValueOnce({ text: '{"title": "ok", "topic": "recovered"}' });
    getAIProviderMock.mockReturnValue(fakeProvider(generateText));

    const result = await generateStructured({ prompt: "write something", schema });

    expect(result).toEqual({ title: "ok", topic: "recovered" });
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("tells the model which rule its answer broke on the retry, and names it in the final error", async () => {
    const strict = z.object({ title: z.string(), cta: z.object({ text: z.string().max(5) }) });
    const prompts: string[] = [];
    const generateText = vi.fn().mockImplementation(async (prompt: string) => {
      prompts.push(prompt);
      return { text: '{"title": "x", "cta": {"text": "far too long"}}' };
    });
    getAIProviderMock.mockReturnValue(fakeProvider(generateText));

    const error = await generateStructured({ prompt: "write something", schema: strict }).catch((e) => e);

    expect(prompts[0]).not.toContain("rejected");
    expect(prompts[1]).toContain("cta.text");
    expect((error as AIProviderError).message).toContain("cta.text");
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("propagates a transient AIProviderError from the underlying provider without swallowing it", async () => {
    const generateText = vi.fn().mockRejectedValue(new AIProviderError("RATE_LIMITED", "fake", "slow down"));
    getAIProviderMock.mockReturnValue(fakeProvider(generateText));

    const error = await generateStructured({ prompt: "write something", schema }).catch((e) => e);

    expect(error).toBeInstanceOf(AIProviderError);
    expect((error as AIProviderError).code).toBe("RATE_LIMITED");
  });
});
