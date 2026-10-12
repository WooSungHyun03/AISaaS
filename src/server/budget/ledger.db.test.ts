import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

/** The TypeScript wrappers against the real ledger (migration 0073). Needs `bash scripts/dev-db.sh`; skipped otherwise (RUN_DB_TESTS=1 to run). */
const env = vi.hoisted(() => {
  if (!process.env.RUN_DB_TESTS) return null;
  try {
    const fsx = process.getBuiltinModule("node:fs");
    const pathx = process.getBuiltinModule("node:path");
    const text = fsx.readFileSync(pathx.join(process.cwd(), ".env.local.supabase"), "utf8");
    const values = Object.fromEntries(text.split(/\r?\n/).map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())).filter((m): m is RegExpExecArray => Boolean(m)).map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, "")]));
    Object.assign(process.env, {
      NEXT_PUBLIC_SUPABASE_URL: values.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: values.SUPABASE_SERVICE_ROLE_KEY,
      BUDGET_PERIOD_START: "2026-01-01",
      BUDGET_PERIOD_END: "2030-01-02",
      BUDGET_VIDEO_USD: "20",
      BUDGET_VIDEO_ITEMS: "2",
      BUDGET_VIDEO_ITEM_CAP_USD: "8",
      BUDGET_VIDEO_ITEM_FLOOR_USD: "2",
    });
    return values;
  } catch {
    return null;
  }
});

const suite = env ? describe : describe.skip;

suite("budget ledger wrappers", () => {
  const runs: string[] = [];
  const newRun = () => { const id = randomUUID(); runs.push(id); return id; };

  afterAll(async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    for (const id of runs) {
      await admin.from("budget_spend").delete().eq("run_id", id);
      await admin.from("budget_items").delete().eq("run_id", id);
    }
  });

  const call = (runId: string, usd: number, step = "video.generate") => ({ kind: "VIDEO" as const, runId, step, attempt: 1, provider: "fal", model: "wan", usd, idempotencyKey: randomUUID() });

  it("maps the ledger's refusals to BudgetError codes the app can show", async () => {
    const { claimBudgetItem, reserveSpend, closeFailedRunBudget } = await import("@/server/budget");
    const run = newRun();
    await claimBudgetItem("VIDEO", run);
    await expect(reserveSpend(call(run, 8.5))).rejects.toMatchObject({ code: "BUDGET_ITEM_CAP_EXCEEDED" });
    await expect(reserveSpend(call(run, 7.5))).resolves.toMatchObject({ usd: 7.5 });
    await closeFailedRunBudget(run);
  });

  it("refuses the third item in a two-item period, and gives a failed run's slot back", async () => {
    const { claimBudgetItem, closeFailedRunBudget, closeRunItem, getBudgetStatus } = await import("@/server/budget");
    const a = newRun(), b = newRun(), c = newRun();
    const before = await getBudgetStatus("VIDEO");
    const room = before.itemLimit - before.itemsClaimed - before.itemsCompleted;
    for (let filler = 0; filler < room - 2; filler++) await claimBudgetItem("VIDEO", newRun());
    await claimBudgetItem("VIDEO", a);
    await claimBudgetItem("VIDEO", b);
    await expect(claimBudgetItem("VIDEO", c)).rejects.toMatchObject({ code: "BUDGET_ITEM_LIMIT" });
    await closeFailedRunBudget(a);
    await expect(claimBudgetItem("VIDEO", c)).resolves.toBeUndefined();
    await closeRunItem(b, "COMPLETED");
    await closeRunItem(c, "COMPLETED");
    // Put the period back as found, so the next test has its slots.
    for (const id of runs) await closeFailedRunBudget(id);
    const admin = (await import("@/lib/supabase/admin")).createAdminClient();
    await admin.from("budget_items").update({ state: "RELEASED" }).in("run_id", [b, c]);
  });

  it("books reservations left open by a dead run as spent (never undercounted) and reports a run's cost call by call", async () => {
    const { claimBudgetItem, reserveSpend, settleSpend, settleOpenReservations, summarizeRunSpend, closeFailedRunBudget } = await import("@/server/budget");
    const run = newRun();
    await claimBudgetItem("VIDEO", run);
    const planning = await reserveSpend(call(run, 0.4, "video.plan"));
    await settleSpend(planning.id, 0.12, { inputTokens: 100 });
    await reserveSpend(call(run, 3.75));
    expect(await settleOpenReservations(run, "worker died")).toBe(1);
    expect(await settleOpenReservations(run)).toBe(0);
    const spend = await summarizeRunSpend(run);
    expect(spend.totalUsd).toBeCloseTo(3.87, 6);
    expect(spend.steps.map((step) => `${step.step}:${step.state}:${step.usd}`)).toEqual(["video.plan:SETTLED:0.12", "video.generate:SETTLED:3.75"]);
    expect(spend.steps[1].usage).toMatchObject({ assumed: "worker died" });
    await closeFailedRunBudget(run);
  });
});
