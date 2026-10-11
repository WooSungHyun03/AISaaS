import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/** Real database + RLS. Needs `bash scripts/dev-db.sh`; skipped otherwise (RUN_DB_TESTS=1 to run). */
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

suite("abuse row caps and RPC exposure (migration 0071)", () => {
  const url = env?.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  let admin: Db;
  let userId = "";
  let db: Db;

  beforeAll(async () => {
    admin = createClient<Database>(url, env!.SUPABASE_SERVICE_ROLE_KEY, options);
    const email = `caps-${Date.now()}@autobiz.local`;
    const created = await admin.auth.admin.createUser({ email, password: "Caps-test-1!", email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("user not created");
    userId = created.data.user.id;
    db = createClient<Database>(url, env!.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
    const signedIn = await db.auth.signInWithPassword({ email, password: "Caps-test-1!" });
    if (signedIn.error) throw signedIn.error;
  });

  afterAll(async () => {
    await admin.auth.admin.deleteUser(userId);
  });

  it("stops a customer from inserting more than 20 businesses directly through the API", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ owner_id: userId, name: `사업체 ${i}` }));
    const first = await db.from("businesses").insert(rows);
    expect(first.error).toBeNull();
    const extra = await db.from("businesses").insert({ owner_id: userId, name: "초과" });
    expect(extra.error?.code).toBe("54000");
    const { count } = await admin.from("businesses").select("id", { count: "exact", head: true }).eq("owner_id", userId);
    expect(count).toBe(20);
  });

  it("does not let parallel inserts race past the cap", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => db.from("businesses").insert({ owner_id: userId, name: "병렬" })));
    expect(results.every((r) => r.error?.code === "54000")).toBe(true);
  });

  it("does not expose trigger-only functions as RPCs", async () => {
    const rpc = db.rpc as unknown as (name: string, args?: object) => Promise<{ error: { code?: string } | null }>;
    for (const name of ["handle_new_user", "handle_new_profile_subscription", "enforce_row_cap"]) {
      const result = await rpc.call(db, name);
      expect(result.error, name).not.toBeNull();
    }
  });
});
