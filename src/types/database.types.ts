/**
 * Hand-written mirror of the Supabase schema defined in supabase/migrations/.
 * If the CLI is available, prefer regenerating this with:
 *   supabase gen types typescript --project-id <ref> > src/types/database.types.ts
 * Until then, keep this file in sync with the migrations by hand.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type AutomationStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ERROR";
export type AutomationRunStatus = "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED";
export type AutomationRunSource = "MANUAL" | "SCHEDULED";
export type SubscriptionPlan = "FREE" | "STARTER" | "PRO";
export type SubscriptionStatus = "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED" | "INCOMPLETE";
export type SetupRequestStatus = "REQUESTED" | "CONTACTED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type SetupRequestContactMethod = "EMAIL" | "PHONE" | "KAKAO" | "OTHER";
export type IntegrationProvider = "instagram" | "youtube";
export type ConnectionStatus = "CONNECTED" | "EXPIRED" | "ERROR" | "DISCONNECTED";
export type BillingCheckoutStatus = "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELED";
export type BillingOrderStatus = "PENDING" | "PAID" | "CANCELED" | "REFUNDED";
export type CreditKind = "BLOG" | "SHORTS";
export type CreditLedgerEvent = "GRANT" | "RESERVE" | "SETTLE" | "RELEASE" | "EXPIRE" | "REFUND";
export type SubscriberStatus = "ACTIVE" | "UNSUBSCRIBED";
export type CalendarPlatform = "blog" | "instagram_reels" | "youtube_shorts";
export type CalendarItemStatus = "PLANNED" | "GENERATED" | "PUBLISHED" | "SKIPPED";
export type MarketingDiagnosisSourceType = "website" | "manual";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      businesses: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          industry: string | null;
          description: string | null;
          location: string | null;
          target_customer: string | null;
          brand_tone: string | null;
          keywords: string[];
          website: string | null;
          sns_links: Json;
          main_offering: string | null;
          strengths: string | null;
          marketing_goal: string | null;
          promotion_type: "STORE" | "PRODUCT" | "PLATFORM" | null;
          promotion_details: Json;
          public_widget_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          industry?: string | null;
          description?: string | null;
          location?: string | null;
          target_customer?: string | null;
          brand_tone?: string | null;
          keywords?: string[];
          website?: string | null;
          sns_links?: Json;
          main_offering?: string | null;
          strengths?: string | null;
          marketing_goal?: string | null;
          promotion_type?: "STORE" | "PRODUCT" | "PLATFORM" | null;
          promotion_details?: Json;
          public_widget_id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["businesses"]["Insert"]>;
        Relationships: [];
      };
      inquiries: {
        Row: {
          id: string;
          user_id: string;
          category: "PAYMENT" | "REFUND" | "BUG" | "FEATURE" | "OTHER";
          subject: string;
          body: string;
          status: "RECEIVED" | "IN_REVIEW" | "ANSWERED" | "CLOSED";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          category: "PAYMENT" | "REFUND" | "BUG" | "FEATURE" | "OTHER";
          subject: string;
          body: string;
          status?: "RECEIVED" | "IN_REVIEW" | "ANSWERED" | "CLOSED";
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["inquiries"]["Insert"]>;
        Relationships: [];
      };
      inquiry_messages: {
        Row: {
          id: string;
          inquiry_id: string;
          kind: "REPLY" | "STATUS_CHANGE";
          body: string | null;
          from_status: "RECEIVED" | "IN_REVIEW" | "ANSWERED" | "CLOSED" | null;
          to_status: "RECEIVED" | "IN_REVIEW" | "ANSWERED" | "CLOSED" | null;
          actor_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          inquiry_id: string;
          kind: "REPLY" | "STATUS_CHANGE";
          body?: string | null;
          from_status?: "RECEIVED" | "IN_REVIEW" | "ANSWERED" | "CLOSED" | null;
          to_status?: "RECEIVED" | "IN_REVIEW" | "ANSWERED" | "CLOSED" | null;
          actor_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["inquiry_messages"]["Insert"]>;
        Relationships: [];
      };
      calendar_events: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          description: string | null;
          starts_at: string;
          ends_at: string;
          all_day: boolean;
          color: string;
          category: string;
          recur_freq: "DAILY" | "WEEKLY" | "MONTHLY" | null;
          recur_interval: number;
          recur_weekdays: number[] | null;
          recur_until: string | null;
          recur_count: number | null;
          exdates: string[];
          series_id: string | null;
          original_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          description?: string | null;
          starts_at: string;
          ends_at: string;
          all_day?: boolean;
          color?: string;
          category?: string;
          recur_freq?: "DAILY" | "WEEKLY" | "MONTHLY" | null;
          recur_interval?: number;
          recur_weekdays?: number[] | null;
          recur_until?: string | null;
          recur_count?: number | null;
          exdates?: string[];
          series_id?: string | null;
          original_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["calendar_events"]["Insert"]>;
        Relationships: [];
      };
      automation_templates: {
        Row: {
          id: string;
          slug: string;
          name: string;
          description: string | null;
          category: string;
          icon: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          description?: string | null;
          category: string;
          icon?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["automation_templates"]["Insert"]>;
        Relationships: [];
      };
      automations: {
        Row: {
          id: string;
          user_id: string;
          business_id: string;
          template_id: string;
          name: string;
          status: AutomationStatus;
          schedule: Json;
          config: Json;
          last_run_at: string | null;
          next_run_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          business_id: string;
          template_id: string;
          name: string;
          status?: AutomationStatus;
          schedule?: Json;
          config?: Json;
          last_run_at?: string | null;
          next_run_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["automations"]["Insert"]>;
        Relationships: [];
      };
      automation_runs: {
        Row: {
          id: string;
          automation_id: string;
          status: AutomationRunStatus;
          source: AutomationRunSource;
          input: Json;
          output: Json;
          error_message: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          automation_id: string;
          status?: AutomationRunStatus;
          source?: AutomationRunSource;
          input?: Json;
          output?: Json;
          error_message?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["automation_runs"]["Insert"]>;
        Relationships: [];
      };
      content_history: {
        Row: {
          id: string;
          business_id: string;
          automation_id: string;
          run_id: string | null;
          content_type: string;
          title: string | null;
          topic: string | null;
          content: string | null;
          external_url: string | null;
          edited_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          automation_id: string;
          run_id?: string | null;
          content_type: string;
          title?: string | null;
          topic?: string | null;
          content?: string | null;
          external_url?: string | null;
          edited_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["content_history"]["Insert"]>;
        Relationships: [];
      };
      calendar_items: {
        Row: {
          id: string;
          business_id: string;
          planned_date: string;
          platform: CalendarPlatform;
          content_type: string;
          topic: string;
          goal: string;
          summary: string;
          cta: string;
          status: CalendarItemStatus;
          automation_id: string | null;
          content_history_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          planned_date: string;
          platform: CalendarPlatform;
          content_type: string;
          topic: string;
          goal: string;
          summary: string;
          cta: string;
          status?: CalendarItemStatus;
          automation_id?: string | null;
          content_history_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["calendar_items"]["Insert"]>;
        Relationships: [];
      };
      subscriptions: {
        Row: {
          id: string;
          user_id: string;
          plan: SubscriptionPlan;
          status: SubscriptionStatus;
          provider: string;
          provider_customer_id: string | null;
          provider_subscription_id: string | null;
          current_period_start: string | null;
          current_period_end: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          plan?: SubscriptionPlan;
          status?: SubscriptionStatus;
          provider?: string;
          provider_customer_id?: string | null;
          provider_subscription_id?: string | null;
          current_period_start?: string | null;
          current_period_end?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["subscriptions"]["Insert"]>;
        Relationships: [];
      };
      billing_checkout_sessions: {
        Row: {
          id: string;
          user_id: string;
          product_id: string;
          provider: "mock" | "toss";
          status: BillingCheckoutStatus;
          customer_key: string;
          order_id: string;
          provider_billing_key: string | null;
          provider_payment_key: string | null;
          error_code: string | null;
          error_message: string | null;
          expires_at: string;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          product_id: string;
          provider: "mock" | "toss";
          status?: BillingCheckoutStatus;
          customer_key: string;
          order_id: string;
          provider_billing_key?: string | null;
          provider_payment_key?: string | null;
          error_code?: string | null;
          error_message?: string | null;
          expires_at?: string;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["billing_checkout_sessions"]["Insert"]>;
        Relationships: [];
      };
      billing_orders: {
        Row: {
          id: string;
          user_id: string;
          product_id: string;
          kind: CreditKind;
          credit_amount: number;
          price_krw: number;
          validity_days: number;
          status: BillingOrderStatus;
          provider: "mock" | "toss" | "legacy";
          checkout_session_id: string | null;
          provider_order_id: string | null;
          paid_at: string | null;
          refunded_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          product_id: string;
          kind: CreditKind;
          credit_amount: number;
          price_krw: number;
          validity_days: number;
          status?: BillingOrderStatus;
          provider: "mock" | "toss" | "legacy";
          checkout_session_id?: string | null;
          provider_order_id?: string | null;
          paid_at?: string | null;
          refunded_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["billing_orders"]["Insert"]>;
        Relationships: [];
      };
      credit_grants: {
        Row: {
          id: string;
          user_id: string;
          kind: CreditKind;
          amount: number;
          remaining: number;
          expires_at: string;
          order_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          kind: CreditKind;
          amount: number;
          remaining: number;
          expires_at: string;
          order_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["credit_grants"]["Insert"]>;
        Relationships: [];
      };
      credit_ledger: {
        Row: {
          id: string;
          user_id: string;
          grant_id: string | null;
          kind: CreditKind;
          event_type: CreditLedgerEvent;
          delta: number;
          balance_after: number | null;
          reservation_id: string | null;
          reference_id: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          grant_id?: string | null;
          kind: CreditKind;
          event_type: CreditLedgerEvent;
          delta: number;
          balance_after?: number | null;
          reservation_id?: string | null;
          reference_id?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      credit_trial_claims: {
        Row: {
          user_id: string;
          blog_amount: number;
          shorts_amount: number;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          blog_amount: number;
          shorts_amount: number;
          expires_at: string;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      usage: {
        Row: {
          id: string;
          user_id: string;
          period: string;
          automation_runs: number;
          ai_generations: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          period: string;
          automation_runs?: number;
          ai_generations?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["usage"]["Insert"]>;
        Relationships: [];
      };
      setup_requests: {
        Row: {
          id: string;
          user_id: string;
          business_id: string | null;
          automation_type: string;
          description: string | null;
          budget_range: string | null;
          current_work: string | null;
          desired_outcome: string | null;
          contact_method: SetupRequestContactMethod | null;
          contact_value: string | null;
          status: SetupRequestStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          business_id?: string | null;
          automation_type: string;
          description?: string | null;
          budget_range?: string | null;
          current_work?: string | null;
          desired_outcome?: string | null;
          contact_method?: SetupRequestContactMethod | null;
          contact_value?: string | null;
          status?: SetupRequestStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["setup_requests"]["Insert"]>;
        Relationships: [];
      };
      directory_tools: {
        Row: {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          github_url: string | null;
          stars: number;
          forks: number;
          language: string | null;
          license: string | null;
          category: string | null;
          tags: string[];
          status: string;
          classification_source: string | null;
          last_github_sync_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          description?: string | null;
          github_url?: string | null;
          stars?: number;
          forks?: number;
          language?: string | null;
          license?: string | null;
          category?: string | null;
          tags?: string[];
          status?: string;
          classification_source?: string | null;
          last_github_sync_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["directory_tools"]["Insert"]>;
        Relationships: [];
      };
      faqs: {
        Row: {
          id: string;
          question: string;
          answer: string;
          category: string | null;
          is_published: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          question: string;
          answer: string;
          category?: string | null;
          is_published?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["faqs"]["Insert"]>;
        Relationships: [];
      };
      business_faqs: {
        Row: {
          id: string;
          business_id: string;
          question: string;
          answer: string;
          is_enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          question: string;
          answer: string;
          is_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["business_faqs"]["Insert"]>;
        Relationships: [];
      };
      support_widget_requests: {
        Row: {
          id: string;
          business_id: string;
          requester_hash: string | null;
          requested_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          requester_hash?: string | null;
          requested_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["support_widget_requests"]["Insert"]>;
        Relationships: [];
      };
      support_conversations: {
        Row: {
          id: string;
          business_id: string;
          question: string;
          answer: string;
          used_faq_ids: string[];
          is_fallback: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          question: string;
          answer: string;
          used_faq_ids?: string[];
          is_fallback: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["support_conversations"]["Insert"]>;
        Relationships: [];
      };
      integration_connections: {
        Row: {
          id: string;
          user_id: string;
          business_id: string;
          provider: IntegrationProvider;
          account_identifier: string | null;
          status: ConnectionStatus;
          secret_reference: string | null;
          metadata: Json;
          connected_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          business_id: string;
          provider: IntegrationProvider;
          account_identifier?: string | null;
          status?: ConnectionStatus;
          secret_reference?: string | null;
          metadata?: Json;
          connected_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["integration_connections"]["Insert"]>;
        Relationships: [];
      };
      subscribers: {
        Row: {
          id: string;
          business_id: string;
          email: string;
          name: string | null;
          status: SubscriberStatus;
          subscribed_at: string;
          unsubscribed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          email: string;
          name?: string | null;
          status?: SubscriberStatus;
          subscribed_at?: string;
          unsubscribed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["subscribers"]["Insert"]>;
        Relationships: [];
      };
      marketing_diagnoses: {
        Row: {
          id: string;
          business_id: string;
          source_type: MarketingDiagnosisSourceType;
          source_url: string | null;
          score: number;
          missing_channels: string[];
          content_status: string;
          sns_activity: string;
          recommendations: string[];
          raw_summary: string | null;
          score_breakdown: Json;
          evidence: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          source_type: MarketingDiagnosisSourceType;
          source_url?: string | null;
          score: number;
          missing_channels?: string[];
          content_status: string;
          sns_activity: string;
          recommendations?: string[];
          raw_summary?: string | null;
          score_breakdown?: Json;
          evidence?: Json;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["marketing_diagnoses"]["Insert"]>;
        Relationships: [];
      };
      // platform/status/completeness/source values: single source of truth is
      // src/server/channels/ (platform.ts, status.ts, completeness.ts,
      // snapshot-source.ts), same split as directory_tools' status/
      // classification_source columns above — kept as plain `string` here
      // rather than duplicating the union.
      tracked_channels: {
        Row: {
          id: string;
          business_id: string;
          platform: string;
          external_id: string;
          url: string;
          status: string;
          next_snapshot_at: string | null;
          consecutive_failure_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          platform: string;
          external_id: string;
          url: string;
          status?: string;
          next_snapshot_at?: string | null;
          consecutive_failure_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tracked_channels"]["Insert"]>;
        Relationships: [];
      };
      channel_diagnoses: {
        Row: {
          id: string;
          business_id: string;
          channel_id: string;
          overall_score: number;
          activity_score: number;
          consistency_score: number;
          content_score: number | null;
          metrics: Json;
          findings: string[];
          recommendations: string[];
          completeness: string;
          data_source: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          channel_id: string;
          overall_score: number;
          activity_score: number;
          consistency_score: number;
          content_score: number | null;
          metrics?: Json;
          findings?: string[];
          recommendations?: string[];
          completeness: string;
          data_source: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["channel_diagnoses"]["Insert"]>;
        Relationships: [];
      };
      marketing_metric_snapshots: {
        Row: {
          id: string;
          channel_id: string;
          metric: string;
          value: number;
          recorded_at: string;
          /** Generated column (0038) — KST (UTC+9) calendar date of recorded_at. Never set directly; Postgres computes it. */
          recorded_date: string;
          source: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          channel_id: string;
          metric: string;
          value: number;
          recorded_at: string;
          source: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["marketing_metric_snapshots"]["Insert"]>;
        Relationships: [];
      };
      channel_diagnosis_attempts: {
        Row: {
          id: string;
          business_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["channel_diagnosis_attempts"]["Insert"]>;
        Relationships: [];
      };
      channel_growth_narratives: {
        Row: {
          id: string;
          business_id: string;
          channel_id: string;
          days: number;
          narrative: string;
          ai_used: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          channel_id: string;
          days: number;
          narrative: string;
          ai_used: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["channel_growth_narratives"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      integration_secret_create: {
        Args: { p_secret: string; p_name?: string | null };
        Returns: string;
      };
      integration_secret_update: {
        Args: { p_id: string; p_secret: string };
        Returns: void;
      };
      integration_secret_read: {
        Args: { p_id: string };
        Returns: string | null;
      };
      integration_secret_delete: {
        Args: { p_id: string };
        Returns: void;
      };
      increment_usage: {
        Args: { p_user_id: string; p_period: string; p_runs: number; p_generations: number };
        Returns: void;
      };
      grant_credit: {
        Args: {
          p_user_id: string;
          p_kind: CreditKind;
          p_amount: number;
          p_expires_at: string;
          p_order_id?: string | null;
          p_reference_id?: string | null;
        };
        Returns: string;
      };
      complete_billing_order: {
        Args: { p_order_id: string; p_payment_key: string };
        Returns: string;
      };
      reserve_credit: {
        Args: { p_user_id: string; p_kind: CreditKind; p_amount?: number; p_reference_id?: string | null };
        Returns: string;
      };
      settle_credit: {
        Args: { p_reservation_id: string; p_reference_id?: string | null };
        Returns: void;
      };
      release_credit: {
        Args: { p_reservation_id: string; p_reason?: string | null };
        Returns: void;
      };
      release_credit_by_reference: {
        Args: { p_reference_id: string; p_reason?: string | null };
        Returns: boolean;
      };
      settle_credit_by_reference: {
        Args: { p_reference_id: string };
        Returns: boolean;
      };
      ensure_trial_credits: {
        Args: {
          p_user_id: string;
          p_blog_amount: number;
          p_shorts_amount: number;
          p_expires_at: string;
          p_reference_id?: string;
        };
        Returns: boolean;
      };
      complete_automation_run_credit: {
        Args: {
          p_run_id: string;
          p_output: Json;
          p_completed_at?: string;
          p_requires_credit?: boolean;
        };
        Returns: boolean;
      };
      get_usage_history: {
        Args: {
          p_page?: number;
          p_page_size?: number;
          p_kind?: CreditKind | null;
          p_status?: string | null;
          p_from?: string | null;
          p_to?: string | null;
        };
        Returns: Array<{
          ledger_id: string;
          event_type: CreditLedgerEvent;
          kind: CreditKind;
          delta: number;
          created_at: string;
          terminal_event: "SETTLE" | "RELEASE" | null;
          terminal_delta: number | null;
          run_id: string | null;
          run_status: AutomationRunStatus | null;
          automation_id: string | null;
          automation_name: string | null;
          content_history_id: string | null;
          content_title: string | null;
          external_url: string | null;
          total_count: number;
        }>;
      };
      expire_credits: {
        Args: { p_now?: string };
        Returns: number;
      };
      refund_order_credits: {
        Args: { p_order_id: string; p_reason?: string | null };
        Returns: number;
      };
    };
  };
}
