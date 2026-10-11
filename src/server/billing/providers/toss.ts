import "server-only";

import { clientEnv } from "@/lib/env/client";
import { requireEnv } from "@/lib/env/server";
import { logger } from "@/lib/logger";
import { getPlanConfig } from "../plans";
import type {
  BillingProvider,
  CancelSubscriptionParams,
  ConfirmOrderParams,
  CompleteCheckoutParams,
  CreateOrderParams,
  CreateCheckoutParams,
  CreatePortalParams,
  HandleWebhookParams,
  RefundPaymentParams,
} from "../provider";
import { completeProductOrder, createProductOrder, getProductOrderByCheckoutSession } from "../orders";
import { isProductId } from "../products";
import {
  activateSubscription,
  BillingCheckoutError,
  cancelStoredSubscription,
  claimCheckoutSession,
  createCheckoutSession,
  getCheckoutSession,
  getLegacyPlanFromCheckout,
  getLatestSuccessfulCheckout,
  markCheckoutFailed,
  markCheckoutSucceeded,
  saveBillingKey,
} from "../checkout-sessions";
import { TossApiClient, TossApiError } from "./toss-api";

function getTestKeys() {
  const clientKey = clientEnv.NEXT_PUBLIC_TOSS_CLIENT_KEY;
  const secretKey = requireEnv("TOSS_SECRET_KEY");
  if (!clientKey) throw new Error("Missing required environment variable: NEXT_PUBLIC_TOSS_CLIENT_KEY.");
  if (!clientKey.startsWith("test_") || !secretKey.startsWith("test_")) {
    throw new Error("Toss billing currently accepts test keys only. Configure test client and secret keys.");
  }
  return { clientKey, secretKey };
}

function errorDetails(error: unknown) {
  if (error instanceof TossApiError || error instanceof BillingCheckoutError) {
    return { code: error.code, message: error.message };
  }
  return { code: "CHECKOUT_FAILED", message: error instanceof Error ? error.message : "결제 처리에 실패했습니다." };
}

export class TossBillingProvider implements BillingProvider {
  async createOrder({ userId, productId, successUrl }: CreateOrderParams) {
    getTestKeys();
    const { session } = await createProductOrder(userId, productId, "toss");
    const url = new URL("/billing/toss-checkout", successUrl);
    url.searchParams.set("session", session.id);
    return { url: url.toString(), provider: "toss" };
  }

  async confirmOrder({ userId, sessionId, paymentKey, providerOrderId, amount }: ConfirmOrderParams) {
    if (!paymentKey || !providerOrderId || typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
      throw new BillingCheckoutError("INVALID_CALLBACK", "결제 승인 정보가 누락되었습니다.");
    }

    const preview = await getCheckoutSession(sessionId, userId);
    if (preview.provider !== "toss" || preview.order_id !== providerOrderId || !isProductId(preview.product_id)) {
      throw new BillingCheckoutError("ORDER_MISMATCH", "결제 요청 정보가 일치하지 않습니다.");
    }
    const order = await getProductOrderByCheckoutSession(preview.id, userId);
    if (amount !== order.price_krw) {
      throw new BillingCheckoutError("AMOUNT_MISMATCH", "결제 금액이 상품 가격과 일치하지 않습니다.");
    }

    const session = await claimCheckoutSession(sessionId, userId, "toss");
    try {
      if (session.status !== "SUCCEEDED") {
        const { secretKey } = getTestKeys();
        const payment = await new TossApiClient(secretKey).confirmPayment({
          paymentKey,
          orderId: providerOrderId,
          amount,
          idempotencyKey: `${session.id}-confirm`,
        });
        if (payment.paymentKey !== paymentKey || payment.orderId !== session.order_id
          || payment.totalAmount !== order.price_krw || payment.status !== "DONE") {
          throw new BillingCheckoutError("PAYMENT_VERIFICATION_FAILED", "결제 승인 결과를 확인할 수 없습니다.");
        }
      }

      const completed = await completeProductOrder(order.id, session.provider_payment_key ?? paymentKey);
      logger.info("toss_product_order_completed", { userId, productId: preview.product_id, orderId: order.id });
      return {
        orderId: order.id,
        productId: preview.product_id,
        grantId: completed.grantId,
        provider: "toss",
      };
    } catch (error) {
      const details = errorDetails(error);
      await markCheckoutFailed(session.id, details.code, details.message);
      logger.error("toss_product_order_failed", { userId, sessionId, code: details.code });
      throw error;
    }
  }

