import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("./handlers", () => ({ getHandler: vi.fn() }));
vi.mock("@/server/billing/entitlements", () => ({ canExecuteAutomation: vi.fn(), incrementUsage: vi.fn() }));

const { advanceDeferredRun, readDeferredJob } = await import("./runner");

/** Chainable fake: every `.from("automation_runs")` resolves the queued results in order. */
function fakeAdmin(results: Array<{ data: unknown; error?: unknown }>) {
  const updates: unknown[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "not"]) builder[method] = vi.fn(() => builder);
  builder.update = vi.fn((payload: unknown) => (updates.push(payload), builder));
  const next = () => results.shift() ?? { data: null, error: null };
  builder.maybeSingle = vi.fn(async () => next());
  builder.single = vi.fn(async () => next());
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(next()).then(resolve);
  return { admin: { from: vi.fn(() => builder) }, updates };
}

const job = (overrides: Record<string, unknown> = {}) => ({ job: { rev: 3, leaseUntil: null, state: { stage: "ANIMATING" }, progress: "캐릭터를 움직이는 중이에요 (1/5)", startedAt: "2026-10-10T00:00:00.000Z", transientErrors: 0, ...overrides } });

beforeEach(() => vi.resetAllMocks());

describe("readDeferredJob", () => {
  it("reads the job record out of a run's output", () => {
    expect(readDeferredJob(job() as never)).toMatchObject({ rev: 3, leaseUntil: null, progress: "캐릭터를 움직이는 중이에요 (1/5)", transientErrors: 0 });
  });

  it("returns null for finished or ordinary outputs", () => {
    expect(readDeferredJob(null)).toBeNull();
    expect(readDeferredJob({ hook: "x" } as never)).toBeNull();
    expect(readDeferredJob({ job: { rev: "3" } } as never)).toBeNull();
    expect(readDeferredJob([] as never)).toBeNull();
  });
});

describe("advanceDeferredRun", () => {
  it("reports an unknown run and one that is not deferred", async () => {
    createAdminClientMock.mockReturnValue(fakeAdmin([{ data: null }]).admin);
    expect(await advanceDeferredRun("missing")).toMatchObject({ status: "NOT_DEFERRED" });

    createAdminClientMock.mockReturnValue(fakeAdmin([{ data: { id: "r", status: "RUNNING", output: null } }]).admin);
    expect(await advanceDeferredRun("r")).toMatchObject({ status: "NOT_DEFERRED" });
  });

  it("returns the final status of a run that already finished", async () => {
    createAdminClientMock.mockReturnValue(fakeAdmin([{ data: { id: "r", status: "FAILED", error_message: "boom", output: null } }]).admin);
    expect(await advanceDeferredRun("r")).toMatchObject({ status: "FAILED", errorMessage: "boom" });
  });

  it("does nothing while another caller holds the lease", async () => {
    const leaseUntil = new Date(Date.now() + 60_000).toISOString();
    const { admin, updates } = fakeAdmin([{ data: { id: "r", status: "RUNNING", output: job({ leaseUntil }) } }]);
    createAdminClientMock.mockReturnValue(admin);

    expect(await advanceDeferredRun("r")).toMatchObject({ status: "BUSY", progress: "캐릭터를 움직이는 중이에요 (1/5)" });
    expect(updates).toHaveLength(0);
  });

  it("backs off when losing the compare-and-swap race for the lease", async () => {
    const { admin, updates } = fakeAdmin([
      { data: { id: "r", status: "RUNNING", output: job() } },
      { data: [] }, // the claim updated zero rows: somebody else advanced it first
    ]);
    createAdminClientMock.mockReturnValue(admin);

    expect(await advanceDeferredRun("r")).toMatchObject({ status: "BUSY" });
    expect(updates).toHaveLength(1);
    expect((updates[0] as { output: { job: { rev: number; leaseUntil: string } } }).output.job).toMatchObject({ rev: 4 });
  });
});
