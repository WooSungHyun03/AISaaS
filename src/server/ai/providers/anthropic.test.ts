import { describe, expect, it } from "vitest";
import { buildAnthropicBody, usageOf } from "./anthropic";
import { claudeCostUsd, claudeWorstCaseUsd } from "../models";

describe("Anthropic request body per model", () => {
  it("never sends temperature to the 5.x models and sets effort from the role", () => {
    for (const model of ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5"]) {
      const body = buildAnthropicBody({ prompt: "hi", temperature: 0.3, role: "writer" }, model);
      expect(body).not.toHaveProperty("temperature");
      expect(body).not.toHaveProperty("thinking");
      expect(body.output_config).toEqual({ effort: "medium" });
    }
  });

  it("lets a call pick its own effort", () => {
    expect(buildAnthropicBody({ prompt: "hi", role: "planner", effort: "high" }, "claude-opus-5-5").output_config).toEqual({ effort: "high" });
  });

  it("keeps temperature for Haiku and sends no effort to it", () => {
    const body = buildAnthropicBody({ prompt: "hi", temperature: 0.2 }, "claude-haiku-4-5-20251001");
    expect(body.temperature).toBe(0.2);
    expect(body).not.toHaveProperty("output_config");
  });

  it("puts images before the text and clamps max_tokens to the model", () => {
    const body = buildAnthropicBody({ prompt: "look", maxTokens: 999_999, images: [{ mediaType: "image/png", base64: "AAAA" }] }, "claude-sonnet-5-5");
    expect(body.max_tokens).toBe(128_000);
    const content = (body.messages as Array<{ content: Array<{ type: string }> }>)[0].content;
    expect(content.map((block) => block.type)).toEqual(["image", "text"]);
  });

  it("treats an unknown model like the strictest one", () => {
    const body = buildAnthropicBody({ prompt: "hi", temperature: 0.5 }, "claude-future-9");
    expect(body).not.toHaveProperty("temperature");
  });
});

describe("Claude cost", () => {
  it("prices input, output, cache read and cache write per million tokens", () => {
    const usage = usageOf({ usage: { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 } });
    expect(claudeCostUsd("claude-opus-5-5", usage)).toBeCloseTo(4 + 20 + 0.2 + 5, 6);
    expect(claudeCostUsd("claude-fable-5-1", usage)).toBeCloseTo(10 + 50 + 0.25 + 12.5, 6);
  });

  it("reserves at least the whole max_tokens as output", () => {
    const worst = claudeWorstCaseUsd("claude-fable-5-1", { prompt: "가".repeat(1000), maxTokens: 20_000 });
    expect(worst).toBeGreaterThan(1);
    expect(worst).toBeLessThan(1.3);
  });
});
