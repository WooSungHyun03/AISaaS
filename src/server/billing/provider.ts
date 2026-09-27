import type { SubscriptionPlan } from "@/types/domain";
import type { BillingPortalSession, CheckoutSession } from "@/types/billing";

export interface CreateCheckoutParams {
  userId: string;
  plan: Exclude<SubscriptionPlan, "FREE">;
  successUrl: string;
  cancelUrl: string;
}

export interface CreatePortalParams {
  userId: string;
  returnUrl: string;
}

export interface CancelSubscriptionParams {
  userId: string;
}

export interface HandleWebhookParams {
  /** Raw request body (string) — providers that verify signatures need the raw bytes. */
  payload: string;
  headers: Record<string, string>;
}

export interface CompleteCheckoutParams {
  userId: string;
  sessionId: string;
  /** Toss sends these after billing-method authentication. Mock omits them. */
  authKey?: string;
  customerKey?: string;
}

export interface CompleteCheckoutResult {
  plan: Exclude<SubscriptionPlan, "FREE">;
  provider: string;
}

/**
 * Abstraction over the payment gateway. Domain logic (entitlements, plan
 * config) never imports a PG SDK directly — it only talks to this
 * interface, so swapping the mock provider for a real one (Stripe,
 * TossPayments, ...) later touches one file: server/billing/index.ts.
 */
export interface BillingProvider {
  createCheckout(params: CreateCheckoutParams): Promise<CheckoutSession>;
  completeCheckout(params: CompleteCheckoutParams): Promise<CompleteCheckoutResult>;
  createPortal(params: CreatePortalParams): Promise<BillingPortalSession>;
  cancelSubscription(params: CancelSubscriptionParams): Promise<void>;
  handleWebhook(params: HandleWebhookParams): Promise<void>;
}
