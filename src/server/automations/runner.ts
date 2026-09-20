import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { incrementUsage } from "@/server/billing/entitlements";
import type { AutomationSchedule } from "@/types/automation";
import { getHandler } from "./handlers";
import { computeNextRunAt } from "./scheduler";

export interface RunAutomationResult {
  runId: string;
  status: "SUCCESS" | "FAILED";
  output?: unknown;
  errorMessage?: string;
}

/**
 * The one execution path every automation type shares:
 *   load context -> guard against duplicate runs -> call the handler ->
 *   persist automation_runs + content_history -> update usage.
 * Automation-type differences live entirely inside the handler
 * (src/server/automations/handlers/), never here.
 */
async function executeAutomation(automationId: string, options: { advanceSchedule: boolean }): Promise<RunAutomationResult> {
  const admin = createAdminClient();

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
    .insert({ automation_id: automationId, status: "RUNNING", started_at: new Date().toISOString() })
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

    await admin
      .from("automation_runs")
      .update({ status: "SUCCESS", output: result.output ?? {}, completed_at: new Date().toISOString() })
      .eq("id", run.id);

    if (result.content) {
      await admin.from("content_history").insert({
        business_id: automation.business_id,
        automation_id: automationId,
        content_type: result.contentType ?? template.slug,
        title: result.title ?? null,
        topic: result.topic ?? null,
        content: result.content,
        external_url: result.externalUrl ?? null,
      });
    }

    const nextRunAt = options.advanceSchedule
      ? computeNextRunAt(automation.schedule as unknown as AutomationSchedule).toISOString()
      : automation.next_run_at;

    await admin
      .from("automations")
      .update({ last_run_at: new Date().toISOString(), next_run_at: nextRunAt })
      .eq("id", automationId);

    await incrementUsage(admin, automation.user_id, { automationRuns: 1, aiGenerations: 1 });

    logger.info("automation_run_success", { automationId, runId: run.id });
    return { runId: run.id, status: "SUCCESS", output: result.output };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";

    await admin
      .from("automation_runs")
      .update({ status: "FAILED", error_message: errorMessage, completed_at: new Date().toISOString() })
      .eq("id", run.id);

    // Stop scheduling this automation until a human looks at it — no
    // infinite retries (Rule 29).
    await admin.from("automations").update({ status: "ERROR" }).eq("id", automationId);

    logger.error("automation_run_failed", { automationId, runId: run.id, errorMessage });
    return { runId: run.id, status: "FAILED", errorMessage };
  }
}

/** Manual "Run Now" trigger from the dashboard — does not touch next_run_at. */
export async function runAutomationNow(automationId: string): Promise<RunAutomationResult> {
  return executeAutomation(automationId, { advanceSchedule: false });
}

/** Cron-triggered run for a due automation — advances next_run_at on success. */
export async function runDueAutomation(automationId: string): Promise<RunAutomationResult> {
  return executeAutomation(automationId, { advanceSchedule: true });
}
