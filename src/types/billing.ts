import type { SubscriptionPlan } from "./domain";

export interface PlanConfig {
  id: SubscriptionPlan;
  name: string;
  /** Price in KRW per month. 0 for FREE. */
  priceMonthlyKrw: number;
  /** Max number of ACTIVE + DRAFT + PAUSED automations. null = unlimited. */
  automationLimit: number | null;
  /** Max automation_runs per calendar month, across all content types. null = unlimited. */
  monthlyRunLimit: number | null;
  /** Max SUCCESS runs of the "blog-marketing" template per calendar month. null = unlimited. */
  monthlyBlogLimit: number | null;
  /** Max SUCCESS runs of the "shorts" template per calendar month. null = unlimited. */
  monthlyShortsLimit: number | null;
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
