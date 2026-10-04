import { afterEach, describe, expect, it, vi } from "vitest";

const { canExecuteAutomation, incrementUsage } = await import("./entitlements");

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
      maybeSingle: vi.fn(() => Promise.resolve(result)),
      single: vi.fn(() => Promise.resolve(result)),
      then: (resolve: (value: Result) => unknown) => resolve(result),
    };
    return builder;
  });
  return { from };
}

const STARTER_SUBSCRIPTION = { plan: "STARTER" as const, status: "ACTIVE" as const };
const FREE_TEMPLATE_ID = { id: "tmpl-blog" };
const SHORTS_TEMPLATE_ID = { id: "tmpl-shorts" };

afterEach(() => {
  vi.clearAllMocks();
});

describe("canExecuteAutomation — per-content-type limits (STARTER: blog 8 / shorts 4 / total 30)", () => {
  it("blocks Shorts with LIMIT_EXCEEDED once its own sub-limit is hit, while Blog still has room under the combined limit", async () => {
    const supabase = makeSupabase({
      subscriptions: [{ data: STARTER_SUBSCRIPTION }],
      usage: [{ data: { automation_runs: 10 } }],
      automation_templates: [{ data: SHORTS_TEMPLATE_ID }],
      automations: [{ data: [{ id: "auto-1" }] }],
      automation_runs: [{ data: null, count: 4 }],
    });

    const result = await canExecuteAutomation(supabase as never, "user-1", "shorts");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("숏폼");
    expect(result.reason).toContain("4건");
  });

  it("still allows Blog to run when only Shorts' sub-limit is exhausted", async () => {
    const supabase = makeSupabase({
      subscriptions: [{ data: STARTER_SUBSCRIPTION }],
      usage: [{ data: { automation_runs: 10 } }],
      automation_templates: [{ data: FREE_TEMPLATE_ID }],
      automations: [{ data: [{ id: "auto-1" }] }],
      automation_runs: [{ data: null, count: 2 }],
    });

    const result = await canExecuteAutomation(supabase as never, "user-1", "blog-marketing");

    expect(result).toEqual({ allowed: true });
  });

  it("blocks Blog with LIMIT_EXCEEDED once its own sub-limit is hit, while Shorts still has room", async () => {
    const supabase = makeSupabase({
      subscriptions: [{ data: STARTER_SUBSCRIPTION }],
      usage: [{ data: { automation_runs: 10 } }],
      automation_templates: [{ data: FREE_TEMPLATE_ID }],
      automations: [{ data: [{ id: "auto-1" }] }],
      automation_runs: [{ data: null, count: 8 }],
    });

    const result = await canExecuteAutomation(supabase as never, "user-1", "blog-marketing");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("블로그");
    expect(result.reason).toContain("8건");
  });

  it("still allows Shorts to run when only Blog's sub-limit is exhausted", async () => {
    const supabase = makeSupabase({
      subscriptions: [{ data: STARTER_SUBSCRIPTION }],
      usage: [{ data: { automation_runs: 10 } }],
      automation_templates: [{ data: SHORTS_TEMPLATE_ID }],
      automations: [{ data: [{ id: "auto-2" }] }],
      automation_runs: [{ data: null, count: 1 }],
    });

    const result = await canExecuteAutomation(supabase as never, "user-1", "shorts");

    expect(result).toEqual({ allowed: true });
  });

  it("blocks on the combined monthly limit even when the content-specific sub-limit still has room, without querying per-type usage", async () => {
    const supabase = makeSupabase({
      subscriptions: [{ data: STARTER_SUBSCRIPTION }],
      usage: [{ data: { automation_runs: 30 } }],
    });

    const result = await canExecuteAutomation(supabase as never, "user-1", "blog-marketing");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("제작 한도");
    expect(result.reason).not.toContain("블로그");
    // The combined-limit check short-circuits before resolving template -> automations -> runs.
    expect(supabase.from).not.toHaveBeenCalledWith("automation_templates");
  });
});

describe("canExecuteAutomation — FREE plan", () => {
  it("blocks Shorts from the very first run, since FREE isn't even allowed to use non-blog templates", async () => {
    const supabase = makeSupabase({
      subscriptions: [{ data: { plan: "FREE", status: "ACTIVE" } }],
    });

    const result = await canExecuteAutomation(supabase as never, "user-1", "shorts");

    expect(result.allowed).toBe(false);
  });
});

describe("canExecuteAutomation — regression (existing behavior unaffected)", () => {
  it("still allows a run for a template with no content-specific sub-limit (e.g. newsletter) once under the combined limit", async () => {
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

describe("canExecuteAutomation — free plan enforcement lives on the server", () => {
  it("blocks Shorts for a FREE user and points to an upgrade (a direct API call cannot bypass the UI)", async () => {
    const supabase = makeSupabase({ subscriptions: [{ data: { plan: "FREE", status: "ACTIVE" } }] });

    const result = await canExecuteAutomation(supabase as never, "user-1", "shorts");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("무료 요금제");
    expect(result.reason).toContain("올리면");
  });

  it("treats a canceled or past-due paid subscription as FREE immediately", async () => {
    for (const status of ["CANCELED", "PAST_DUE", "INCOMPLETE"] as const) {
      const supabase = makeSupabase({ subscriptions: [{ data: { plan: "PRO", status } }] });
      const result = await canExecuteAutomation(supabase as never, "user-1", "shorts");
      expect(result.allowed).toBe(false);
    }
  });
});
