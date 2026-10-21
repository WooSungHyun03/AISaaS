import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/** Real database + RLS for migration 0076 and the slot claim. Needs `bash scripts/dev-db.sh`; skipped otherwise (RUN_DB_TESTS=1 to run). */
function localEnv(): Record<string, string> | null {
  try {
    const text = readFileSync(path.join(process.cwd(), ".env.local.supabase"), "utf8");
    return Object.fromEntries(text.split(/\r?\n/).map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())).filter((m): m is RegExpExecArray => Boolean(m)).map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, "")]));
  } catch {
    return null;
  }
}
const env = process.env.RUN_DB_TESTS ? localEnv() : null;
const suite = env ? describe : describe.skip;
type Db = SupabaseClient<Database>;

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const state = vi.hoisted(() => ({ admin: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.admin }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

suite("scheduler: slot claim and tick log (migration 0076)", () => {
  const admin: Db = createClient<Database>(env?.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost", env?.SUPABASE_SERVICE_ROLE_KEY ?? "x", options);
  state.admin = admin;
  let userId = "";
  let automationId = "";
  let userDb: Db;
  const SCHEDULE = { frequency: "WEEKLY", daysOfWeek: [1, 3, 5], timeOfDay: "09:00", timezone: "Asia/Seoul" };

  async function newAutomation(nextRunAt: string | null, status = "ACTIVE") {
    const business = await admin.from("businesses").insert({ owner_id: userId, name: `예약 테스트 ${randomUUID().slice(0, 6)}` }).select("id").single();
    const template = await admin.from("automation_templates").select("id").eq("slug", "blog-marketing").single();
    const created = await admin.from("automations").insert({ user_id: userId, business_id: business.data!.id, template_id: template.data!.id, name: "예약 테스트", status: status as never, schedule: SCHEDULE, next_run_at: nextRunAt }).select("id").single();
    if (created.error) throw created.error;
    return created.data.id;
  }

  beforeAll(async () => {
    const email = `sched-${Date.now()}@autobiz.local`;
    const created = await admin.auth.admin.createUser({ email, password: "Sched-test-1!", email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("user not created");
    userId = created.data.user.id;
    userDb = createClient<Database>(env!.NEXT_PUBLIC_SUPABASE_URL, env!.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
    const signedIn = await userDb.auth.signInWithPassword({ email, password: "Sched-test-1!" });
    if (signedIn.error) throw signedIn.error;
    automationId = await newAutomation("2026-10-19T00:00:00.000Z");
  });

  afterAll(async () => {
    await admin.auth.admin.deleteUser(userId);
  });

  it("two overlapping ticks take the same due slot exactly once", async () => {
    const { claimDueSlot } = await import("./scheduler");
    const due = { id: automationId, schedule: SCHEDULE as never, next_run_at: "2026-10-19T00:00:00.000Z" };
    const now = new Date("2026-10-19T00:05:00.000Z");

    const results = await Promise.all([claimDueSlot(due, now), claimDueSlot(due, now), claimDueSlot(due, now)]);

    expect(results.filter((result) => result.kind === "CLAIMED")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "LOST")).toHaveLength(2);
    // the slot moved to the next chosen weekday (Wed 09:00 KST = 00:00 UTC)
    const row = await admin.from("automations").select("next_run_at").eq("id", automationId).single();
    expect(row.data?.next_run_at).toBe("2026-10-21T00:00:00+00:00");
  });

  it("a paused or parked automation is never claimed, even with a due next_run_at", async () => {
    const { claimDueSlot } = await import("./scheduler");
    for (const status of ["PAUSED", "ERROR", "DRAFT"]) {
      const id = await newAutomation("2026-10-19T00:00:00.000Z", status);
      const claim = await claimDueSlot({ id, schedule: SCHEDULE as never, next_run_at: "2026-10-19T00:00:00.000Z" }, new Date("2026-10-19T00:05:00.000Z"));
      expect(claim.kind, status).toBe("LOST");
    }
  });

  it("a slot that was missed for more than 12 hours is claimed as overdue, and the schedule continues from the next slot (not from the missed one)", async () => {
    const { claimDueSlot, MAX_CATCH_UP_MS } = await import("./scheduler");
    const id = await newAutomation("2026-10-14T00:00:00.000Z");
    const claim = await claimDueSlot({ id, schedule: SCHEDULE as never, next_run_at: "2026-10-14T00:00:00.000Z" }, new Date("2026-10-16T03:00:00.000Z"));
    expect(claim).toMatchObject({ kind: "CLAIMED" });
    expect((claim as { overdueMs: number }).overdueMs).toBeGreaterThan(MAX_CATCH_UP_MS);
    const row = await admin.from("automations").select("next_run_at").eq("id", id).single();
    expect(row.data?.next_run_at).toBe("2026-10-19T00:00:00+00:00"); // Monday: Friday's slot (10-16 00:00 UTC) was already past
  });

  it("parks a due automation whose schedule has no next slot instead of leaving it first in the due queue", async () => {
    const { claimDueSlot, findDueAutomations } = await import("./scheduler");
    const id = await newAutomation("2026-10-19T00:00:00.000Z");
    const broken = { frequency: "WEEKLY", daysOfWeek: [], timeOfDay: "09:00", timezone: "Asia/Seoul" };
    await admin.from("automations").update({ schedule: broken }).eq("id", id);
    const now = new Date("2026-10-19T00:05:00.000Z");

    const results = await Promise.all([claimDueSlot({ id, schedule: broken as never, next_run_at: "2026-10-19T00:00:00.000Z" }, now), claimDueSlot({ id, schedule: broken as never, next_run_at: "2026-10-19T00:00:00.000Z" }, now)]);

    expect(results.map((result) => result.kind).sort()).toEqual(["INVALID_SCHEDULE", "LOST"]);
    const row = await admin.from("automations").select("status, next_run_at").eq("id", id).single();
    expect(row.data).toEqual({ status: "ERROR", next_run_at: null });
    expect((await findDueAutomations(100, now)).some((due) => due.id === id)).toBe(false);
  });

  it("counts consecutive failures, defaulting to 0 and refusing a negative count", async () => {
    const row = await admin.from("automations").select("consecutive_failures").eq("id", automationId).single();
    expect(row.data?.consecutive_failures).toBe(0);
    expect((await admin.from("automations").update({ consecutive_failures: 2 }).eq("id", automationId)).error).toBeNull();
    expect((await admin.from("automations").update({ consecutive_failures: -1 }).eq("id", automationId)).error).not.toBeNull();
  });

  it("keeps the tick log to the service role: customers can neither read nor write it", async () => {
    const inserted = await admin.from("scheduler_ticks").insert({ trigger: "CRON", due_found: 2, started: 1 }).select("id").single();
    expect(inserted.error).toBeNull();
    expect((await userDb.from("scheduler_ticks").select("id")).data ?? []).toHaveLength(0);
    expect((await userDb.from("scheduler_ticks").insert({ trigger: "CRON" })).error).not.toBeNull();
    expect((await admin.from("scheduler_ticks").insert({ trigger: "WHENEVER" })).error).not.toBeNull();
    await admin.from("scheduler_ticks").delete().eq("id", inserted.data!.id);
  });

  it("reports the scheduler as healthy only when a tick ran in the last 15 minutes", async () => {
    const { getSchedulerHealth } = await import("./ticks");
    await admin.from("scheduler_ticks").delete().gte("started_at", "2000-01-01");
    expect(await getSchedulerHealth()).toMatchObject({ lastTickAt: null, healthy: false });
    await admin.from("scheduler_ticks").insert({ trigger: "CRON", started_at: new Date(Date.now() - 4 * 60_000).toISOString() });
    expect(await getSchedulerHealth()).toMatchObject({ healthy: true });
    await admin.from("scheduler_ticks").delete().gte("started_at", "2000-01-01");
    await admin.from("scheduler_ticks").insert({ trigger: "CRON", started_at: new Date(Date.now() - 40 * 60_000).toISOString() });
    expect(await getSchedulerHealth()).toMatchObject({ healthy: false });
    await admin.from("scheduler_ticks").delete().gte("started_at", "2000-01-01");
  });
});
