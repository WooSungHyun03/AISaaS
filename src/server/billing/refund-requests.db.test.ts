import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { submitRefundRequest } from "./refund-requests";

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
type Db = SupabaseClient<Database>;

suite("refund requests against the real database", () => {
  const url = env?.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const password = "Refund-test-1!";
  const users: Array<{ id: string; db: Db }> = [];
  let admin: Db;
  let orderId = "";

  beforeAll(async () => {
    admin = createClient<Database>(url, env!.SUPABASE_SERVICE_ROLE_KEY, options);
    for (const label of ["owner", "other"]) {
      const email = `refund-${label}-${Date.now()}-${crypto.randomUUID()}@autobiz.local`;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw created.error ?? new Error("user not created");
      const db = createClient<Database>(url, env!.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
      const signedIn = await db.auth.signInWithPassword({ email, password });
      if (signedIn.error) throw signedIn.error;
      users.push({ id: created.data.user.id, db });
    }

    const ownerId = users[0].id;
    const order = await admin.from("billing_orders").insert({
      user_id: ownerId,
      product_id: "BLOG_5",
      kind: "BLOG",
      credit_amount: 5,
      price_krw: 9_900,
      validity_days: 30,
      status: "PAID",
      provider: "mock",
      provider_order_id: `refund-test-${crypto.randomUUID()}`,
      paid_at: new Date().toISOString(),
    }).select("id").single();
    if (order.error) throw order.error;
    orderId = order.data.id;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString();
    const grant = await admin.rpc("grant_credit", { p_user_id: ownerId, p_kind: "BLOG", p_amount: 5, p_expires_at: expiresAt, p_order_id: orderId, p_reference_id: "refund-request-test" });
    if (grant.error) throw grant.error;
    for (let index = 0; index < 2; index++) {
      const reservation = await admin.rpc("reserve_credit", { p_user_id: ownerId, p_kind: "BLOG", p_amount: 1, p_reference_id: `refund-used-${orderId}-${index}` });
      if (reservation.error) throw reservation.error;
      const settled = await admin.rpc("settle_credit", { p_reservation_id: reservation.data, p_reference_id: `refund-used-${orderId}-${index}` });
      if (settled.error) throw settled.error;
    }
  });

  afterAll(async () => {
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
  });

  it("calculates the snapshot on the server and blocks duplicate or foreign requests", async () => {
    const [owner, other] = users;
    const submitted = await submitRefundRequest(owner.id, { orderId, reason: "남은 이용권을 사용하지 않아 테스트 환불을 요청합니다." }, admin);
    expect(submitted.ok).toBe(true);

    const stored = await admin.from("refund_requests").select("status,used_credits_snapshot,unused_credits_snapshot,expected_refund_krw").eq("order_id", orderId).single();
    expect(stored.error).toBeNull();
    expect(stored.data).toMatchObject({ status: "REQUESTED", used_credits_snapshot: 2, unused_credits_snapshot: 3, expected_refund_krw: 5_940 });
    expect((await submitRefundRequest(owner.id, { orderId, reason: "같은 주문을 다시 요청하려고 합니다." }, admin)).ok).toBe(false);
    expect((await submitRefundRequest(other.id, { orderId, reason: "다른 사람 주문을 요청하려고 합니다." }, admin)).ok).toBe(false);

    expect((await owner.db.from("refund_requests").select("id").eq("order_id", orderId)).data).toHaveLength(1);
    expect((await other.db.from("refund_requests").select("id").eq("order_id", orderId)).data).toHaveLength(0);
    expect((await owner.db.from("refund_requests").update({ status: "REFUNDED" }).eq("order_id", orderId)).error).not.toBeNull();
  });
});

