import type { SubscriptionPlan } from "./domain";

export interface PlanConfig {
  id: SubscriptionPlan;
  name: string;
  /** Price in KRW per month. 0 for FREE. */
  priceMonthlyKrw: number;
  /** Max number of ACTIVE + DRAFT + PAUSED automations. null = unlimited. */
  automationLimit: number | null;
  /** Max automation_runs per calendar month. null = unlimited. */
  monthlyRunLimit: number | null;
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
