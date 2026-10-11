import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { BillingCheckoutSession, BillingOrder } from "@/types/domain";
import type { BillingProviderName } from "./checkout-sessions";
import { createCheckoutSession, markCheckoutFailed } from "./checkout-sessions";
import { getProductConfig, type ProductId } from "./products";

export interface ProductOrderCheckout {
  session: BillingCheckoutSession;
  order: BillingOrder;
}

export interface CompletedProductOrder {
  order: BillingOrder;
  grantId: string;
}

export async function createProductOrder(
  userId: string,
  productId: ProductId,
  provider: BillingProviderName,
): Promise<ProductOrderCheckout> {
  const product = getProductConfig(productId);
  const session = await createCheckoutSession(userId, productId, provider);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("billing_orders")
    .insert({
      user_id: userId,
      product_id: product.id,
      kind: product.kind,
      credit_amount: product.credits,
      price_krw: product.priceKrw,
      validity_days: product.validityDays,
      provider,
      checkout_session_id: session.id,
      provider_order_id: session.order_id,
    })
    .select("*")
    .single();

  if (error) {
    await markCheckoutFailed(session.id, "ORDER_CREATE_FAILED", error.message).catch(() => undefined);
    throw error;
  }
  return { session, order: data };
}

export async function getProductOrderByCheckoutSession(
  sessionId: string,
  userId: string,
): Promise<BillingOrder> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("billing_orders")
    .select("*")
    .eq("checkout_session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("결제 주문을 찾을 수 없습니다.");
  return data;
}

export async function completeProductOrder(orderId: string, paymentKey: string): Promise<CompletedProductOrder> {
  const admin = createAdminClient();
  const { data: grantId, error } = await admin.rpc("complete_billing_order", {
    p_order_id: orderId,
    p_payment_key: paymentKey,
  });
  if (error) throw error;
  if (!grantId) throw new Error("이용권 지급 결과를 확인할 수 없습니다.");

  const { data: order, error: orderError } = await admin
    .from("billing_orders")
    .select("*")
    .eq("id", orderId)
    .single();
  if (orderError) throw orderError;
  return { order, grantId };
}

export async function getProductPurchaseResult(sessionId: string, userId: string) {
  const order = await getProductOrderByCheckoutSession(sessionId, userId);
  const admin = createAdminClient();
  const { data: grant, error } = await admin
    .from("credit_grants")
    .select("id,amount,remaining,expires_at")
    .eq("order_id", order.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return { order, grant };
}

export async function cancelProductOrderForCheckout(sessionId: string, userId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("billing_orders")
    .update({ status: "CANCELED" })
    .eq("checkout_session_id", sessionId)
    .eq("user_id", userId)
    .eq("status", "PENDING");
  if (error) throw error;
}