  async refundPayment(params: RefundPaymentParams) {
    if (!Number.isSafeInteger(params.amount) || params.amount <= 0 || params.amount > params.originalAmount) {
      throw new BillingCheckoutError("INVALID_REFUND_AMOUNT", "환불 금액이 올바르지 않습니다.");
    }
    const { secretKey } = getTestKeys();
    const payment = await new TossApiClient(secretKey).cancelPayment({
      paymentKey: params.paymentKey,
      reason: params.reason,
      ...(params.amount < params.originalAmount ? { cancelAmount: params.amount } : {}),
      idempotencyKey: params.idempotencyKey,
    });
    if (!['CANCELED', 'PARTIAL_CANCELED'].includes(payment.status)) {
      throw new BillingCheckoutError("REFUND_VERIFICATION_FAILED", "토스 결제 취소 결과를 확인할 수 없습니다.");
    }
    const cancellation = payment.cancels?.at(-1);
    if (!cancellation || cancellation.cancelAmount !== params.amount || cancellation.cancelStatus !== "DONE") {
      throw new BillingCheckoutError("REFUND_VERIFICATION_FAILED", "토스 환불 금액을 확인할 수 없습니다.");
    }
    return { providerRefundId: cancellation.transactionKey, refundedAmount: cancellation.cancelAmount };
  }

  async createCheckout({ userId, plan, successUrl }: CreateCheckoutParams) {
    getTestKeys();
    const session = await createCheckoutSession(userId, plan, "toss");
    const url = new URL("/billing/toss-checkout", successUrl);
    url.searchParams.set("session", session.id);
    return { url: url.toString(), provider: "toss" };
  }

  async completeCheckout({ userId, sessionId, authKey, customerKey }: CompleteCheckoutParams) {
    if (!authKey || !customerKey) {
      throw new BillingCheckoutError("INVALID_CALLBACK", "결제 인증 정보가 누락되었습니다.");
    }

    const preview = await getCheckoutSession(sessionId, userId);
    if (preview.provider !== "toss" || preview.customer_key !== customerKey) {
      throw new BillingCheckoutError("CUSTOMER_KEY_MISMATCH", "결제 요청 정보가 일치하지 않습니다.");
    }

    const session = await claimCheckoutSession(sessionId, userId, "toss");
    const planId = getLegacyPlanFromCheckout(session);
    if (session.status === "SUCCEEDED") return { plan: planId, provider: "toss" };

    try {
      const { secretKey } = getTestKeys();
      const api = new TossApiClient(secretKey);
      let billingKey = session.provider_billing_key;
      if (!billingKey) {
        const billing = await api.issueBillingKey(authKey, customerKey, `${session.id}-issue`);
        if (billing.customerKey !== session.customer_key) {
          throw new BillingCheckoutError("CUSTOMER_KEY_MISMATCH", "발급된 결제수단 정보가 요청과 일치하지 않습니다.");
        }
        billingKey = billing.billingKey;
        await saveBillingKey(session.id, billingKey);
      }

      const plan = getPlanConfig(planId);
      const payment = await api.chargeBillingKey({
        billingKey,
        customerKey: session.customer_key,
        amount: plan.priceMonthlyKrw,
        orderId: session.order_id,
        orderName: `Easy Marketing ${plan.name} 월 구독`,
        idempotencyKey: `${session.id}-charge`,
      });

      if (payment.orderId !== session.order_id || payment.totalAmount !== plan.priceMonthlyKrw || payment.status !== "DONE") {
        throw new BillingCheckoutError("PAYMENT_VERIFICATION_FAILED", "결제 승인 결과를 확인할 수 없습니다.");
      }

      await activateSubscription(userId, planId, "toss", session.id);
      await markCheckoutSucceeded(session.id, payment.paymentKey);
      logger.info("toss_subscription_activated", { userId, plan: planId, sessionId });
      return { plan: planId, provider: "toss" };
    } catch (error) {
      const details = errorDetails(error);
      await markCheckoutFailed(session.id, details.code, details.message);
      logger.error("toss_checkout_failed", { userId, sessionId, code: details.code });
      throw error;
    }
  }

  async createPortal({ returnUrl }: CreatePortalParams) {
    return { url: returnUrl, provider: "toss" };
  }

  async cancelSubscription({ userId }: CancelSubscriptionParams) {
    const session = await getLatestSuccessfulCheckout(userId, "toss");
    // Local cancellation is authoritative for future renewals. Billing-key
    // deletion is best effort so a transient Toss outage cannot keep a plan active.
    await cancelStoredSubscription(userId);
    if (session?.provider_billing_key) {
      try {
        const { secretKey } = getTestKeys();
        await new TossApiClient(secretKey).deleteBillingKey(session.provider_billing_key);
      } catch (error) {
        const details = errorDetails(error);
        logger.error("toss_billing_key_delete_failed", { userId, code: details.code });
      }
    }
    logger.info("toss_subscription_canceled", { userId });
  }

  async handleWebhook(_params: HandleWebhookParams) {
    // This integration completes card registration through the authenticated
    // success callback. No Toss webhook is configured for the initial charge.
    logger.info("toss_webhook_ignored", { reason: "no configured billing webhook events" });
  }
}
