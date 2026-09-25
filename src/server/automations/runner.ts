import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { canExecuteAutomation, incrementUsage } from "@/server/billing/entitlements";
import { isAppError } from "@/server/shared/errors";
import type { AutomationSchedule } from "@/types/automation";
import type { Automation, AutomationRunSource } from "@/types/domain";
import type { Database } from "@/types/database.types";
import { getHandler } from "./handlers";
import { computeNextRunAt } from "./scheduler";

type AdminClient = SupabaseClient<Database>;

export interface RunAutomationResult {
  runId: string;
  status: "SUCCESS" | "FAILED";
  output?: unknown;
  errorMessage?: string;
}

/**
 * Persists a run the runner never actually started (paused/error automation,
 * plan limit reached) as an already-`FAILED` row with the reason, so it
 * shows up in history instead of vanishing as a silent no-op. Never touches
 * `automations.status` — refusing a run isn't itself a new failure. When a
 * SCHEDULED run is refused for a reason that can recur next tick (a plan
 * limit, not a paused/error automation already excluded from the due
 * query), `next_run_at` is advanced so the cron loop doesn't retry the same
 * slot every few minutes until the next legitimately due time.
 */
async function recordRefusedRun(
  admin: AdminClient,
  automation: Automation,
  source: AutomationRunSource,
  reason: string,
  options: { advanceSchedule: boolean },
): Promise<RunAutomationResult> {
  const now = new Date().toISOString();
  const { data: run, error } = await admin
    .from("automation_runs")
    .insert({ automation_id: automation.id, status: "FAILED", source, error_message: reason, started_at: now, completed_at: now })
    .select()
    .single();
  if (error || !run) {
    logger.error("automation_run_refusal_not_recorded", { automationId: automation.id, source, reason });
    throw error ?? new Error(reason);
  }

  if (options.advanceSchedule) {
    try {
      const nextRunAt = computeNextRunAt(automation.schedule as unknown as AutomationSchedule).toISOString();
      const { error: advanceError } = await admin.from("automations").update({ next_run_at: nextRunAt }).eq("id", automation.id);
      if (advanceError) throw advanceError;
    } catch (scheduleError) {
      // Never let a schedule-advance failure hide the original refusal reason
      // — the refusal itself was already recorded above and is returned
      // below regardless of whether this best-effort follow-up succeeds.
      logger.error("automation_run_refusal_schedule_advance_failed", {
        automationId: automation.id,
        error: scheduleError instanceof Error ? scheduleError.message : String(scheduleError),
      });
    }
  }

  logger.warn("automation_run_refused", { automationId: automation.id, runId: run.id, source, reason });
  return { runId: run.id, status: "FAILED", errorMessage: reason };
}

/**
 * The one execution path every automation type shares:
 *   load context -> guard against paused/limited/duplicate runs -> call the
 *   handler -> persist automation_runs + content_history -> update usage.
 * Automation-type differences live entirely inside the handler
 * (src/server/automations/handlers/), never here.
 */
