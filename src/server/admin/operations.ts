import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getBillingProviderByName } from "@/server/billing";
import { getProductConfig, isProductId } from "@/server/billing/products";
import type { AccountStatus, CreditKind, Database, RefundRequestStatus } from "@/types/database.types";

type AdminClient = SupabaseClient<Database>;
export const ADMIN_PAGE_SIZE = 25;

function pageRange(page = 1) {
  const safe = Math.max(1, Math.trunc(page));
  return { page: safe, from: (safe - 1) * ADMIN_PAGE_SIZE, to: safe * ADMIN_PAGE_SIZE - 1 };
}

function productName(productId: string) {
  return isProductId(productId) ? getProductConfig(productId).name : productId;
}

async function emailMap(admin: AdminClient, userIds: string[]) {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map<string, string>();
  const { data, error } = await admin.from("profiles").select("id,email").in("id", unique);
  if (error) throw error;
  return new Map((data ?? []).map((profile) => [profile.id, profile.email]));
}

export async function listAdminUsers(admin: AdminClient, options: { search?: string; page?: number } = {}) {
  const { page, from, to } = pageRange(options.page);
  let query = admin.from("profiles")
    .select("id,email,display_name,account_status,suspended_at,created_at", { count: "exact" })
    .order("created_at", { ascending: false }).range(from, to);
  const search = options.search?.trim();
  if (search) query = query.ilike("email", `%${search.slice(0, 120)}%`);
  const { data, error, count } = await query;
  if (error) throw error;
  const rows = data ?? [];
  const ids = rows.map((row) => row.id);
  const [grantsResult, ordersResult] = await Promise.all([
    ids.length ? admin.from("credit_grants").select("user_id,kind,remaining,expires_at,order_id").in("user_id", ids).gt("expires_at", new Date().toISOString()) : Promise.resolve({ data: [], error: null }),
    ids.length ? admin.from("billing_orders").select("user_id,product_id,status").in("user_id", ids).eq("status", "PAID") : Promise.resolve({ data: [], error: null }),
  ]);
  if (grantsResult.error) throw grantsResult.error;
  if (ordersResult.error) throw ordersResult.error;
  return {
    page,
    total: count ?? rows.length,
    items: rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      accountStatus: row.account_status,
      suspendedAt: row.suspended_at,
      createdAt: row.created_at,
      balances: (grantsResult.data ?? []).filter((grant) => grant.user_id === row.id).reduce((value, grant) => {
        value[grant.kind] += grant.remaining;
        return value;
      }, { BLOG: 0, SHORTS: 0 } as Record<CreditKind, number>),
      products: (ordersResult.data ?? []).filter((order) => order.user_id === row.id).map((order) => productName(order.product_id)),
    })),
  };
}

