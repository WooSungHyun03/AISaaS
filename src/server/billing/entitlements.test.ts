import { afterEach, describe, expect, it, vi } from "vitest";

const {
  canExecuteAutomation,
  CREDIT_EXHAUSTED_MESSAGE,
  getAutomationCreditKind,
  incrementUsage,
} = await import("./entitlements");

type Result = { data: unknown; error?: unknown; count?: number | null };

function makeSupabase(tableQueues: Record<string, Result[]>) {
  const builders: Record<string, Array<Record<string, ReturnType<typeof vi.fn>>>> = {};
  const from = vi.fn((table: string) => {
    const result = tableQueues[table]?.shift() ?? { data: null, error: null };
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "gt", "limit", "insert", "update"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.maybeSingle = vi.fn(() => Promise.resolve(result));
    builder.then = (resolve: (value: Result) => unknown) => resolve(result);
    (builders[table] ??= []).push(builder as Record<string, ReturnType<typeof vi.fn>>);
    return builder;
  });
  return { from, builders };
}

afterEach(() => vi.clearAllMocks());

describe("canExecuteAutomation — credit balance", () => {
  it.each([
    ["blog-marketing", "BLOG"],
    ["shorts", "SHORTS"],
  ] as const)("allows %s when an unexpired %s grant has remaining credit", async (slug, kind) => {
    const client = makeSupabase({ credit_grants: [{ data: { id: "grant-1" }, error: null }] });

    await expect(canExecuteAutomation(client as never, "user-1", slug)).resolves.toEqual({ allowed: true });

    const builder = client.builders.credit_grants[0];
    expect(builder.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(builder.eq).toHaveBeenCalledWith("kind", kind);
    expect(builder.gt).toHaveBeenCalledWith("remaining", 0);
    expect(builder.gt).toHaveBeenCalledWith("expires_at", expect.any(String));
    expect(builder.limit).toHaveBeenCalledWith(1);
  });

  it.each(["blog-marketing", "shorts"])("blocks %s at zero balance with the purchase message", async (slug) => {
    const client = makeSupabase({ credit_grants: [{ data: null, error: null }] });
    await expect(canExecuteAutomation(client as never, "user-1", slug)).resolves.toEqual({
      allowed: false,
      reason: CREDIT_EXHAUSTED_MESSAGE,
    });
  });

  it("does not apply content credits to an unrelated legacy template", async () => {
    const client = makeSupabase({});
    await expect(canExecuteAutomation(client as never, "user-1", "newsletter")).resolves.toEqual({ allowed: true });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("maps only metered generation templates", () => {
    expect(getAutomationCreditKind("blog-marketing")).toBe("BLOG");
    expect(getAutomationCreditKind("shorts")).toBe("SHORTS");
    expect(getAutomationCreditKind("newsletter")).toBeNull();
  });
});

describe("incrementUsage", () => {
  type AdminArg = Parameters<typeof incrementUsage>[0];

  it("keeps legacy analytics counters without using them as an entitlement", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await incrementUsage({ rpc, from: vi.fn() } as unknown as AdminArg, "user-1", { automationRuns: 1, aiGenerations: 2 });
    expect(rpc).toHaveBeenCalledWith("increment_usage", expect.objectContaining({ p_user_id: "user-1", p_runs: 1, p_generations: 2 }));
  });
});
