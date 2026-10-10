import { afterEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

const { getReadinessScore } = await import("./readiness");

const FULL_BUSINESS = {
  id: "business-1",
  industry: "베이커리",
  description: "동네 빵집",
  location: "서울",
  target_customer: "2030 직장인",
  brand_tone: "친근함",
  keywords: ["빵", "커피"],
  website: "https://example.com",
};

const EMPTY_BUSINESS = {
  id: "business-2",
  industry: null,
  description: null,
  location: null,
  target_customer: null,
  brand_tone: null,
  keywords: [],
  website: null,
};

/** Every query below chains .select/.eq/.neq/.in/.gte with no terminal single()/maybeSingle() — the chain itself is awaited, so it must be thenable. */
function makeThenable(result: { data?: unknown; count?: number; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "in", "gte", "order", "limit"]) {
    builder[method] = vi.fn(() => builder);
  }
  (builder as { then: unknown }).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function makeClient({
  connections = { data: [], error: null },
  automations = { data: [], error: null },
  automationRuns = { count: 0, error: null },
}: {
  connections?: { data: unknown; error: unknown };
  automations?: { data: unknown; error: unknown };
  automationRuns?: { count: number; error: unknown };
} = {}) {
  const table: Record<string, unknown> = {
    integration_connections: makeThenable(connections),
    automations: makeThenable(automations),
    automation_runs: makeThenable(automationRuns),
  };
  return { from: vi.fn((name: string) => table[name]) };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("getReadinessScore", () => {
  it("scores every row ready as 100 and returns nextTodo: null", async () => {
    createClientMock.mockResolvedValue(
      makeClient({
        connections: { data: [{ provider: "instagram", status: "CONNECTED", account_identifier: "@shop" }], error: null },
        automations: { data: [{ id: "a1", status: "ACTIVE" }], error: null },
        automationRuns: { count: 3, error: null },
      }),
    );

    const result = await getReadinessScore(FULL_BUSINESS as never, "user-1");

    expect(result.score).toBe(100);
    expect(result.nextTodo).toBeNull();
    expect(result.rows.every((row) => row.ready)).toBe(true);
  });

  it("scores an empty business as 0 and returns the profile row as nextTodo", async () => {
    createClientMock.mockResolvedValue(makeClient());

    const result = await getReadinessScore(EMPTY_BUSINESS as never, "user-1");

    expect(result.score).toBe(0);
    expect(result.nextTodo).toMatchObject({ key: "profile" });
  });

  it("skips the automation_runs query entirely when there are no automations", async () => {
    const client = makeClient();
    createClientMock.mockResolvedValue(client);

    await getReadinessScore(EMPTY_BUSINESS as never, "user-1");

    expect(client.from).not.toHaveBeenCalledWith("automation_runs");
  });

  it("throws when the integration_connections query fails", async () => {
    createClientMock.mockResolvedValue(makeClient({ connections: { data: null, error: new Error("boom") } }));
    await expect(getReadinessScore(FULL_BUSINESS as never, "user-1")).rejects.toThrow();
  });

  it("throws when the automation_runs query fails", async () => {
    createClientMock.mockResolvedValue(
      makeClient({ automations: { data: [{ id: "a1", status: "ACTIVE" }], error: null }, automationRuns: { count: 0, error: new Error("boom") } }),
    );
    await expect(getReadinessScore(FULL_BUSINESS as never, "user-1")).rejects.toThrow();
  });
});