export async function getAdminUserDetail(admin: AdminClient, userId: string) {
  const [profileResult, ordersResult, grantsResult, ledgerResult, runsResult] = await Promise.all([
    admin.from("profiles").select("id,email,display_name,account_status,suspended_at,suspension_reason,created_at").eq("id", userId).maybeSingle(),
    admin.from("billing_orders").select("id,product_id,kind,credit_amount,price_krw,status,provider,paid_at,refunded_at,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    admin.from("credit_grants").select("id,kind,amount,remaining,expires_at,order_id").eq("user_id", userId).order("expires_at"),
    admin.from("credit_ledger").select("id,kind,event_type,delta,reference_id,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    admin.from("automations").select("id,name").eq("user_id", userId),
  ]);
  for (const result of [profileResult, ordersResult, grantsResult, ledgerResult, runsResult]) if (result.error) throw result.error;
  if (!profileResult.data) return null;
  const automationIds = (runsResult.data ?? []).map((automation) => automation.id);
  const runHistory = automationIds.length
    ? await admin.from("automation_runs").select("id,automation_id,status,started_at,completed_at,error_message,created_at").in("automation_id", automationIds).order("created_at", { ascending: false }).limit(50)
    : { data: [], error: null };
  if (runHistory.error) throw runHistory.error;
  const names = new Map((runsResult.data ?? []).map((automation) => [automation.id, automation.name]));
  return {
    profile: profileResult.data,
    orders: (ordersResult.data ?? []).map((row) => ({ ...row, productName: productName(row.product_id) })),
    grants: grantsResult.data ?? [],
    ledger: ledgerResult.data ?? [],
    runs: (runHistory.data ?? []).map((row) => ({ ...row, automationName: names.get(row.automation_id) ?? "삭제된 자동화" })),
  };
}

export async function setUserAccountStatus(admin: AdminClient, params: { userId: string; status: AccountStatus; reason?: string }) {
  const reason = params.reason?.trim() ?? "";
  if (params.status === "SUSPENDED" && reason.length < 3) throw new Error("정지 사유를 3자 이상 입력해주세요.");
  const banDuration = params.status === "SUSPENDED" ? "876000h" : "none";
  const auth = await admin.auth.admin.updateUserById(params.userId, { ban_duration: banDuration });
  if (auth.error) throw auth.error;
  const update = params.status === "SUSPENDED"
    ? { account_status: "SUSPENDED" as const, suspended_at: new Date().toISOString(), suspension_reason: reason.slice(0, 500) }
    : { account_status: "ACTIVE" as const, suspended_at: null, suspension_reason: null };
  const { error } = await admin.from("profiles").update(update).eq("id", params.userId);
  if (error) {
    await admin.auth.admin.updateUserById(params.userId, { ban_duration: params.status === "SUSPENDED" ? "none" : "876000h" });
    throw error;
  }
}

export async function listAdminPayments(admin: AdminClient, options: { search?: string; status?: string; page?: number } = {}) {
  const { page, from, to } = pageRange(options.page);
  let userIds: string[] | null = null;
  if (options.search?.trim()) {
    const { data, error } = await admin.from("profiles").select("id").ilike("email", `%${options.search.trim().slice(0, 120)}%`).limit(500);
    if (error) throw error;
    userIds = (data ?? []).map((row) => row.id);
    if (userIds.length === 0) return { page, total: 0, items: [] };
  }
  let query = admin.from("billing_orders").select("id,user_id,product_id,kind,credit_amount,price_krw,status,provider,paid_at,refunded_at,created_at", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
  if (options.status) query = query.eq("status", options.status as Database["public"]["Tables"]["billing_orders"]["Row"]["status"]);
  if (userIds) query = query.in("user_id", userIds);
  const { data, error, count } = await query;
  if (error) throw error;
  const emails = await emailMap(admin, (data ?? []).map((row) => row.user_id));
  return { page, total: count ?? 0, items: (data ?? []).map((row) => ({ ...row, userEmail: emails.get(row.user_id) ?? "(알 수 없음)", productName: productName(row.product_id) })) };
}

export async function listAdminRefunds(admin: AdminClient, options: { search?: string; status?: RefundRequestStatus; page?: number } = {}) {
  const { page, from, to } = pageRange(options.page);
  let userIds: string[] | null = null;
  if (options.search?.trim()) {
    const { data, error } = await admin.from("profiles").select("id").ilike("email", `%${options.search.trim().slice(0, 120)}%`).limit(500);
    if (error) throw error;
    userIds = (data ?? []).map((row) => row.id);
    if (userIds.length === 0) return { page, total: 0, items: [] };
  }
  let query = admin.from("refund_requests").select("id,user_id,order_id,reason,status,used_credits_snapshot,unused_credits_snapshot,expected_refund_krw,refund_attempt_count,refund_last_error,created_at,updated_at", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
  if (options.status) query = query.eq("status", options.status);
  if (userIds) query = query.in("user_id", userIds);
  const { data, error, count } = await query;
  if (error) throw error;
  const rows = data ?? [];
  const [emails, orders] = await Promise.all([
    emailMap(admin, rows.map((row) => row.user_id)),
    rows.length ? admin.from("billing_orders").select("id,product_id,provider,price_krw").in("id", rows.map((row) => row.order_id)) : Promise.resolve({ data: [], error: null }),
  ]);
  if (orders.error) throw orders.error;
  const byId = new Map((orders.data ?? []).map((order) => [order.id, order]));
  return { page, total: count ?? 0, items: rows.map((row) => ({ ...row, userEmail: emails.get(row.user_id) ?? "(알 수 없음)", productName: productName(byId.get(row.order_id)?.product_id ?? "이전 주문"), provider: byId.get(row.order_id)?.provider ?? "legacy" })) };
}

export async function getAdminRefundDetail(admin: AdminClient, requestId: string) {
  const { data: request, error } = await admin.from("refund_requests").select("*").eq("id", requestId).maybeSingle();
  if (error) throw error;
  if (!request) return null;
  const [profile, order, grant] = await Promise.all([
    admin.from("profiles").select("email").eq("id", request.user_id).maybeSingle(),
    admin.from("billing_orders").select("*").eq("id", request.order_id).single(),
    admin.from("credit_grants").select("kind,amount,remaining,expires_at").eq("order_id", request.order_id).maybeSingle(),
  ]);
  if (profile.error) throw profile.error;
  if (order.error) throw order.error;
  if (grant.error) throw grant.error;
  return { request, userEmail: profile.data?.email ?? "(알 수 없음)", order: { ...order.data, productName: productName(order.data.product_id) }, grant: grant.data };
}

export async function reviewRefund(admin: AdminClient, params: { requestId: string; adminId: string; decision: "REVIEWING" | "APPROVED" | "REJECTED"; note?: string }) {
  const { data, error } = await admin.rpc("admin_review_refund_request", { p_request_id: params.requestId, p_admin_id: params.adminId, p_decision: params.decision, p_note: params.note ?? null });
  if (error) throw error;
  return data;
}

export async function executeRefund(admin: AdminClient, requestId: string) {
  const detail = await getAdminRefundDetail(admin, requestId);
  if (!detail) throw new Error("환불 요청을 찾을 수 없습니다.");
  if (detail.request.status === "REFUNDED") return { alreadyCompleted: true, refundedAmount: detail.request.expected_refund_krw };
  if (detail.request.status !== "APPROVED" || !detail.request.refund_idempotency_key) throw new Error("승인된 환불 요청만 실행할 수 있습니다.");
  if (detail.order.provider === "legacy") throw new Error("이전 구독 주문은 결제사에서 수동 환불해야 합니다.");
  if (!detail.order.checkout_session_id) throw new Error("결제 세션을 찾을 수 없습니다.");
  const { data: session, error: sessionError } = await admin.from("billing_checkout_sessions").select("provider_payment_key").eq("id", detail.order.checkout_session_id).single();
  if (sessionError) throw sessionError;
  if (!session.provider_payment_key) throw new Error("결제 승인 키를 찾을 수 없습니다.");

  try {
    const provider = getBillingProviderByName(detail.order.provider);
    const canceled = await provider.refundPayment({
      paymentKey: session.provider_payment_key,
      reason: `Easy Marketing 환불 요청 ${requestId}`,
      amount: detail.request.expected_refund_krw,
      originalAmount: detail.order.price_krw,
      idempotencyKey: detail.request.refund_idempotency_key,
    });
    const { data: refundedCredits, error } = await admin.rpc("admin_finalize_refund_request", {
      p_request_id: requestId,
      p_provider_refund_id: canceled.providerRefundId,
      p_refunded_amount: canceled.refundedAmount,
    });
    if (error) throw error;
    return { alreadyCompleted: false, refundedAmount: canceled.refundedAmount, refundedCredits };
  } catch (error) {
    await admin.rpc("admin_record_refund_failure", { p_request_id: requestId, p_error: error instanceof Error ? error.message : "결제 취소에 실패했습니다." });
    throw error;
  }
}

export async function getAdminUsage(admin: AdminClient, options: { from?: string; to?: string; search?: string; page?: number } = {}) {
  const { page, from: rangeFrom, to: rangeTo } = pageRange(options.page);
  const from = options.from ? new Date(`${options.from}T00:00:00+09:00`).toISOString() : new Date(Date.now() - 30 * 86_400_000).toISOString();
  const to = options.to ? new Date(`${options.to}T23:59:59.999+09:00`).toISOString() : new Date().toISOString();
  let userIds: string[] | null = null;
  let filteredAutomationIds: string[] | null = null;
  if (options.search?.trim()) {
    const users = await admin.from("profiles").select("id").ilike("email", `%${options.search.trim().slice(0, 120)}%`).limit(500);
    if (users.error) throw users.error;
    userIds = (users.data ?? []).map((row) => row.id);
    const automations = userIds.length ? await admin.from("automations").select("id").in("user_id", userIds) : { data: [], error: null };
    if (automations.error) throw automations.error;
    filteredAutomationIds = (automations.data ?? []).map((row) => row.id);
  }
  let pageQuery = admin.from("automation_runs").select("id,automation_id,status,source,ai_generation_count,external_api_call_count,started_at,completed_at,created_at", { count: "exact" }).gte("created_at", from).lte("created_at", to).order("created_at", { ascending: false }).range(rangeFrom, rangeTo);
  if (filteredAutomationIds) {
    if (filteredAutomationIds.length === 0) return { page, total: 0, from, to, summary: { runs: 0, successfulRuns: 0, aiGenerations: 0, externalApiCalls: 0, blogRuns: 0, shortsRuns: 0 }, items: [] };
    pageQuery = pageQuery.in("automation_id", filteredAutomationIds);
  }
  const [summaryResult, pageResult] = await Promise.all([
    admin.rpc("get_admin_usage_summary", { p_from: from, p_to: to, p_user_ids: userIds }),
    pageQuery,
  ]);
  if (summaryResult.error) throw summaryResult.error;
  if (pageResult.error) throw pageResult.error;
  const ids = [...new Set((pageResult.data ?? []).map((row) => row.automation_id))];
  const automations = ids.length ? await admin.from("automations").select("id,user_id,name,template_id").in("id", ids) : { data: [], error: null };
  if (automations.error) throw automations.error;
  const templateIds = [...new Set((automations.data ?? []).map((row) => row.template_id))];
  const templates = templateIds.length ? await admin.from("automation_templates").select("id,slug").in("id", templateIds) : { data: [], error: null };
  if (templates.error) throw templates.error;
  const slugById = new Map((templates.data ?? []).map((row) => [row.id, row.slug]));
  const automationById = new Map((automations.data ?? []).map((row) => [row.id, row]));
  const emails = await emailMap(admin, (automations.data ?? []).map((row) => row.user_id));
  const summary = summaryResult.data?.[0];
  return {
    page, total: pageResult.count ?? 0, from, to,
    summary: {
      runs: Number(summary?.runs ?? 0),
      successfulRuns: Number(summary?.successful_runs ?? 0),
      aiGenerations: Number(summary?.ai_generations ?? 0),
      externalApiCalls: Number(summary?.external_api_calls ?? 0),
      blogRuns: Number(summary?.blog_runs ?? 0),
      shortsRuns: Number(summary?.shorts_runs ?? 0),
    },
    items: (pageResult.data ?? []).map((row) => {
      const automation = automationById.get(row.automation_id);
      return { ...row, automationName: automation?.name ?? "삭제된 자동화", feature: slugById.get(automation?.template_id ?? "") ?? "unknown", userEmail: automation ? emails.get(automation.user_id) ?? "(알 수 없음)" : "(알 수 없음)" };
    }),
  };
}

export async function listAdminErrors(admin: AdminClient, options: { search?: string; page?: number } = {}) {
  const { page, from, to } = pageRange(options.page);
  let allowedAutomationIds: string[] | null = null;
  if (options.search?.trim()) {
    const users = await admin.from("profiles").select("id").ilike("email", `%${options.search.trim().slice(0, 120)}%`).limit(500);
    if (users.error) throw users.error;
    const automations = (users.data?.length ?? 0) > 0 ? await admin.from("automations").select("id").in("user_id", users.data!.map((row) => row.id)) : { data: [], error: null };
    if (automations.error) throw automations.error;
    allowedAutomationIds = (automations.data ?? []).map((row) => row.id);
    if (allowedAutomationIds.length === 0) return { page, total: 0, items: [] };
  }
  let query = admin.from("automation_runs").select("id,automation_id,source,error_message,started_at,completed_at,created_at", { count: "exact" }).eq("status", "FAILED").order("created_at", { ascending: false }).range(from, to);
  if (allowedAutomationIds) query = query.in("automation_id", allowedAutomationIds);
  const { data, error, count } = await query;
  if (error) throw error;
  const automationIds = [...new Set((data ?? []).map((row) => row.automation_id))];
  const automations = automationIds.length ? await admin.from("automations").select("id,user_id,name").in("id", automationIds) : { data: [], error: null };
  if (automations.error) throw automations.error;
  const byId = new Map((automations.data ?? []).map((row) => [row.id, row]));
  const emails = await emailMap(admin, (automations.data ?? []).map((row) => row.user_id));
  return { page, total: count ?? 0, items: (data ?? []).map((row) => { const automation = byId.get(row.automation_id); return { ...row, automationName: automation?.name ?? "삭제된 자동화", userEmail: automation ? emails.get(automation.user_id) ?? "(알 수 없음)" : "(알 수 없음)" }; }) };
}
