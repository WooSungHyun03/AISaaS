import type { Database } from "./database.types";

/**
 * Convenience aliases over the generated Database rows. Prefer importing
 * these in app/component code instead of reaching into `Database[...]`
 * directly — this is the one place to update if a table gains a column.
 */
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Business = Database["public"]["Tables"]["businesses"]["Row"];
export type AutomationTemplate = Database["public"]["Tables"]["automation_templates"]["Row"];
export type Automation = Database["public"]["Tables"]["automations"]["Row"];
export type AutomationRun = Database["public"]["Tables"]["automation_runs"]["Row"];
export type ContentHistory = Database["public"]["Tables"]["content_history"]["Row"];
export type Subscription = Database["public"]["Tables"]["subscriptions"]["Row"];
export type Usage = Database["public"]["Tables"]["usage"]["Row"];
export type SetupRequest = Database["public"]["Tables"]["setup_requests"]["Row"];
export type DirectoryTool = Database["public"]["Tables"]["directory_tools"]["Row"];
export type Faq = Database["public"]["Tables"]["faqs"]["Row"];
export type IntegrationConnection = Database["public"]["Tables"]["integration_connections"]["Row"];

export type {
  AutomationStatus,
  AutomationRunStatus,
  AutomationRunSource,
  SubscriptionPlan,
  SubscriptionStatus,
  SetupRequestStatus,
  IntegrationProvider,
  ConnectionStatus,
  Json,
} from "./database.types";

/** Slugs for the automation templates seeded in supabase/seed.sql. */
export type AutomationTemplateSlug =
  | "blog-marketing"
  | "instagram-marketing"
  | "newsletter"
  | "customer-support"
  | "shorts";
