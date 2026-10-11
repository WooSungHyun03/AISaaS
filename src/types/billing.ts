import type { SubscriptionPlan } from "./domain";

export interface PlanConfig {
  id: SubscriptionPlan;
  name: string;
  /** Price in KRW per month. 0 for FREE. */
  priceMonthlyKrw: number;
  /** Max number of ACTIVE + DRAFT + PAUSED automations. null = unlimited. */
  automationLimit: number | null;
  /** Which image-to-video model the plan's animated videos use: `premium` is the stronger (pricier) one. */
  animationQuality: "standard" | "premium";
  /** Automation templates this plan is allowed to use. null = all. */
  allowedTemplateSlugs: string[] | null;
  features: string[];
}

export interface CheckoutSession {
  url: string;
  provider: string;
}

export interface BillingPortalSession {
  url: string;
  provider: string;
}
