import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getProductConfig, isProductId } from "@/server/billing/products";
import type { Database } from "@/types/database.types";
import { refundRequestInputSchema, type RefundOrderOption, type RefundRequestView } from "@/types/refunds";
import { calculateRefundQuote } from "./refund-policy";

type Db = SupabaseClient<Database>;

function productName(productId: string) {
  return isProductId(productId) ? getProductConfig(productId).name : productId;
}

function sumGrantBalance(grants: Array<{ remaining: number; expires_at: string }>) {
  if (grants.length === 0) return { remaining: 0, expiresAt: null };
  return {
    remaining: grants.reduce((sum, grant) => sum + grant.remaining, 0),
    // Grants for one order normally share an expiry. The earliest expiry is the
    // safe date to show and use if historical data ever contains more than one.
    expiresAt: grants.map((grant) => grant.expires_at).sort()[0] ?? null,
  };
}

export async function getRefundRequestPageData(userId: string) {
  const supabase = await createClient();
  const [ordersResult, requestsResult] = await Promise.all([
    supabase
      .from("billing_orders")
      .select("id,product_id,kind,credit_amount,price_krw,status,paid_at,created_at")
      .eq("user_id", userId)
      .in("status", ["PAID", "REFUNDED"])
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("refund_requests")
      .select("id,order_id,reason,status,used_credits_snapshot,unused_credits_snapshot,expected_refund_krw,created_at,updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (ordersResult.error) throw ordersResult.error;
  if (requestsResult.error) throw requestsResult.error;

  const orderIds = ordersResult.data.map((order) => order.id);
  const grantsResult = orderIds.length > 0
    ? await supabase.from("credit_grants").select("order_id,remaining,expires_at").eq("user_id", userId).in("order_id", orderIds)
    : { data: [], error: null };
  if (grantsResult.error) throw grantsResult.error;

  const grantsByOrder = new Map<string, Array<{ remaining: number; expires_at: string }>>();
  for (const grant of grantsResult.data) {
    if (!grant.order_id) continue;
    const current = grantsByOrder.get(grant.order_id) ?? [];
    current.push(grant);
    grantsByOrder.set(grant.order_id, current);
  }
  const requestsByOrder = new Set(requestsResult.data.map((request) => request.order_id));
  const ordersById = new Map(ordersResult.data.map((order) => [order.id, order]));

  const orders: RefundOrderOption[] = ordersResult.data.map((order) => {
    const grant = sumGrantBalance(grantsByOrder.get(order.id) ?? []);
    const quote = calculateRefundQuote({
      creditAmount: order.credit_amount,
      remainingCredits: grant.remaining,
      priceKrw: order.price_krw,
      expiresAt: grant.expiresAt,
    });
    const existingRequest = requestsByOrder.has(order.id);
    const eligible = order.status === "PAID" && quote.eligible && !existingRequest;
    const ineligibleReason = existingRequest
      ? "이미 환불 요청을 제출한 주문이에요."
      : order.status !== "PAID"
        ? "이미 환불 처리된 주문이에요."
        : quote.eligible ? null : quote.reason;
    return {
      id: order.id,
      productName: productName(order.product_id),
      kind: order.kind,
      creditAmount: order.credit_amount,
      remainingCredits: grant.remaining,
      priceKrw: order.price_krw,
      paidAt: order.paid_at ?? order.created_at,
      expiresAt: grant.expiresAt,
      expectedRefundKrw: quote.expectedRefundKrw,
      eligible,
      ineligibleReason,
    };
  });

  const requests: RefundRequestView[] = requestsResult.data.map((request) => ({
    id: request.id,
    orderId: request.order_id,
    productName: productName(ordersById.get(request.order_id)?.product_id ?? "이전 주문"),
    status: request.status,
    reason: request.reason,
    usedCredits: request.used_credits_snapshot,
    unusedCredits: request.unused_credits_snapshot,
    expectedRefundKrw: request.expected_refund_krw,
    createdAt: request.created_at,
    updatedAt: request.updated_at,
  }));

  return { orders, requests };
}

export type SubmitRefundRequestResult = { ok: true; requestId: string } | { ok: false; error: string };

export async function submitRefundRequest(
  userId: string,
  input: unknown,
  admin: Db = createAdminClient(),
): Promise<SubmitRefundRequestResult> {
  const parsed = refundRequestInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인해주세요." };

  const { orderId, reason } = parsed.data;
  const existing = await admin
    .from("refund_requests")
    .select("id")
    .eq("user_id", userId)
    .eq("order_id", orderId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return { ok: false, error: "이미 환불 요청을 제출한 주문이에요." };

  const orderResult = await admin
    .from("billing_orders")
    .select("id,user_id,credit_amount,price_krw,status")
    .eq("id", orderId)
    .eq("user_id", userId)
    .maybeSingle();
  if (orderResult.error) throw orderResult.error;
  if (!orderResult.data) return { ok: false, error: "환불을 요청할 주문을 찾지 못했어요." };
  if (orderResult.data.status !== "PAID") return { ok: false, error: "결제가 완료된 주문만 환불을 요청할 수 있어요." };

  const grantsResult = await admin
    .from("credit_grants")
    .select("remaining,expires_at")
    .eq("user_id", userId)
    .eq("order_id", orderId);
  if (grantsResult.error) throw grantsResult.error;
  const grant = sumGrantBalance(grantsResult.data);
  const quote = calculateRefundQuote({
    creditAmount: orderResult.data.credit_amount,
    remainingCredits: grant.remaining,
    priceKrw: orderResult.data.price_krw,
    expiresAt: grant.expiresAt,
  });
  if (!quote.eligible) return { ok: false, error: quote.reason };

  const inserted = await admin
    .from("refund_requests")
    .insert({
      user_id: userId,
      order_id: orderId,
      reason,
      credit_amount_snapshot: orderResult.data.credit_amount,
      used_credits_snapshot: quote.usedCredits,
      unused_credits_snapshot: quote.unusedCredits,
      expected_refund_krw: quote.expectedRefundKrw,
      policy_snapshot: quote.policySnapshot,
    })
    .select("id")
    .single();
  if (inserted.error?.code === "23505") return { ok: false, error: "이미 환불 요청을 제출한 주문이에요." };
  if (inserted.error) throw inserted.error;
  return { ok: true, requestId: inserted.data.id };
}

