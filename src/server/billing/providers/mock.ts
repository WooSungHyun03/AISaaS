import "server-only";
import { serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/logger";
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
  cancelStoredSubscription,
  claimCheckoutSession,
  createCheckoutSession,
  markCheckoutFailed,
  markCheckoutSucceeded,
} from "../checkout-sessions";

/**
 * Mock checkout grants a paid plan without any payment, so on a real
 * (production) deployment it must be an explicit opt-in — otherwise any
 * signed-in user could upgrade themselves for free just by clicking
 * through /billing/mock-checkout.
 */
export function assertMockBillingAllowed(
  allowMock: string | undefined = serverEnv.ALLOW_MOCK_BILLING,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): void {
  if (nodeEnv === "production" && allowMock !== "true") {
    throw new Error(
      "모의 결제는 운영 환경에서 사용할 수 없습니다. BILLING_PROVIDER=toss 로 설정하거나, 데모 목적이라면 ALLOW_MOCK_BILLING=true 를 명시해주세요.",
    );
  }
}

/**
 * Simulates a payment gateway end-to-end (checkout -> completion -> entitlement
 * update) with no real money and no external dependency, so the full
 * billing flow can be verified before a real PG contract exists.
 *
 * The "checkout" is a page inside this app (/billing/mock-checkout) that,
 * on confirm, POSTs its opaque session id to an authenticated route. The same
 * provider completion boundary is used by the real Toss callback.
 */
export class MockBillingProvider implements BillingProvider {
  async createCheckout({ userId, plan, successUrl }: CreateCheckoutParams) {
    assertMockBillingAllowed();
    const session = await createCheckoutSession(userId, plan, "mock");
    const url = new URL("/billing/mock-checkout", successUrl);
    url.searchParams.set("session", session.id);
    return { url: url.toString(), provider: "mock" };
  }

  async completeCheckout({ userId, sessionId }: CompleteCheckoutParams) {
    assertMockBillingAllowed();
    const session = await claimCheckoutSession(sessionId, userId, "mock");
    if (session.status === "SUCCEEDED") return { plan: session.plan, provider: "mock" };

    try {
      await activateSubscription(userId, session.plan, "mock", session.id);
      await markCheckoutSucceeded(session.id, `mock_pay_${crypto.randomUUID()}`);
      logger.info("mock_subscription_activated", { userId, plan: session.plan, sessionId });
      return { plan: session.plan, provider: "mock" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mock checkout failed";
      await markCheckoutFailed(session.id, "MOCK_CHECKOUT_FAILED", message);
      throw error;
    }
  }

  async createPortal({ returnUrl }: CreatePortalParams) {
    // Mock provider has no external portal — send the user back to their
    // own billing settings page, which already exposes cancel/upgrade.
    return { url: returnUrl, provider: "mock" };
  }

  async cancelSubscription({ userId }: CancelSubscriptionParams) {
    await cancelStoredSubscription(userId);
    logger.info("mock_subscription_canceled", { userId });
  }

  async handleWebhook(_params: HandleWebhookParams) {
    // Mock completion is authenticated through completeCheckout(). Keeping the
    // old unsigned, user-controlled webhook would allow arbitrary plan changes.
    throw new Error("Mock billing does not accept external webhooks.");
  }
}
