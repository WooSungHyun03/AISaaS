import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { canExecuteAutomation, incrementUsage } from "@/server/billing/entitlements";
import { isAppError } from "@/server/shared/errors";
import { isDeferredOutcome, type AutomationHandlerResult, type AutomationRunContext, type AutomationSchedule } from "@/types/automation";
import type { Automation, AutomationRunSource, Json } from "@/types/domain";
import type { Database } from "@/types/database.types";
import { getHandler } from "./handlers";
import { computeNextRunAt } from "./scheduler";

type AdminClient = SupabaseClient<Database>;

export interface RunAutomationResult {
  runId: string;
  /** `RUNNING` means the handler deferred: the run continues from the cron tick or the open page. */
  status: "SUCCESS" | "FAILED" | "RUNNING";
  progress?: string;
  output?: unknown;
  contentHistoryId?: string;
  errorMessage?: string;
}

export interface RunAutomationOptions {
  calendarItem?: AutomationRunContext["calendarItem"];
  shorts?: AutomationRunContext["shorts"];
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

interface RunFinishContext {
  automation: Automation;
  templateSlug: string;
  runId: string;
  source: AutomationRunSource;
  startedAtMs: number;
}

/** Marks a finished run SUCCESS and does the bookkeeping that follows (history row, last_run_at, usage). */
async function persistSuccess(admin: AdminClient, ctx: RunFinishContext, result: AutomationHandlerResult): Promise<RunAutomationResult> {
  const { automation, runId: runIdValue, source, startedAtMs } = ctx;
  const automationId = automation.id;
  const run = { id: runIdValue };
  const template = { slug: ctx.templateSlug };
  // Every write below is checked for a returned `error` and thrown into
  // the catch block on failure: the Supabase client resolves a failed
  // query rather than throwing, so a silently-ignored error here (a
  // dropped connection, a constraint violation) would leave the run
  // marked SUCCESS while content_history never actually got written — or
  // worse, leave the row stuck RUNNING when even the status update itself
  // fails silently.
  const { error: markSuccessError } = await admin
    .from("automation_runs")
    .update({ status: "SUCCESS", output: result.output ?? {}, completed_at: new Date().toISOString() })
    .eq("id", run.id);
  if (markSuccessError) throw markSuccessError;

  let contentHistoryId: string | undefined;
  if (result.content) {
    const { data: contentHistory, error: contentHistoryError } = await admin
      .from("content_history")
      .insert({
        business_id: automation.business_id,
        automation_id: automationId,
        // Lets a content_history row link back to the full generation
        // result (hook/seoKeywords/imageSuggestion etc. live only in
        // automation_runs.output) — see src/app/(app)/blog/page.tsx.
        // Nullable: rows from before this column existed just have null,
        // and the UI falls back to this row's own plain-text fields.
        run_id: run.id,
        content_type: result.contentType ?? template.slug,
        title: result.title ?? null,
        topic: result.topic ?? null,
        content: result.content,
        external_url: result.externalUrl ?? null,
      })
      .select("id")
      .single();
    if (contentHistoryError || !contentHistory) {
      throw contentHistoryError ?? new Error("Failed to persist generated content");
    }
    contentHistoryId = contentHistory.id;
  }

  const { error: lastRunAtError } = await admin
    .from("automations")
    .update({ last_run_at: new Date().toISOString() })
    .eq("id", automationId);
  if (lastRunAtError) throw lastRunAtError;

  await incrementUsage(admin, automation.user_id, { automationRuns: 1, aiGenerations: result.aiGenerationCount ?? 1 });

  logger.info("automation_run_success", {
    automationId,
    runId: run.id,
    businessId: automation.business_id,
    feature: template.slug,
    source,
    durationMs: Date.now() - startedAtMs,
  });
  return { runId: run.id, status: "SUCCESS", output: result.output, contentHistoryId };
}

/** Marks a run FAILED, parks the automation in ERROR, and logs — the single failure path for fresh and resumed runs. */
async function persistFailure(admin: AdminClient, ctx: RunFinishContext, err: unknown): Promise<RunAutomationResult> {
  const { automation, runId: runIdValue, source, startedAtMs } = ctx;
  const automationId = automation.id;
  const run = { id: runIdValue };
  const template = { slug: ctx.templateSlug };
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
    businessId: automation.business_id,
    feature: template.slug,
    source,
    durationMs: Date.now() - startedAtMs,
    errorMessage,
    ...(isAppError(err) ? { errorDomain: err.domain, errorCode: err.code, retryable: err.retryable } : {}),
  });
  return { runId: run.id, status: "FAILED", errorMessage };
}

/**
 * The one execution path every automation type shares:
 *   load context -> guard against paused/limited/duplicate runs -> call the
 *   handler -> persist automation_runs + content_history -> update usage.
 * Automation-type differences live entirely inside the handler
 * (src/server/automations/handlers/), never here.
 */
