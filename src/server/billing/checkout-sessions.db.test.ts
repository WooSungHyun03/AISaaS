import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

function localEnv(): Record<string, string> | null {
  try {
    const text = readFileSync(path.join(process.cwd(), ".env.local.supabase"), "utf8");
    return Object.fromEntries(text.split(/\r?\n/).map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())).filter((match): match is RegExpExecArray => Boolean(match)).map((match) => [match[1], match[2].replace(/^['"]|['"]$/g, "")]));
  } catch {
    return null;
  }
}

const env = process.env.RUN_DB_TESTS ? localEnv() : null;
const suite = env ? describe : describe.skip;

/**
 * claimCheckoutSession takes over an abandoned PROCESSING claim with a compare-and-set on `updated_at`. That only
 * works if the timestamp string PostgREST returns compares equal when sent back, and if the updated_at trigger moves
 * it on every claim so a second taker of the same stale value matches nothing.
 */
suite("checkout session stale-claim compare-and-set against the real database", () => {
  const url = env?.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  let admin: SupabaseClient<Database>;
  let userId = "";

  beforeAll(async () => {
    admin = createClient<Database>(url, env!.SUPABASE_SERVICE_ROLE_KEY, options);
    const created = await admin.auth.admin.createUser({ email: `checkout-cas-${crypto.randomUUID()}@autobiz.local`, password: "Checkout-cas-1!", email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("user not created");
    userId = created.data.user.id;
  });

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("lets exactly one taker reclaim a PROCESSING session by its updated_at", async () => {
    const inserted = await admin.from("billing_checkout_sessions").insert({
      user_id: userId,
      product_id: "BLOG_5",
      provider: "mock",
      status: "PROCESSING",
      customer_key: `cus_${crypto.randomUUID()}`,
      order_id: `order_${crypto.randomUUID()}`,
    }).select("id,updated_at").single();
    if (inserted.error) throw inserted.error;
    const { id, updated_at: seen } = inserted.data;

    const take = () => admin.from("billing_checkout_sessions")
      .update({ status: "PROCESSING", error_code: null, error_message: null })
      .eq("id", id).eq("user_id", userId).eq("status", "PROCESSING").eq("updated_at", seen)
      .select("*").maybeSingle();

    const first = await take();
    expect(first.error).toBeNull();
    expect(first.data?.id).toBe(id);
    expect(first.data?.updated_at).not.toBe(seen);

    const second = await take();
    expect(second.error).toBeNull();
    expect(second.data).toBeNull();
  });
});
