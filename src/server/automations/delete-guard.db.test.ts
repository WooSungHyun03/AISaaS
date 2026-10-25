import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Migration 0078: the database itself refuses to delete an automation (directly or through its business) while one of
 * its runs is QUEUED/RUNNING, so a run started between the app's "nothing in flight" check and the delete can no
 * longer be cascaded with its credit reservation (F-033). Deleting the whole account still works.
 * Needs `bash scripts/dev-db.sh`; skipped otherwise (RUN_DB_TESTS=1 to run).
 */
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

suite("no automation delete mid-run (database)", () => {
  const admin: Db = createClient<Database>(env?.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost", env?.SUPABASE_SERVICE_ROLE_KEY ?? "x", options);
  const userIds: string[] = [];

  async function newOwner() {
    const email = `del-${randomUUID().slice(0, 8)}@autobiz.local`;
    const created = await admin.auth.admin.createUser({ email, password: "Delete-test-1!", email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("user not created");
    userIds.push(created.data.user.id);
    const db = createClient<Database>(env!.NEXT_PUBLIC_SUPABASE_URL, env!.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
    const signedIn = await db.auth.signInWithPassword({ email, password: "Delete-test-1!" });
    if (signedIn.error) throw signedIn.error;
    const business = await admin.from("businesses").insert({ owner_id: created.data.user.id, name: "삭제 테스트" }).select("id").single();
    const template = await admin.from("automation_templates").select("id").eq("slug", "shorts").single();
    const automation = await admin.from("automations").insert({ user_id: created.data.user.id, business_id: business.data!.id, template_id: template.data!.id, name: "숏폼", status: "DRAFT", schedule: { frequency: "DAILY", timeOfDay: "18:00", timezone: "Asia/Seoul" } }).select("id").single();
    if (automation.error) throw automation.error;
    return { id: created.data.user.id, db, businessId: business.data!.id, automationId: automation.data.id };
  }

  async function addRun(automationId: string, status: "QUEUED" | "RUNNING" | "SUCCESS") {
    const run = await admin.from("automation_runs").insert({ automation_id: automationId, status, source: "MANUAL" }).select("id").single();
    if (run.error) throw run.error;
    return run.data.id;
  }

  const automationExists = async (id: string) => Boolean((await admin.from("automations").select("id").eq("id", id).maybeSingle()).data);

  afterAll(async () => {
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  it("refuses deleting an automation with a RUNNING or QUEUED run, for the owner and the service role", async () => {
    const owner = await newOwner();
    const runId = await addRun(owner.automationId, "RUNNING");

    const byOwner = await owner.db.from("automations").delete().eq("id", owner.automationId).select("id");
    expect(byOwner.error?.code).toBe("55006");
    const byAdmin = await admin.from("automations").delete().eq("id", owner.automationId);
    expect(byAdmin.error?.code).toBe("55006");
    expect(await automationExists(owner.automationId)).toBe(true);

    await admin.from("automation_runs").update({ status: "QUEUED" }).eq("id", runId);
    expect((await owner.db.from("automations").delete().eq("id", owner.automationId)).error?.code).toBe("55006");

    await admin.from("automation_runs").update({ status: "SUCCESS" }).eq("id", runId);
    const after = await owner.db.from("automations").delete().eq("id", owner.automationId).select("id").maybeSingle();
    expect(after.error).toBeNull();
    expect(after.data?.id).toBe(owner.automationId);
  });

  it("refuses deleting a business whose automation has a run in flight, and keeps every row", async () => {
    const owner = await newOwner();
    const runId = await addRun(owner.automationId, "RUNNING");

    const refused = await owner.db.from("businesses").delete().eq("id", owner.businessId).select("id");
    expect(refused.error?.code).toBe("55006");
    expect((await admin.from("businesses").select("id").eq("id", owner.businessId).maybeSingle()).data).not.toBeNull();
    expect((await admin.from("automation_runs").select("id").eq("id", runId).maybeSingle()).data).not.toBeNull();

    await addRun(owner.automationId, "SUCCESS");
    await admin.from("automation_runs").update({ status: "FAILED" }).eq("id", runId);
    const allowed = await owner.db.from("businesses").delete().eq("id", owner.businessId).select("id").maybeSingle();
    expect(allowed.error).toBeNull();
    expect(await automationExists(owner.automationId)).toBe(false);
  });

  it("still deletes the whole account while a run is in flight", async () => {
    const owner = await newOwner();
    await addRun(owner.automationId, "RUNNING");
    const { error } = await admin.auth.admin.deleteUser(owner.id);
    expect(error).toBeNull();
    expect(await automationExists(owner.automationId)).toBe(false);
  });
});
