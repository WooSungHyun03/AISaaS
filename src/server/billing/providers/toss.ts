import "server-only";

import { clientEnv } from "@/lib/env/client";
import { requireEnv } from "@/lib/env/server";
import { logger } from "@/lib/logger";
import { getPlanConfig } from "../plans";
import type {
  BillingProvider,
  CancelSubscriptionParams,
  CompleteCheckoutParams,
  CreateCheckoutParams,
  CreatePortalParams,
  HandleWebhookParams,
} from "../provider";
import {
  activateSubscription,
  BillingCheckoutError,
  cancelStoredSubscription,
  claimCheckoutSession,
  createCheckoutSession,
  getCheckoutSession,
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
    if (session.status === "SUCCEEDED") return { plan: session.plan, provider: "toss" };

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

      const plan = getPlanConfig(session.plan);
      const payment = await api.chargeBillingKey({
        billingKey,
        customerKey: session.customer_key,
        amount: plan.priceMonthlyKrw,
        orderId: session.order_id,
        orderName: `AutoBiz ${plan.name} 월 구독`,
        idempotencyKey: `${session.id}-charge`,
      });

      if (payment.orderId !== session.order_id || payment.totalAmount !== plan.priceMonthlyKrw || payment.status !== "DONE") {
        throw new BillingCheckoutError("PAYMENT_VERIFICATION_FAILED", "결제 승인 결과를 확인할 수 없습니다.");
      }

      await activateSubscription(userId, session.plan, "toss", session.id);
      await markCheckoutSucceeded(session.id, payment.paymentKey);
      logger.info("toss_subscription_activated", { userId, plan: session.plan, sessionId });
      return { plan: session.plan, provider: "toss" };
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
