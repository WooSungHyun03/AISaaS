import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { setUserAccountStatus } from "./operations";

function localEnv(): Record<string, string> | null {
  try {
    const text = readFileSync(path.join(process.cwd(), ".env.local.supabase"), "utf8");
    return Object.fromEntries(text.split(/\r?\n/).map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())).filter((match): match is RegExpExecArray => Boolean(match)).map((match) => [match[1], match[2].replace(/^['"]|['"]$/g, "")]));
  } catch { return null; }
}

const env = process.env.RUN_DB_TESTS ? localEnv() : null;
const suite = env ? describe : describe.skip;
type Db = SupabaseClient<Database>;

suite("admin refund operations against the real database", () => {
  const url = env?.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const password = "Admin-operations-1!";
  let service: Db;
  let customer: Db;
  let userId = "";
  let adminId = "";
  let orderId = "";
  let requestId = "";

  beforeAll(async () => {
    service = createClient<Database>(url, env!.SUPABASE_SERVICE_ROLE_KEY, options);
    const admins = await service.auth.admin.listUsers({ page: 1, perPage: 100 });
    if (admins.error) throw admins.error;
    const seeded = admins.data.users.find((user) => user.email === "admin@autobiz.local");
    if (!seeded) throw new Error("local seeded admin not found");
    adminId = seeded.id;

    const email = `admin-operations-${crypto.randomUUID()}@autobiz.local`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("user not created");
    userId = created.data.user.id;
    const profile = await service.from("profiles").upsert({ id: userId, email, display_name: "Refund fixture" });
    if (profile.error) throw profile.error;
    customer = createClient<Database>(url, env!.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
    const signedIn = await customer.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw signedIn.error;

    const order = await service.from("billing_orders").insert({ user_id: userId, product_id: "BLOG_5", kind: "BLOG", credit_amount: 5, price_krw: 10_000, validity_days: 30, status: "PAID", provider: "mock", provider_order_id: `refund-${crypto.randomUUID()}`, paid_at: new Date().toISOString() }).select("id").single();
    if (order.error) throw order.error;
    orderId = order.data.id;
    const grant = await service.rpc("grant_credit", { p_user_id: userId, p_kind: "BLOG", p_amount: 5, p_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), p_order_id: orderId, p_reference_id: orderId });
    if (grant.error) throw grant.error;
    const request = await service.from("refund_requests").insert({ user_id: userId, order_id: orderId, reason: "관리자 환불 전체 흐름 검증 요청", credit_amount_snapshot: 5, used_credits_snapshot: 0, unused_credits_snapshot: 5, expected_refund_krw: 10_000, policy_snapshot: { test: true } }).select("id").single();
    if (request.error) throw request.error;
    requestId = request.data.id;
  });

  afterAll(async () => { if (userId) await service.auth.admin.deleteUser(userId); });

  it("denies privileged refund RPCs to a signed-in customer", async () => {
    expect((await customer.rpc("admin_review_refund_request", { p_request_id: requestId, p_admin_id: adminId, p_decision: "APPROVED", p_note: null })).error).not.toBeNull();
    expect((await customer.rpc("admin_finalize_refund_request", { p_request_id: requestId, p_provider_refund_id: "forbidden", p_refunded_amount: 10_000 })).error).not.toBeNull();
  });

  it("locks credits on approval and atomically records the completed refund", async () => {
    const review = await service.rpc("admin_review_refund_request", { p_request_id: requestId, p_admin_id: adminId, p_decision: "REVIEWING", p_note: "검토 시작" });
    if (review.error) throw review.error;
    const approval = await service.rpc("admin_review_refund_request", { p_request_id: requestId, p_admin_id: adminId, p_decision: "APPROVED", p_note: "환불 승인" });
    if (approval.error) throw approval.error;

    const blocked = await service.rpc("reserve_credit", { p_user_id: userId, p_kind: "BLOG", p_amount: 1, p_reference_id: `locked-${requestId}` });
    expect(blocked.error).not.toBeNull();

    const final = await service.rpc("admin_finalize_refund_request", { p_request_id: requestId, p_provider_refund_id: "mock-cancel-1", p_refunded_amount: 10_000 });
    if (final.error) throw final.error;
    expect(final.data).toBe(5);

    const [request, order, grant, ledger] = await Promise.all([
      service.from("refund_requests").select("status,provider_refund_id,refund_attempt_count").eq("id", requestId).single(),
      service.from("billing_orders").select("status,refunded_at").eq("id", orderId).single(),
      service.from("credit_grants").select("remaining").eq("order_id", orderId).single(),
      service.from("credit_ledger").select("event_type,delta,reference_id").eq("reference_id", requestId).eq("event_type", "REFUND").single(),
    ]);
    expect(request.data).toMatchObject({ status: "REFUNDED", provider_refund_id: "mock-cancel-1", refund_attempt_count: 1 });
    expect(order.data?.status).toBe("REFUNDED");
    expect(order.data?.refunded_at).toBeTruthy();
    expect(grant.data?.remaining).toBe(0);
    expect(ledger.data).toMatchObject({ event_type: "REFUND", delta: -5, reference_id: requestId });

    const retry = await service.rpc("admin_finalize_refund_request", { p_request_id: requestId, p_provider_refund_id: "mock-cancel-1", p_refunded_amount: 10_000 });
    expect(retry.error).toBeNull();
    expect(retry.data).toBe(5);
  });

  it("refuses approval while a generation still holds a reservation on the order (F-010)", async () => {
    const email = `refund-race-${crypto.randomUUID()}@autobiz.local`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("user not created");
    const raceUserId = created.data.user.id;
    try {
      const profile = await service.from("profiles").upsert({ id: raceUserId, email });
      if (profile.error) throw profile.error;
      const order = await service.from("billing_orders").insert({ user_id: raceUserId, product_id: "BLOG_5", kind: "BLOG", credit_amount: 5, price_krw: 10_000, validity_days: 30, status: "PAID", provider: "mock", provider_order_id: `refund-race-${crypto.randomUUID()}`, paid_at: new Date().toISOString() }).select("id").single();
      if (order.error) throw order.error;
      const grant = await service.rpc("grant_credit", { p_user_id: raceUserId, p_kind: "BLOG", p_amount: 5, p_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), p_order_id: order.data.id, p_reference_id: order.data.id });
      if (grant.error) throw grant.error;
      const reservation = await service.rpc("reserve_credit", { p_user_id: raceUserId, p_kind: "BLOG", p_amount: 1, p_reference_id: "refund-race-run" });
      if (reservation.error) throw reservation.error;
      const request = await service.from("refund_requests").insert({ user_id: raceUserId, order_id: order.data.id, reason: "진행 중인 생성이 있는 환불 요청 검증", credit_amount_snapshot: 5, used_credits_snapshot: 1, unused_credits_snapshot: 4, expected_refund_krw: 8_000 }).select("id").single();
      if (request.error) throw request.error;

      const blocked = await service.rpc("admin_review_refund_request", { p_request_id: request.data.id, p_admin_id: adminId, p_decision: "APPROVED", p_note: "race" });
      expect(blocked.error?.code).toBe("55000");
      expect(blocked.error?.message).toContain("still running");

      const settled = await service.rpc("settle_credit", { p_reservation_id: reservation.data, p_reference_id: "refund-race-run" });
      if (settled.error) throw settled.error;
      const approved = await service.rpc("admin_review_refund_request", { p_request_id: request.data.id, p_admin_id: adminId, p_decision: "APPROVED", p_note: "race" });
      expect(approved.error).toBeNull();
      expect(approved.data).toBe("APPROVED");
    } finally {
      await service.auth.admin.deleteUser(raceUserId);
    }
  });

  it("prevents a customer from changing account_status", async () => {
    const result = await customer.from("profiles").update({ account_status: "SUSPENDED", suspended_at: new Date().toISOString(), suspension_reason: "self suspend" }).eq("id", userId);
    expect(result.error).not.toBeNull();
  });

  it("blocks a suspended user from a new login and restores access on activation", async () => {
    await setUserAccountStatus(service, { userId, status: "SUSPENDED", reason: "통합 테스트 계정 정지" });
    const suspendedProfile = await service.from("profiles").select("account_status,suspended_at").eq("id", userId).single();
    expect(suspendedProfile.data?.account_status).toBe("SUSPENDED");
    expect(suspendedProfile.data?.suspended_at).toBeTruthy();

    const freshClient = createClient<Database>(url, env!.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
    const blocked = await freshClient.auth.signInWithPassword({ email: (await service.auth.admin.getUserById(userId)).data.user?.email ?? "", password });
    expect(blocked.error).not.toBeNull();

    await setUserAccountStatus(service, { userId, status: "ACTIVE" });
    const restored = await freshClient.auth.signInWithPassword({ email: (await service.auth.admin.getUserById(userId)).data.user?.email ?? "", password });
    expect(restored.error).toBeNull();
  });
});
