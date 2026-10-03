import type { Automation, AutomationTemplateSlug, Business, CalendarPlatform, Json } from "./domain";

/**
 * Shape stored in `automations.schedule`. Kept intentionally simple —
 * the scheduler only needs enough to compute the next run timestamp.
 */
export interface AutomationSchedule {
  frequency: "DAILY" | "WEEKLY";
  /** 0 = Sunday .. 6 = Saturday. Required when frequency is WEEKLY. */
  daysOfWeek?: number[];
  /** "HH:mm" in the schedule's timezone. */
  timeOfDay: string;
  /** IANA timezone name. Defaults to the service timezone (Asia/Seoul). */
  timezone?: string;
}

export type ShortsPublishPlatform = "instagram" | "youtube";

export interface ShortsRunOptions {
  /** Preview runs generate and render the video without posting it. */
  previewOnly?: boolean;
  /** Publish a previously rendered, server-verified preview. */
  publish?: {
    sourceRunId: string;
    platforms: ShortsPublishPlatform[];
  };
}

/** Everything a handler needs to do its work for a single run. */
export interface AutomationRunContext {
  automation: Automation;
  business: Business;
  /** Arbitrary automation-type-specific config from `automations.config`. */
  config: Record<string, Json>;
  /** Recent content produced by this automation, used to avoid repetition. */
  recentTopics: string[];
  /**
   * The `automation_runs.id` row the runner already inserted before calling
   * `handler.run()`. Handlers that call an external API once per recipient
   * (e.g. newsletter sends) derive a per-recipient idempotency key from
   * this so a request retried at the HTTP layer for the same run can't
   * double-send — see src/server/automations/handlers/newsletter.ts.
   */
  runId: string;
  /**
   * A trusted calendar plan selected for this manual run. The Server Action
   * re-reads it under RLS before the runner receives it; handlers must never
   * accept topic/goal text directly from a client request.
   */
  calendarItem?: {
    id: string;
    businessId: string;
    plannedDate: string;
    platform: CalendarPlatform;
    topic: string;
    goal: string;
    cta: string;
  };
  /** Trusted execution options supplied by the authenticated Shorts UI. */
  shorts?: ShortsRunOptions;
}

export interface AutomationHandlerResult {
  /** Stored as `automation_runs.output`. */
  output: Json;
  /** Populated when the handler published somewhere external. */
  externalUrl?: string;
  contentType?: string;
  title?: string;
  topic?: string;
  content?: string;
  /** Defaults to 1; publish-only operations can report 0. */
  aiGenerationCount?: number;
}

/**
 * One handler per automation template. The runner (src/server/automations/runner.ts)
 * owns loading context and persisting results — handlers only implement the
 * "what does this automation actually do" step.
 */
export interface AutomationHandler {
  templateSlug: AutomationTemplateSlug;
  run(ctx: AutomationRunContext): Promise<AutomationHandlerResult>;
}

export type AutomationAvailability = "AVAILABLE" | "BETA" | "COMING_SOON";

/**
 * Client-safe source of truth for what a user is allowed to actually turn
 * on today. Kept here (not in src/server/) so marketplace cards and the
 * automation creation wizard can read it without pulling in server-only
 * handler/connector code. Update this the same release a handler stops
 * throwing "not implemented yet".
 */
export const AUTOMATION_AVAILABILITY: Record<AutomationTemplateSlug, AutomationAvailability> = {
  "blog-marketing": "AVAILABLE",
  shorts: "AVAILABLE",
  "instagram-marketing": "COMING_SOON",
  newsletter: "COMING_SOON",
  "customer-support": "COMING_SOON",
};