async function executeAutomation(
  automationId: string,
  source: AutomationRunSource,
  options: RunAutomationOptions = {},
): Promise<RunAutomationResult> {
  const admin = createAdminClient();
  const advanceSchedule = source === "SCHEDULED";
  const startedAtMs = Date.now();

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
  if (options.calendarItem && options.calendarItem.businessId !== automation.business_id) {
    throw new Error("Calendar item does not belong to this automation's business.");
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
    .insert({
      automation_id: automationId,
      status: "RUNNING",
      source,
      input: {
        ...(options.calendarItem ? { calendarItem: options.calendarItem } : {}),
        ...(options.shorts ? { shorts: options.shorts } : {}),
      } as unknown as Json,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (insertError || !run) {
    throw insertError ?? new Error("Failed to create automation run");
  }

  try {
    // Recomputed and persisted at run START, not completion. findDueAutomations()
    // re-polls on every cron tick independent of how long the handler takes;
    // leaving next_run_at at its already-past value until the handler finishes
    // would let every tick during a slow run re-select this automation as due
    // again, relying entirely on the in-flight guard above (and its DB backstop)
    // to reject each one. Advancing it now means a slow run simply stops
    // looking due to the next tick in the first place.
    if (advanceSchedule) {
      const nextRunAt = computeNextRunAt(automation.schedule as unknown as AutomationSchedule).toISOString();
      const { error: advanceScheduleError } = await admin.from("automations").update({ next_run_at: nextRunAt }).eq("id", automationId);
      if (advanceScheduleError) throw advanceScheduleError;
    }

    const handler = getHandler(template.slug);

    const { data: recent } = await admin
      .from("content_history")
      .select("topic")
      .eq("automation_id", automationId)
      .eq("content_type", template.slug)
      .order("created_at", { ascending: false })
      .limit(20);

    const outcome = await handler.run({
      automation,
      business,
      config: (automation.config as Record<string, never>) ?? {},
      recentTopics: (recent ?? []).map((r) => r.topic).filter((topic): topic is string => Boolean(topic)),
      runId: run.id,
      calendarItem: options.calendarItem,
      shorts: options.shorts,
    });

    if (isDeferredOutcome(outcome)) {
      await storeDeferredJob(admin, run.id, outcome.deferred);
      logger.info("automation_run_deferred", { automationId, runId: run.id, feature: template.slug, source, durationMs: Date.now() - startedAtMs });
      return { runId: run.id, status: "RUNNING", progress: outcome.deferred.progress };
    }

    return await persistSuccess(admin, { automation, templateSlug: template.slug, runId: run.id, source, startedAtMs }, outcome);
  } catch (err) {
    return persistFailure(admin, { automation, templateSlug: template.slug, runId: run.id, source, startedAtMs }, err);
  }
}

/** Manual "Run Now" trigger from the dashboard — does not touch next_run_at. */
export async function runAutomationNow(
  automationId: string,
  options: RunAutomationOptions = {},
): Promise<RunAutomationResult> {
  return executeAutomation(automationId, "MANUAL", options);
}

/** Cron-triggered run for a due automation — advances next_run_at on success. */
export async function runDueAutomation(automationId: string): Promise<RunAutomationResult> {
  return executeAutomation(automationId, "SCHEDULED");
}

/**
 * Deferred runs. A handler that cannot finish inside one request returns
 * `{ deferred }`; the run stays RUNNING and its progress lives in
 * `automation_runs.output.job`:
 *   { rev, leaseUntil, state, progress, startedAt, transientErrors }
 * `advanceDeferredRun` takes a short lease (compare-and-swap on `rev`) so the
 * cron tick and an open page can never advance the same run at the same time,
 * does one bounded step through `handler.resume`, and either stores the new
 * state or finishes the run through the same success/failure path as any other.
 */
const LEASE_SECONDS = 120;
/** Consecutive retryable errors (network blips, 5xx) tolerated before the run is failed. */
const MAX_TRANSIENT_ERRORS = 4;

interface DeferredJob {
  rev: number;
  leaseUntil: string | null;
  state: Json;
  progress?: string;
  startedAt: string;
  transientErrors: number;
}

export function readDeferredJob(output: Json | null | undefined): DeferredJob | null {
  const record = output && typeof output === "object" && !Array.isArray(output) ? (output as Record<string, Json>) : null;
  const job = record?.job && typeof record.job === "object" && !Array.isArray(record.job) ? (record.job as Record<string, Json>) : null;
  if (!job || typeof job.rev !== "number" || job.state === undefined) return null;
  return {
    rev: job.rev,
    leaseUntil: typeof job.leaseUntil === "string" ? job.leaseUntil : null,
    state: job.state,
    progress: typeof job.progress === "string" ? job.progress : undefined,
    startedAt: typeof job.startedAt === "string" ? job.startedAt : new Date().toISOString(),
    transientErrors: typeof job.transientErrors === "number" ? job.transientErrors : 0,
  };
}

async function storeDeferredJob(admin: AdminClient, runId: string, deferred: { state: Json; progress?: string }): Promise<void> {
  const job: DeferredJob = { rev: 1, leaseUntil: null, state: deferred.state, progress: deferred.progress, startedAt: new Date().toISOString(), transientErrors: 0 };
  const { error } = await admin.from("automation_runs").update({ output: { job } as unknown as Json }).eq("id", runId);
  if (error) throw error;
}

export interface AdvanceDeferredResult {
  runId: string;
  status: "RUNNING" | "SUCCESS" | "FAILED" | "BUSY" | "NOT_DEFERRED";
  progress?: string;
  errorMessage?: string;
}

/** One bounded step of a deferred run. Safe to call from several places at once. */
export async function advanceDeferredRun(runId: string): Promise<AdvanceDeferredResult> {
  const admin = createAdminClient();
  const { data: run, error: runError } = await admin.from("automation_runs").select("*").eq("id", runId).maybeSingle();
  if (runError || !run) return { runId, status: "NOT_DEFERRED" };
  if (run.status === "SUCCESS" || run.status === "FAILED") return { runId, status: run.status, errorMessage: run.error_message ?? undefined };
  const job = readDeferredJob(run.output);
  if (!job) return { runId, status: "NOT_DEFERRED" };
  if (job.leaseUntil && Date.parse(job.leaseUntil) > Date.now()) return { runId, status: "BUSY", progress: job.progress };

  const claimedRev = job.rev + 1;
  const leased: DeferredJob = { ...job, rev: claimedRev, leaseUntil: new Date(Date.now() + LEASE_SECONDS * 1_000).toISOString() };
  const { data: claimed, error: claimError } = await admin
    .from("automation_runs")
    .update({ output: { job: leased } as unknown as Json })
    .eq("id", runId)
    .eq("status", "RUNNING")
    .eq("output->job->>rev", String(job.rev))
    .select("id");
  if (claimError || !claimed || claimed.length !== 1) return { runId, status: "BUSY", progress: job.progress };

  const { data: automation } = await admin.from("automations").select("*").eq("id", run.automation_id).single();
  if (!automation) return { runId, status: "NOT_DEFERRED" };
  const { data: business } = await admin.from("businesses").select("*").eq("id", automation.business_id).single();
  const { data: template } = await admin.from("automation_templates").select("*").eq("id", automation.template_id).single();
  const finish: RunFinishContext = {
    automation,
    templateSlug: template?.slug ?? "",
    runId,
    source: run.source,
    startedAtMs: Date.parse(run.created_at),
  };
  try {
    if (!business || !template) throw new Error("Business or template not found for a deferred run.");
    const handler = getHandler(template.slug);
    if (!handler.resume) throw new Error(`The ${template.slug} handler cannot resume a deferred run.`);
    const input = run.input && typeof run.input === "object" && !Array.isArray(run.input) ? (run.input as Record<string, Json>) : {};

    const outcome = await handler.resume(
      {
        automation,
        business,
        config: (automation.config as Record<string, never>) ?? {},
        recentTopics: [],
        runId,
        calendarItem: input.calendarItem as AutomationRunContext["calendarItem"],
        shorts: input.shorts as AutomationRunContext["shorts"],
      },
      job.state,
    );

    if (isDeferredOutcome(outcome)) {
      const next: DeferredJob = { ...job, rev: claimedRev + 1, leaseUntil: null, state: outcome.deferred.state, progress: outcome.deferred.progress, transientErrors: 0 };
      const { data: saved } = await admin
        .from("automation_runs")
        .update({ output: { job: next } as unknown as Json })
        .eq("id", runId)
        .eq("output->job->>rev", String(claimedRev))
        .select("id");
      if (!saved || saved.length !== 1) return { runId, status: "BUSY", progress: outcome.deferred.progress };
      return { runId, status: "RUNNING", progress: outcome.deferred.progress };
    }
    const result = await persistSuccess(admin, finish, outcome);
    return { runId, status: "SUCCESS", progress: undefined, errorMessage: result.errorMessage };
  } catch (err) {
    if (isAppError(err) && err.retryable && job.transientErrors + 1 < MAX_TRANSIENT_ERRORS) {
      logger.warn("automation_run_resume_retryable_error", { runId, errorCode: err.code, attempt: job.transientErrors + 1 });
      await admin
        .from("automation_runs")
        .update({ output: { job: { ...job, rev: claimedRev + 1, leaseUntil: null, transientErrors: job.transientErrors + 1 } } as unknown as Json })
        .eq("id", runId)
        .eq("output->job->>rev", String(claimedRev));
      return { runId, status: "RUNNING", progress: job.progress };
    }
    const failed = await persistFailure(admin, finish, err);
    return { runId, status: "FAILED", errorMessage: failed.errorMessage };
  }
}

/** Advances every in-flight deferred run (oldest first) until the time budget runs out. */
export async function advanceDeferredRuns(options: { budgetMs: number; limit?: number }): Promise<AdvanceDeferredResult[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("automation_runs")
    .select("id")
    .eq("status", "RUNNING")
    .not("output->job", "is", null)
    .order("created_at", { ascending: true })
    .limit(options.limit ?? 10);
  if (error) throw error;
  const deadline = Date.now() + options.budgetMs;
  const results: AdvanceDeferredResult[] = [];
  for (const row of data ?? []) {
    if (Date.now() > deadline) break;
    try {
      results.push(await advanceDeferredRun(row.id));
    } catch (err) {
      logger.error("cron_advance_failed", { runId: row.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
