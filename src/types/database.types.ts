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
export type IntegrationProvider = "wordpress" | "instagram" | "email" | "youtube";
export type ConnectionStatus = "CONNECTED" | "EXPIRED" | "ERROR" | "DISCONNECTED";
export type BillingCheckoutStatus = "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELED";

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
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["businesses"]["Insert"]>;
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
          content_type: string;
          title: string | null;
          topic: string | null;
          content: string | null;
          external_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          automation_id: string;
          content_type: string;
          title?: string | null;
          topic?: string | null;
          content?: string | null;
          external_url?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["content_history"]["Insert"]>;
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
          plan: Exclude<SubscriptionPlan, "FREE">;
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
          plan: Exclude<SubscriptionPlan, "FREE">;
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
    };
  };
}
