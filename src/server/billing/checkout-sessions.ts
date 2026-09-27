import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { BillingCheckoutSession, SubscriptionPlan } from "@/types/domain";

export type PaidPlan = Exclude<SubscriptionPlan, "FREE">;
export type BillingProviderName = "mock" | "toss";

export class BillingCheckoutError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BillingCheckoutError";
  }
}

export async function createCheckoutSession(
  userId: string,
  plan: PaidPlan,
  provider: BillingProviderName,
): Promise<BillingCheckoutSession> {
  const admin = createAdminClient();
  const randomId = crypto.randomUUID();
  const { data, error } = await admin
    .from("billing_checkout_sessions")
    .insert({
      user_id: userId,
      plan,
      provider,
      customer_key: `cus_${randomId}`,
      order_id: `order_${randomId.replaceAll("-", "")}`,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function getCheckoutSession(sessionId: string, userId: string): Promise<BillingCheckoutSession> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("billing_checkout_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new BillingCheckoutError("CHECKOUT_NOT_FOUND", "결제 요청을 찾을 수 없습니다.");
  return data;
}

export async function claimCheckoutSession(
  sessionId: string,
  userId: string,
  provider: BillingProviderName,
): Promise<BillingCheckoutSession> {
  const existing = await getCheckoutSession(sessionId, userId);
  if (existing.provider !== provider) {
    throw new BillingCheckoutError("PROVIDER_MISMATCH", "결제 제공자 정보가 일치하지 않습니다.");
  }
  if (existing.status === "SUCCEEDED") return existing;
  if (existing.status === "PROCESSING") {
    throw new BillingCheckoutError("CHECKOUT_IN_PROGRESS", "결제를 처리하고 있습니다. 잠시 후 다시 확인해 주세요.");
  }
  if (existing.status === "CANCELED") {
    throw new BillingCheckoutError("CHECKOUT_CANCELED", "취소된 결제 요청입니다.");
  }
  if (new Date(existing.expires_at).getTime() < Date.now()) {
    throw new BillingCheckoutError("CHECKOUT_EXPIRED", "결제 요청 시간이 만료되었습니다. 플랜을 다시 선택해 주세요.");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("billing_checkout_sessions")
    .update({ status: "PROCESSING", error_code: null, error_message: null })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .in("status", ["PENDING", "FAILED"])
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new BillingCheckoutError("CHECKOUT_IN_PROGRESS", "결제를 처리하고 있습니다. 잠시 후 다시 확인해 주세요.");
  return data;
}

export async function saveBillingKey(sessionId: string, billingKey: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("billing_checkout_sessions")
    .update({ provider_billing_key: billingKey })
    .eq("id", sessionId);
  if (error) throw error;
}

export async function markCheckoutSucceeded(sessionId: string, paymentKey: string | null) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("billing_checkout_sessions")
    .update({
      status: "SUCCEEDED",
      provider_payment_key: paymentKey,
      completed_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
    })
    .eq("id", sessionId);
  if (error) throw error;
}

export async function markCheckoutFailed(sessionId: string, code: string, message: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("billing_checkout_sessions")
    .update({ status: "FAILED", error_code: code, error_message: message.slice(0, 500) })
    .eq("id", sessionId);
  if (error) throw error;
}

export async function markCheckoutCanceled(sessionId: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("billing_checkout_sessions")
    .update({ status: "CANCELED", error_code: "PAY_PROCESS_CANCELED", error_message: "사용자가 결제를 취소했습니다." })
    .eq("id", sessionId)
    .in("status", ["PENDING", "FAILED"]);
  if (error) throw error;
}

export async function activateSubscription(
  userId: string,
  plan: PaidPlan,
  provider: BillingProviderName,
  checkoutSessionId: string,
) {
  const admin = createAdminClient();
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const { error } = await admin.from("subscriptions").upsert(
    {
      user_id: userId,
      plan,
      status: "ACTIVE",
      provider,
      // Sensitive provider keys remain in billing_checkout_sessions, which has
      // no user-facing RLS policy. The subscription only stores our opaque id.
      provider_customer_id: checkoutSessionId,
      provider_subscription_id: checkoutSessionId,
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}

export async function cancelStoredSubscription(userId: string) {
  const admin = createAdminClient();
  const { error } = await admin.from("subscriptions").update({ status: "CANCELED" }).eq("user_id", userId);
  if (error) throw error;
}

export async function getLatestSuccessfulCheckout(userId: string, provider: BillingProviderName) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("billing_checkout_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("status", "SUCCEEDED")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
