import { afterEach, describe, expect, it, vi } from "vitest";

const { canExecuteAutomation } = await import("./entitlements");

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
    expect(result.reason).toContain("4회");
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
    expect(result.reason).toContain("8회");
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
    expect(result.reason).toContain("실행 한도");
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
    expect(result.reason).toContain("Starter");
  });
});