async function executeAutomation(automationId: string, source: AutomationRunSource): Promise<RunAutomationResult> {
  const admin = createAdminClient();
  const advanceSchedule = source === "SCHEDULED";

  const { data: automation, error: automationError } = await admin
    .from("automations")
    .select("*")
    .eq("id", automationId)
    .single();
  if (automationError || !automation) {
    throw new Error(`Automation not found: ${automationId}`);
  }

  const { data: business, error: businessError } = await admin
    .from("businesses")
    .select("*")
    .eq("id", automation.business_id)
    .single();
  if (businessError || !business) {
    throw new Error(`Business not found for automation ${automationId}`);
  }

  const { data: template, error: templateError } = await admin
    .from("automation_templates")
    .select("*")
    .eq("id", automation.template_id)
    .single();
  if (templateError || !template) {
    throw new Error(`Template not found for automation ${automationId}`);
  }

  // A run can only ever be triggered (manually or by the cron tick) while
  // an automation is ACTIVE. findDueAutomations() already filters to ACTIVE
  // for the scheduled path; this is the same guarantee for "Run Now" and a
  // backstop against a race where the automation flips PAUSED/ERROR between
  // being read and actually running.
  if (automation.status === "PAUSED" || automation.status === "ERROR") {
    const reason =
      automation.status === "PAUSED"
        ? "이 자동화는 일시정지 상태라 실행할 수 없습니다."
        : "이 자동화는 오류 상태라 실행할 수 없습니다. 설정을 확인한 뒤 다시 활성화해주세요.";
    return recordRefusedRun(admin, automation, source, reason, { advanceSchedule: false });
  }

  const entitlement = await canExecuteAutomation(admin, automation.user_id, template.slug);
  if (!entitlement.allowed) {
    return recordRefusedRun(admin, automation, source, entitlement.reason ?? "이 플랜에서는 지금 이 자동화를 실행할 수 없습니다.", {
      advanceSchedule,
    });
  }

  // Duplicate-run guard. A partial unique index on automation_runs backs
  // this up at the database level in case two triggers race.
  const { data: inFlight } = await admin
    .from("automation_runs")
    .select("id")
    .eq("automation_id", automationId)
    .in("status", ["QUEUED", "RUNNING"])
    .maybeSingle();
  if (inFlight) {
    throw new Error("This automation already has a run in progress.");
  }

  const { data: run, error: insertError } = await admin
    .from("automation_runs")
    .insert({ automation_id: automationId, status: "RUNNING", source, started_at: new Date().toISOString() })
    .select()
    .single();
  if (insertError || !run) {
    throw insertError ?? new Error("Failed to create automation run");
  }

  try {
    const handler = getHandler(template.slug);

    const { data: recent } = await admin
      .from("content_history")
      .select("topic")
      .eq("automation_id", automationId)
      .order("created_at", { ascending: false })
      .limit(5);

    const result = await handler.run({
      automation,
      business,
      config: (automation.config as Record<string, never>) ?? {},
      recentTopics: (recent ?? []).map((r) => r.topic).filter((topic): topic is string => Boolean(topic)),
    });

    // Every write below is checked for a returned `error` and thrown into
    // the catch block on failure: the Supabase client resolves a failed
    // query rather than throwing, so a silently-ignored error here (a
    // dropped connection, a constraint violation) would leave the run
    // marked SUCCESS while content_history/next_run_at never actually got
    // written — or worse, leave the row stuck RUNNING when even the status
    // update itself fails silently.
    const { error: markSuccessError } = await admin
      .from("automation_runs")
      .update({ status: "SUCCESS", output: result.output ?? {}, completed_at: new Date().toISOString() })
      .eq("id", run.id);
    if (markSuccessError) throw markSuccessError;

    if (result.content) {
      const { error: contentHistoryError } = await admin.from("content_history").insert({
        business_id: automation.business_id,
        automation_id: automationId,
        content_type: result.contentType ?? template.slug,
        title: result.title ?? null,
        topic: result.topic ?? null,
        content: result.content,
        external_url: result.externalUrl ?? null,
      });
      if (contentHistoryError) throw contentHistoryError;
    }

    const nextRunAt = advanceSchedule
      ? computeNextRunAt(automation.schedule as unknown as AutomationSchedule).toISOString()
      : automation.next_run_at;

    const { error: advanceScheduleError } = await admin
      .from("automations")
      .update({ last_run_at: new Date().toISOString(), next_run_at: nextRunAt })
      .eq("id", automationId);
    if (advanceScheduleError) throw advanceScheduleError;

    await incrementUsage(admin, automation.user_id, { automationRuns: 1, aiGenerations: 1 });

    logger.info("automation_run_success", { automationId, runId: run.id });
    return { runId: run.id, status: "SUCCESS", output: result.output };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";

    const { error: markFailedError } = await admin
      .from("automation_runs")
      .update({ status: "FAILED", error_message: errorMessage, completed_at: new Date().toISOString() })
      .eq("id", run.id);
    if (markFailedError) {
      // This is the single most important write in the whole function —
      // if it fails there is nothing left to safely retry inside this
      // request, and the run may stay RUNNING until someone investigates.
      // Make that loud instead of silent.
      logger.error("automation_run_terminal_write_failed", { automationId, runId: run.id, dbError: markFailedError });
    }

    // Stop scheduling this automation until a human looks at it — no
    // infinite retries (Rule 29). This is a stronger guarantee than merely
    // advancing next_run_at: findDueAutomations() only ever selects
    // status = 'ACTIVE', so an ERROR automation can't be picked up by any
    // future cron tick regardless of what next_run_at holds, and
    // reactivating it (activateAutomation()) always recomputes a fresh
    // next_run_at anyway.
    const { error: markErrorStatusError } = await admin.from("automations").update({ status: "ERROR" }).eq("id", automationId);
    if (markErrorStatusError) {
      logger.error("automation_status_update_failed", { automationId, dbError: markErrorStatusError });
    }

    // Any domain's typed error (AIProviderError, ConnectorError, ...) carries
    // a `code`/`domain` — log it structured instead of only the free-text
    // message, without changing what gets persisted to automation_runs.
    logger.error("automation_run_failed", {
      automationId,
      runId: run.id,
      errorMessage,
      ...(isAppError(err) ? { errorDomain: err.domain, errorCode: err.code, retryable: err.retryable } : {}),
    });
    return { runId: run.id, status: "FAILED", errorMessage };
  }
}

/** Manual "Run Now" trigger from the dashboard — does not touch next_run_at. */
export async function runAutomationNow(automationId: string): Promise<RunAutomationResult> {
  return executeAutomation(automationId, "MANUAL");
}

/** Cron-triggered run for a due automation — advances next_run_at on success. */
export async function runDueAutomation(automationId: string): Promise<RunAutomationResult> {
  return executeAutomation(automationId, "SCHEDULED");
}
