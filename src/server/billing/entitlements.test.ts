import { afterEach, describe, expect, it, vi } from "vitest";

const { canExecuteAutomation, canUseAnimatedShorts, incrementUsage } = await import("./entitlements");

/**
 * Minimal per-table chainable Supabase stand-in. `from(table)` pops the next
 * queued result for that table (so a single test can express the sequence
 * of `.from(...)` calls one `canExecuteAutomation()` call makes) and every
 * chain method returns the same object, resolving via `.maybeSingle()` or
 * by being awaited directly (for a `{ count: "exact", head: true }` query).
 */
type Result = { data: unknown; error?: unknown; count?: number | null };

function makeSupabase(tableQueues: Record<string, Result[]>) {
  const from = vi.fn((table: string) => {
    const queue = tableQueues[table];
    const result: Result = queue && queue.length > 0 ? queue.shift()! : { data: null, error: null };
    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      in: vi.fn(() => builder),
      gte: vi.fn(() => builder),
      lt: vi.fn(() => builder),
      gt: vi.fn(() => builder),
      order: vi.fn(() => builder),
      maybeSingle: vi.fn(() => Promise.resolve(result)),
      single: vi.fn(() => Promise.resolve(result)),
      then: (resolve: (value: Result) => unknown) => resolve(result),
    };
    return builder;
  });
  return { from };
}

const STARTER_SUBSCRIPTION = { plan: "STARTER" as const, status: "ACTIVE" as const };

afterEach(() => {
  vi.clearAllMocks();
});

/** credit_grants rows are read straight (`select ... order`) and awaited, so each queued result is the whole list. */
function withGrants(grants: Array<{ remaining: number; expires_at: string }>, extra: Record<string, Result[]> = {}) {
  return makeSupabase({ credit_grants: [{ data: grants }], ...extra });
}

const FUTURE = "2999-01-01T00:00:00.000Z";

describe("canExecuteAutomation — Blog and Shorts are metered by credits, never by plan", () => {
  it("blocks Blog for an account with no credit at all and points to buying one", async () => {
    const supabase = withGrants([]);

    const result = await canExecuteAutomation(supabase as never, "user-1", "blog-marketing");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("블로그 이용권");
    expect(result.reason).toContain("구매");
    // Plan data is irrelevant for metered templates.
    expect(supabase.from).not.toHaveBeenCalledWith("subscriptions");
  });

  it("allows Blog when a usable credit exists, regardless of plan", async () => {
    const result = await canExecuteAutomation(withGrants([{ remaining: 2, expires_at: FUTURE }]) as never, "user-1", "blog-marketing");
    expect(result).toEqual({ allowed: true });
  });

  it("keeps Blog and Shorts credits independent", async () => {
    const supabase = withGrants([]);
    const shorts = await canExecuteAutomation(supabase as never, "user-1", "shorts");
    expect(shorts.allowed).toBe(false);
    expect(shorts.reason).toContain("숏폼 이용권");
  });
});

describe("canExecuteAutomation — templates without credits keep their plan rules", () => {
  it("still allows a run for a template with no credit meter (e.g. newsletter) once under the combined limit", async () => {
    const supabase = makeSupabase({
      subscriptions: [{ data: STARTER_SUBSCRIPTION }],
      usage: [{ data: { automation_runs: 5 } }],
    });

    const result = await canExecuteAutomation(supabase as never, "user-1", "newsletter");

    expect(result).toEqual({ allowed: true });
  });

  it("still blocks on the combined monthly limit regardless of template", async () => {
    const supabase = makeSupabase({
      subscriptions: [{ data: STARTER_SUBSCRIPTION }],
      usage: [{ data: { automation_runs: 30 } }],
    });

    const result = await canExecuteAutomation(supabase as never, "user-1", "newsletter");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("스타터");
  });

  it("treats a canceled or past-due paid subscription as FREE immediately", async () => {
    for (const status of ["CANCELED", "PAST_DUE", "INCOMPLETE"] as const) {
      const supabase = makeSupabase({ subscriptions: [{ data: { plan: "PRO", status } }] });
      const result = await canExecuteAutomation(supabase as never, "user-1", "newsletter");
      expect(result.allowed).toBe(false);
    }
  });
});

describe("incrementUsage", () => {
  type AdminArg = Parameters<typeof incrementUsage>[0];

  it("increments through the atomic RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn();
    await incrementUsage({ rpc, from } as unknown as AdminArg, "user-1", { automationRuns: 1, aiGenerations: 2 });
    expect(rpc).toHaveBeenCalledWith("increment_usage", expect.objectContaining({ p_user_id: "user-1", p_runs: 1, p_generations: 2 }));
    expect(from).not.toHaveBeenCalled();
  });

  it("falls back to read-then-write only when the RPC does not exist yet", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: "PGRST202" } });
    const insert = vi.fn().mockResolvedValue({ error: null });
    const builder = { select: vi.fn(() => builder), eq: vi.fn(() => builder), maybeSingle: vi.fn().mockResolvedValue({ data: null }), insert };
    const from = vi.fn(() => builder);
    await incrementUsage({ rpc, from } as unknown as AdminArg, "user-1", { automationRuns: 1 });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-1", automation_runs: 1, ai_generations: 0 }));
  });

  it("never throws on other RPC errors (the content is already saved)", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { code: "XX000" } });
    const from = vi.fn();
    await expect(incrementUsage({ rpc, from } as unknown as AdminArg, "user-1", { automationRuns: 1 })).resolves.toBeUndefined();
    expect(from).not.toHaveBeenCalled();
  });
});

describe("canUseAnimatedShorts", () => {
  it("is part of the Shorts credit: always allowed, at standard quality", async () => {
    expect(await canUseAnimatedShorts(makeSupabase({}) as never, "user-1")).toEqual({ allowed: true, animationQuality: "standard" });
  });
});
