import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import type {
  BillingProvider,
  CancelSubscriptionParams,
  CreateCheckoutParams,
  CreatePortalParams,
  HandleWebhookParams,
} from "../provider";

interface MockCheckoutCompletedEvent {
  type: "checkout.completed";
  userId: string;
  plan: "STARTER" | "PRO";
}

/**
 * Simulates a payment gateway end-to-end (checkout -> webhook -> entitlement
 * update) with no real money and no external dependency, so the full
 * billing flow can be verified before a real PG contract exists.
 *
 * The "checkout" is a page inside this app (/billing/mock-checkout) that,
 * on confirm, POSTs a fabricated event straight to the webhook route —
 * exercising the exact same code path a real provider's webhook would hit.
 */
export class MockBillingProvider implements BillingProvider {
  async createCheckout({ userId, plan, successUrl }: CreateCheckoutParams) {
    const url = new URL("/billing/mock-checkout", successUrl);
    url.searchParams.set("userId", userId);
    url.searchParams.set("plan", plan);
    return { url: url.toString(), provider: "mock" };
  }

  async createPortal({ returnUrl }: CreatePortalParams) {
    // Mock provider has no external portal — send the user back to their
    // own billing settings page, which already exposes cancel/upgrade.
    return { url: returnUrl, provider: "mock" };
  }

  async cancelSubscription({ userId }: CancelSubscriptionParams) {
    const admin = createAdminClient();
    const { error } = await admin.from("subscriptions").update({ status: "CANCELED" }).eq("user_id", userId);
    if (error) throw error;
    logger.info("mock_subscription_canceled", { userId });
  }

  async handleWebhook({ payload }: HandleWebhookParams) {
    const event = JSON.parse(payload) as MockCheckoutCompletedEvent;

    if (event.type !== "checkout.completed") {
      logger.warn("mock_webhook_unknown_event", { event });
      return;
    }

    const admin = createAdminClient();
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setDate(periodEnd.getDate() + 30);

    const { error } = await admin
      .from("subscriptions")
      .update({
        plan: event.plan,
        status: "ACTIVE",
        provider: "mock",
        provider_customer_id: `mock_cus_${event.userId}`,
        provider_subscription_id: `mock_sub_${crypto.randomUUID()}`,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
      })
      .eq("user_id", event.userId);

    if (error) throw error;
    logger.info("mock_subscription_activated", { userId: event.userId, plan: event.plan });
  }
}
