import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIProviderError } from "./errors";
import type { AIProvider } from "./provider";

const { getAIProviderMock, reserveSpend, settleSpend, releaseSpend, env } = vi.hoisted(() => ({
  getAIProviderMock: vi.fn(),
  reserveSpend: vi.fn(),
  settleSpend: vi.fn(),
  releaseSpend: vi.fn(),
  env: { ALLOW_PAID_AI_CALLS: "true", BUDGET_FREEZE: "false" } as Record<string, string>,
}));

vi.mock("./index", () => ({ getAIProvider: getAIProviderMock }));
vi.mock("@/server/budget/ledger", () => ({ reserveSpend, settleSpend, releaseSpend }));
vi.mock("@/server/budget/config", () => ({
  assertPaidCallsAllowed: () => {
    if (env.BUDGET_FREEZE === "true") throw Object.assign(new Error("frozen"), { code: "BUDGET_FROZEN" });
    if (env.ALLOW_PAID_AI_CALLS !== "true") throw Object.assign(new Error("off"), { code: "PAID_CALLS_DISABLED" });
  },
}));

const { generateText } = await import("./generate");
const { withBudgetScope } = await import("@/server/budget/scope");

const scope = { kind: "BLOG" as const, runId: "11111111-1111-4111-8111-111111111111", attempt: 1 };
const usage = { inputTokens: 1000, outputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0 };

function provider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    name: "anthropic",
    estimateCall: () => ({ model: "claude-opus-5-5", worstCaseUsd: 0.5 }),
    generateText: vi.fn().mockResolvedValue({ text: "ok", model: "claude-opus-5-5", usage }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  env.ALLOW_PAID_AI_CALLS = "true";
  env.BUDGET_FREEZE = "false";
  reserveSpend.mockResolvedValue({ id: "res-1", usd: 0.5 });
  settleSpend.mockResolvedValue(undefined);
  releaseSpend.mockResolvedValue(undefined);
});

describe("metered AI calls", () => {
  it("reserves the worst case, then settles to the real token cost", async () => {
    getAIProviderMock.mockReturnValue(provider());
    const text = await withBudgetScope(scope, () => generateText({ prompt: "p", role: "planner", purpose: "blog.plan" }));
    expect(text).toBe("ok");
    expect(reserveSpend).toHaveBeenCalledWith(expect.objectContaining({ kind: "BLOG", runId: scope.runId, step: "blog.plan", usd: 0.5, model: "claude-opus-5-5" }));
    // 1000 in × $4/M + 2000 out × $20/M
    expect(settleSpend).toHaveBeenCalledWith("res-1", expect.closeTo(0.044, 6), expect.objectContaining({ inputTokens: 1000, outputTokens: 2000 }));
    expect(releaseSpend).not.toHaveBeenCalled();
  });

  it("refuses a paid call outside a budget scope, before anything is sent", async () => {
    const p = provider();
    getAIProviderMock.mockReturnValue(p);
    await expect(generateText({ prompt: "p", role: "writer" })).rejects.toMatchObject({ code: "BUDGET_SCOPE_MISSING" });
    expect(p.generateText).not.toHaveBeenCalled();
    expect(reserveSpend).not.toHaveBeenCalled();
  });

  it("refuses when paid calls are not opted in or frozen", async () => {
    const p = provider();
    getAIProviderMock.mockReturnValue(p);
    env.ALLOW_PAID_AI_CALLS = "false";
    await expect(withBudgetScope(scope, () => generateText({ prompt: "p", role: "writer" }))).rejects.toMatchObject({ code: "PAID_CALLS_DISABLED" });
    env.ALLOW_PAID_AI_CALLS = "true";
    env.BUDGET_FREEZE = "true";
    await expect(withBudgetScope(scope, () => generateText({ prompt: "p", role: "writer" }))).rejects.toMatchObject({ code: "BUDGET_FROZEN" });
    expect(p.generateText).not.toHaveBeenCalled();
    expect(reserveSpend).not.toHaveBeenCalled();
  });

  it("does not call the provider when the ledger refuses the reservation", async () => {
    const p = provider();
    getAIProviderMock.mockReturnValue(p);
    reserveSpend.mockRejectedValue(Object.assign(new Error("cap"), { code: "BUDGET_CAP_EXCEEDED" }));
    await expect(withBudgetScope(scope, () => generateText({ prompt: "p", role: "writer" }))).rejects.toMatchObject({ code: "BUDGET_CAP_EXCEEDED" });
    expect(p.generateText).not.toHaveBeenCalled();
  });

  it("blocks a provider that cannot price the call", async () => {
    getAIProviderMock.mockReturnValue(provider({ estimateCall: () => undefined }));
    await expect(withBudgetScope(scope, () => generateText({ prompt: "p", role: "writer" }))).rejects.toMatchObject({ code: "BUDGET_UNPRICEABLE" });
    expect(reserveSpend).not.toHaveBeenCalled();
  });

  it("settles a failed-but-billed call (cut off, refused) at its real usage", async () => {
    getAIProviderMock.mockReturnValue(provider({
      generateText: vi.fn().mockRejectedValue(new AIProviderError("INVALID_STRUCTURED_RESPONSE", "anthropic", "cut off", { billed: { model: "claude-opus-5-5", usage } })),
    }));
    await expect(withBudgetScope(scope, () => generateText({ prompt: "p", role: "planner" }))).rejects.toMatchObject({ code: "INVALID_STRUCTURED_RESPONSE" });
    expect(settleSpend).toHaveBeenCalledWith("res-1", expect.closeTo(0.044, 6), expect.anything());
  });

  it("releases the reservation when the provider rejected the request before any work", async () => {
    getAIProviderMock.mockReturnValue(provider({ generateText: vi.fn().mockRejectedValue(new AIProviderError("BAD_REQUEST", "anthropic", "400")) }));
    await expect(withBudgetScope(scope, () => generateText({ prompt: "p", role: "planner" }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(releaseSpend).toHaveBeenCalledWith("res-1", expect.any(String));
    expect(settleSpend).not.toHaveBeenCalled();
  });

  it("assumes a timed-out call was billed in full", async () => {
    getAIProviderMock.mockReturnValue(provider({ generateText: vi.fn().mockRejectedValue(new AIProviderError("TIMEOUT", "anthropic", "slow")) }));
    await expect(withBudgetScope(scope, () => generateText({ prompt: "p", role: "planner" }))).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(settleSpend).toHaveBeenCalledWith("res-1", 0.5, expect.anything());
    expect(releaseSpend).not.toHaveBeenCalled();
  });

  it("does not meter the mock provider or role-less helper calls", async () => {
    getAIProviderMock.mockReturnValue(provider({ name: "mock" }));
    await withBudgetScope(scope, () => generateText({ prompt: "p", role: "writer" }));
    getAIProviderMock.mockReturnValue(provider());
    await generateText({ prompt: "p" });
    expect(reserveSpend).not.toHaveBeenCalled();
  });
});
