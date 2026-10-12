import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/** Real database. Needs `bash scripts/dev-db.sh`; skipped otherwise (RUN_DB_TESTS=1 to run). */
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

suite("budget ledger (migration 0073)", () => {
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin: Db = createClient<Database>(env?.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost", env?.SUPABASE_SERVICE_ROLE_KEY ?? "x", options);
  const anon: Db = createClient<Database>(env?.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost", env?.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "x", options);
  const periods: string[] = [];
  const newPeriod = () => { const p = `test-${randomUUID()}`; periods.push(p); return p; };

  afterAll(async () => {
    for (const period of periods) {
      await admin.from("budget_spend").delete().eq("period_key", period);
      await admin.from("budget_items").delete().eq("period_key", period);
    }
  });

  // A strict VIDEO setup: $50 cap, 10 items, $5 floor per item (no slack at all), $9 per-item cap.
  const limits = { p_cap_usd: 50, p_item_floor_usd: 5, p_item_limit: 10, p_item_cap_usd: 9 };
  const reserve = (period: string, run: string | null, usd: number, key = randomUUID(), kind = "VIDEO", extra: Partial<typeof limits> = {}) =>
    admin.rpc("budget_reserve", { p_period: period, p_kind: kind, p_run_id: run, p_step: "t", p_attempt: 1, p_provider: "test", p_model: null, p_usd: usd, p_idempotency_key: key, ...limits, ...extra });

  it("reserves, settles to the real cost and frees the difference", async () => {
    const period = newPeriod();
    const run = randomUUID();
    await admin.rpc("budget_claim_item", { p_period: period, p_kind: "VIDEO", p_run_id: run, p_item_limit: 10 });
    const r = await reserve(period, run, 4);
    expect(r.error).toBeNull();
    let status = (await admin.rpc("budget_status", { p_period: period, p_kind: "VIDEO" })).data as Record<string, number>;
    expect(status.reservedUsd).toBe(4);
    await admin.rpc("budget_settle", { p_id: r.data!, p_actual_usd: 2.5, p_usage: { x: 1 } });
    status = (await admin.rpc("budget_status", { p_period: period, p_kind: "VIDEO" })).data as Record<string, number>;
    expect(status.reservedUsd).toBe(0);
    expect(status.settledUsd).toBe(2.5);
  });

  it("is idempotent: the same key is the same reservation, and settling twice books once", async () => {
    const period = newPeriod();
    const run = randomUUID();
    await admin.rpc("budget_claim_item", { p_period: period, p_kind: "VIDEO", p_run_id: run, p_item_limit: 10 });
    const key = randomUUID();
    const first = await reserve(period, run, 3, key);
    const again = await reserve(period, run, 3, key);
    expect(again.data).toBe(first.data);
    await admin.rpc("budget_settle", { p_id: first.data!, p_actual_usd: 3 });
    await admin.rpc("budget_settle", { p_id: first.data!, p_actual_usd: 3 });
    await admin.rpc("budget_release", { p_id: first.data! });
    const status = (await admin.rpc("budget_status", { p_period: period, p_kind: "VIDEO" })).data as Record<string, number>;
    expect(status.settledUsd).toBe(3);
    expect(status.reservedUsd).toBe(0);
  });

  it("refuses a reservation that would pass the per-item cap (BG003)", async () => {
    const period = newPeriod();
    const run = randomUUID();
    await admin.rpc("budget_claim_item", { p_period: period, p_kind: "VIDEO", p_run_id: run, p_item_limit: 10 });
    const loose = { p_item_floor_usd: 3.5 };
    expect((await reserve(period, run, 6, randomUUID(), "VIDEO", loose)).error).toBeNull();
    const over = await reserve(period, run, 3.5, randomUUID(), "VIDEO", loose);
    expect(over.error?.code).toBe("BG003");
  });

  it("holds back the floor for every unfinished item, so retries cannot starve them (BG002)", async () => {
    const period = newPeriod();
    // Ten items × $5 floor = $50: nothing is left to spend above the floor.
    const run = randomUUID();
    await admin.rpc("budget_claim_item", { p_period: period, p_kind: "VIDEO", p_run_id: run, p_item_limit: 10 });
    expect((await reserve(period, run, 5)).error).toBeNull();
    expect((await reserve(period, run, 0.5)).error?.code).toBe("BG002");
    // Another item can still use its own floor.
    const other = randomUUID();
    await admin.rpc("budget_claim_item", { p_period: period, p_kind: "VIDEO", p_run_id: other, p_item_limit: 10 });
    expect((await reserve(period, other, 5)).error).toBeNull();
  });

  it("limits the period to the item limit and gives a released slot back (BG001)", async () => {
    const period = newPeriod();
    const runs = Array.from({ length: 3 }, () => randomUUID());
    for (const run of runs.slice(0, 2)) expect((await admin.rpc("budget_claim_item", { p_period: period, p_kind: "BLOG", p_run_id: run, p_item_limit: 2 })).error).toBeNull();
    expect((await admin.rpc("budget_claim_item", { p_period: period, p_kind: "BLOG", p_run_id: runs[2], p_item_limit: 2 })).error?.code).toBe("BG001");
    // Claiming again for a run that already holds a slot is fine.
    expect((await admin.rpc("budget_claim_item", { p_period: period, p_kind: "BLOG", p_run_id: runs[0], p_item_limit: 2 })).error).toBeNull();
    await admin.rpc("budget_release_item", { p_period: period, p_kind: "BLOG", p_run_id: runs[0] });
    expect((await admin.rpc("budget_claim_item", { p_period: period, p_kind: "BLOG", p_run_id: runs[2], p_item_limit: 2 })).error).toBeNull();
    // A completed item keeps its slot for good.
    await admin.rpc("budget_complete_item", { p_period: period, p_kind: "BLOG", p_run_id: runs[1] });
    await admin.rpc("budget_release_item", { p_period: period, p_kind: "BLOG", p_run_id: runs[1] });
    expect((await admin.rpc("budget_claim_item", { p_period: period, p_kind: "BLOG", p_run_id: randomUUID(), p_item_limit: 2 })).error?.code).toBe("BG001");
  });

  it("never overspends under parallel reservations", async () => {
    const period = newPeriod();
    const run = randomUUID();
    const tight = { p_cap_usd: 20, p_item_floor_usd: 0, p_item_limit: 10, p_item_cap_usd: 100 };
    await admin.rpc("budget_claim_item", { p_period: period, p_kind: "BLOG", p_run_id: run, p_item_limit: 10 });
    const results = await Promise.all(Array.from({ length: 12 }, () => reserve(period, run, 3, randomUUID(), "BLOG", tight)));
    const ok = results.filter((r) => !r.error).length;
    expect(ok).toBe(6); // 6 × $3 = $18; a 7th would pass $20
    expect(results.filter((r) => r.error).every((r) => r.error?.code === "BG002")).toBe(true);
    const status = (await admin.rpc("budget_status", { p_period: period, p_kind: "BLOG" })).data as Record<string, number>;
    expect(status.reservedUsd).toBe(18);
  });

  it("keeps the two kinds independent", async () => {
    const period = newPeriod();
    const tight = { p_cap_usd: 5, p_item_floor_usd: 0, p_item_limit: 10, p_item_cap_usd: 100 };
    expect((await reserve(period, null, 5, randomUUID(), "VIDEO", tight)).error).toBeNull();
    expect((await reserve(period, null, 1, randomUUID(), "VIDEO", tight)).error?.code).toBe("BG002");
    expect((await reserve(period, null, 5, randomUUID(), "BLOG", tight)).error).toBeNull();
  });

  it("records an actual above the reservation instead of hiding it", async () => {
    const period = newPeriod();
    const r = await reserve(period, null, 1, randomUUID(), "BLOG", { p_item_floor_usd: 0 });
    await admin.rpc("budget_settle", { p_id: r.data!, p_actual_usd: 1.4 });
    const row = await admin.from("budget_spend").select("actual_usd,note").eq("id", r.data!).single();
    expect(Number(row.data?.actual_usd)).toBe(1.4);
    expect(row.data?.note).toContain("above reservation");
  });

  it("is not callable by anonymous clients and the tables are not readable", async () => {
    const call = await anon.rpc("budget_status", { p_period: "x", p_kind: "VIDEO" });
    expect(call.error).not.toBeNull();
    const read = await anon.from("budget_spend").select("id").limit(1);
    expect(read.data ?? []).toHaveLength(0);
  });
});
