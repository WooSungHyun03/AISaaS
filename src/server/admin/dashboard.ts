import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getProductConfig, isProductId } from "@/server/billing/products";
import type { Database } from "@/types/database.types";
import { INQUIRY_CATEGORY_LABEL, INQUIRY_STATUS_LABEL } from "@/types/inquiries";
import { REFUND_REQUEST_STATUS_LABEL } from "@/types/refunds";

type AdminClient = SupabaseClient<Database>;

function productName(id: string) {
  return isProductId(id) ? getProductConfig(id).name : id;
}

export interface AdminDashboardData {
  counts: {
    totalUsers: number;
    activeUsers: number;
    paidUsers: number;
    blogGenerations: number;
    shortsGenerations: number;
  };
  recentPayments: Array<{ id: string; userEmail: string; productName: string; amountKrw: number; status: string; createdAt: string }>;
  recentErrors: Array<{ id: string; userEmail: string; automationName: string; message: string; createdAt: string }>;
  recentRefunds: Array<{ id: string; userEmail: string; productName: string; expectedRefundKrw: number; status: string; createdAt: string }>;
  recentInquiries: Array<{ id: string; userEmail: string; subject: string; category: string; status: string; createdAt: string }>;
  recentAudit: Array<{ id: string; actorEmail: string; action: string; targetType: string; createdAt: string }>;
}

export async function getAdminDashboardData(admin: AdminClient): Promise<AdminDashboardData> {
  const activeSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString();
  const [countsResult, paymentsResult, errorsResult, refundsResult, inquiriesResult, auditResult] = await Promise.all([
    admin.rpc("get_admin_dashboard_counts", { p_active_since: activeSince }),
    admin.from("billing_orders").select("id,user_id,product_id,price_krw,status,paid_at,created_at").order("created_at", { ascending: false }).limit(6),
    admin.from("automation_runs").select("id,automation_id,error_message,started_at,completed_at").eq("status", "FAILED").order("started_at", { ascending: false }).limit(6),
    admin.from("refund_requests").select("id,user_id,order_id,expected_refund_krw,status,created_at").order("created_at", { ascending: false }).limit(6),
    admin.from("inquiries").select("id,user_id,category,subject,status,created_at").order("created_at", { ascending: false }).limit(6),
    admin.from("admin_audit_log").select("id,actor_email,action,target_type,created_at").order("created_at", { ascending: false }).limit(6),
  ]);

  for (const result of [countsResult, paymentsResult, errorsResult, refundsResult, inquiriesResult, auditResult]) {
    if (result.error) throw result.error;
  }

  const automationIds = [...new Set((errorsResult.data ?? []).map((row) => row.automation_id))];
  const refundOrderIds = [...new Set((refundsResult.data ?? []).map((row) => row.order_id))];
  const userIds = new Set<string>([
    ...(paymentsResult.data ?? []).map((row) => row.user_id),
    ...(refundsResult.data ?? []).map((row) => row.user_id),
    ...(inquiriesResult.data ?? []).map((row) => row.user_id),
  ]);

  const [automationsResult, refundOrdersResult] = await Promise.all([
    automationIds.length > 0
      ? admin.from("automations").select("id,user_id,name").in("id", automationIds)
      : Promise.resolve({ data: [], error: null }),
    refundOrderIds.length > 0
      ? admin.from("billing_orders").select("id,product_id").in("id", refundOrderIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (automationsResult.error) throw automationsResult.error;
  if (refundOrdersResult.error) throw refundOrdersResult.error;
  for (const automation of automationsResult.data ?? []) userIds.add(automation.user_id);

  const profilesResult = userIds.size > 0
    ? await admin.from("profiles").select("id,email").in("id", [...userIds])
    : { data: [], error: null };
  if (profilesResult.error) throw profilesResult.error;

  const emails = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.email]));
  const automations = new Map((automationsResult.data ?? []).map((automation) => [automation.id, automation]));
  const refundOrders = new Map((refundOrdersResult.data ?? []).map((order) => [order.id, order]));
  const emailFor = (id: string) => emails.get(id) ?? "알 수 없는 사용자";
  const rawCounts = countsResult.data?.[0];

  return {
    counts: {
      totalUsers: Number(rawCounts?.total_users ?? 0),
      activeUsers: Number(rawCounts?.active_users ?? 0),
      paidUsers: Number(rawCounts?.paid_users ?? 0),
      blogGenerations: Number(rawCounts?.blog_generations ?? 0),
      shortsGenerations: Number(rawCounts?.shorts_generations ?? 0),
    },
    recentPayments: (paymentsResult.data ?? []).map((row) => ({
      id: row.id,
      userEmail: emailFor(row.user_id),
      productName: productName(row.product_id),
      amountKrw: row.price_krw,
      status: row.status,
      createdAt: row.paid_at ?? row.created_at,
    })),
    recentErrors: (errorsResult.data ?? []).map((row) => {
      const automation = automations.get(row.automation_id);
      return {
        id: row.id,
        userEmail: automation ? emailFor(automation.user_id) : "알 수 없는 사용자",
        automationName: automation?.name ?? "삭제된 자동화",
        message: row.error_message ?? "오류 상세가 기록되지 않았습니다.",
        createdAt: row.completed_at ?? row.started_at ?? new Date(0).toISOString(),
      };
    }),
    recentRefunds: (refundsResult.data ?? []).map((row) => ({
      id: row.id,
      userEmail: emailFor(row.user_id),
      productName: productName(refundOrders.get(row.order_id)?.product_id ?? "이전 주문"),
      expectedRefundKrw: row.expected_refund_krw,
      status: REFUND_REQUEST_STATUS_LABEL[row.status],
      createdAt: row.created_at,
    })),
    recentInquiries: (inquiriesResult.data ?? []).map((row) => ({
      id: row.id,
      userEmail: emailFor(row.user_id),
      subject: row.subject,
      category: INQUIRY_CATEGORY_LABEL[row.category],
      status: INQUIRY_STATUS_LABEL[row.status],
      createdAt: row.created_at,
    })),
    recentAudit: (auditResult.data ?? []).map((row) => ({
      id: row.id,
      actorEmail: row.actor_email ?? "삭제된 관리자",
      action: row.action,
      targetType: row.target_type ?? "—",
      createdAt: row.created_at,
    })),
  };
}

