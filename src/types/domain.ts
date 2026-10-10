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
export type CalendarItem = Database["public"]["Tables"]["calendar_items"]["Row"];
export type Subscription = Database["public"]["Tables"]["subscriptions"]["Row"];
export type BillingCheckoutSession = Database["public"]["Tables"]["billing_checkout_sessions"]["Row"];
export type Usage = Database["public"]["Tables"]["usage"]["Row"];
export type SetupRequest = Database["public"]["Tables"]["setup_requests"]["Row"];
export type DirectoryTool = Database["public"]["Tables"]["directory_tools"]["Row"];
export type Faq = Database["public"]["Tables"]["faqs"]["Row"];
export type BusinessFaq = Database["public"]["Tables"]["business_faqs"]["Row"];
export type SupportWidgetRequest = Database["public"]["Tables"]["support_widget_requests"]["Row"];
export type SupportConversation = Database["public"]["Tables"]["support_conversations"]["Row"];
export type IntegrationConnection = Database["public"]["Tables"]["integration_connections"]["Row"];
export type Subscriber = Database["public"]["Tables"]["subscribers"]["Row"];
export type MarketingDiagnosis = Database["public"]["Tables"]["marketing_diagnoses"]["Row"];
export type TrackedChannel = Database["public"]["Tables"]["tracked_channels"]["Row"];
export type ChannelDiagnosisRow = Database["public"]["Tables"]["channel_diagnoses"]["Row"];
export type MarketingMetricSnapshot = Database["public"]["Tables"]["marketing_metric_snapshots"]["Row"];

/** Shape stored in `businesses.sns_links` (jsonb). All keys optional — a business may have none, some, or all. */
export interface BusinessSnsLinks {
  instagram?: string;
  facebook?: string;
  youtube?: string;
  naver_blog?: string;
  naver_place?: string;
  kakao_channel?: string;
  /**
   * @deprecated Replaced by `naver_blog` (the single generic `blog` key
   * covered both Naver Blog and Tistory links). Still declared, read-only,
   * so a business saved before that change keeps showing its link instead
   * of silently losing it — see mergeSnsLinks in
   * src/components/business/prefill.ts for where this is read as a
   * fallback. Never written by new saves.
   */
  blog?: string;
  // Index signature so this is structurally assignable to the generated `Json` type (sns_links' column type).
  [key: string]: string | undefined;
}

export type {
  AutomationStatus,
  AutomationRunStatus,
  AutomationRunSource,
  SubscriptionPlan,
  SubscriptionStatus,
  SetupRequestStatus,
  SetupRequestContactMethod,
  IntegrationProvider,
  ConnectionStatus,
  SubscriberStatus,
  CalendarPlatform,
  CalendarItemStatus,
  MarketingDiagnosisSourceType,
  Json,
} from "./database.types";

/** Slugs for the automation templates seeded in supabase/seed.sql. */
export type AutomationTemplateSlug =
  | "blog-marketing"
  | "instagram-marketing"
  | "newsletter"
  | "customer-support"
  | "shorts";
