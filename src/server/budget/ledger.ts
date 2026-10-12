import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/domain";
import { budgetLimits, currentBudgetPeriod, type BudgetKind } from "./config";
import { BudgetError } from "./errors";
import { round6 } from "./pricing";

/** The ledger's refusals come back as SQLSTATEs (migration 0073). */
function toBudgetError(error: { code?: string; message?: string }, fallback: string): BudgetError {
  switch (error.code) {
    case "BG001": return new BudgetError("BUDGET_ITEM_LIMIT", error.message ?? "item limit reached");
    case "BG002": return new BudgetError("BUDGET_CAP_EXCEEDED", error.message ?? "budget cap reached");
    case "BG003": return new BudgetError("BUDGET_ITEM_CAP_EXCEEDED", error.message ?? "item budget reached");
    default: return new BudgetError("BUDGET_LEDGER_UNAVAILABLE", `${fallback}: ${error.message ?? "unknown"}`);
  }
}

export interface SpendReservationInput {
  kind: BudgetKind;
  /** The run the money is for; null for spending that belongs to no item. */
  runId: string | null;
  /** Pipeline step, e.g. "blog.draft" or "video.generate". */
  step: string;
  attempt: number;
  provider: string;
  model: string | null;
  /** The most the call can cost. */
  usd: number;
  /** Same key, same reservation: a repeated request never reserves twice. */
  idempotencyKey: string;
  note?: string;
}

export interface SpendReservation {
  id: string;
  usd: number;
}

/** Reserves the worst-case cost of a paid call. Throws BudgetError when the call would pass a limit; nothing is written then. */
export async function reserveSpend(input: SpendReservationInput): Promise<SpendReservation> {
  const limits = budgetLimits(input.kind);
  const usd = round6(input.usd);
  const { data, error } = await createAdminClient().rpc("budget_reserve", {
    p_period: currentBudgetPeriod(),
    p_kind: input.kind,
    p_run_id: input.runId,
    p_step: input.step,
    p_attempt: input.attempt,
    p_provider: input.provider,
    p_model: input.model,
    p_usd: usd,
    p_idempotency_key: input.idempotencyKey,
    p_cap_usd: limits.capUsd,
    p_item_floor_usd: limits.itemFloorUsd,
    p_item_limit: limits.itemLimit,
    p_item_cap_usd: limits.itemCapUsd,
    p_note: input.note ?? null,
  });
  if (error || !data) throw toBudgetError(error ?? {}, "could not reserve budget");
  return { id: data, usd };
}

export async function settleSpend(reservationId: string, actualUsd: number, usage?: Record<string, unknown>): Promise<void> {
  const { error } = await createAdminClient().rpc("budget_settle", {
    p_id: reservationId,
    p_actual_usd: round6(actualUsd),
    p_usage: (usage ?? {}) as Json,
  });
  if (error) throw toBudgetError(error, "could not settle spend");
}

export async function releaseSpend(reservationId: string, note?: string): Promise<void> {
  const { error } = await createAdminClient().rpc("budget_release", { p_id: reservationId, p_note: note ?? null });
  if (error) throw toBudgetError(error, "could not release spend");
}

/** Takes one of the period's item slots for a run (idempotent). Throws BUDGET_ITEM_LIMIT when the period is full. */
export async function claimBudgetItem(kind: BudgetKind, runId: string): Promise<void> {
  const { error } = await createAdminClient().rpc("budget_claim_item", {
    p_period: currentBudgetPeriod(),
    p_kind: kind,
    p_run_id: runId,
    p_item_limit: budgetLimits(kind).itemLimit,
  });
  if (error) throw toBudgetError(error, "could not claim a budget item");
}

export async function completeBudgetItem(kind: BudgetKind, runId: string): Promise<void> {
  const { error } = await createAdminClient().rpc("budget_complete_item", { p_period: currentBudgetPeriod(), p_kind: kind, p_run_id: runId });
  if (error) throw toBudgetError(error, "could not complete a budget item");
}

export async function releaseBudgetItem(kind: BudgetKind, runId: string): Promise<void> {
  const { error } = await createAdminClient().rpc("budget_release_item", { p_period: currentBudgetPeriod(), p_kind: kind, p_run_id: runId });
  if (error) throw toBudgetError(error, "could not release a budget item");
}

export interface BudgetStatus {
  kind: BudgetKind;
  period: string;
  capUsd: number;
  settledUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  itemLimit: number;
  itemsClaimed: number;
  itemsCompleted: number;
  itemsReleased: number;
}

export async function getBudgetStatus(kind: BudgetKind): Promise<BudgetStatus> {
  const period = currentBudgetPeriod();
  const limits = budgetLimits(kind);
  const { data, error } = await createAdminClient().rpc("budget_status", { p_period: period, p_kind: kind });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) throw toBudgetError(error ?? {}, "could not read budget status");
  const row = data as Record<string, number>;
  const settledUsd = Number(row.settledUsd ?? 0);
  const reservedUsd = Number(row.reservedUsd ?? 0);
  return {
    kind,
    period,
    capUsd: limits.capUsd,
    settledUsd,
    reservedUsd,
    remainingUsd: round6(limits.capUsd - settledUsd - reservedUsd),
    itemLimit: limits.itemLimit,
    itemsClaimed: Number(row.itemsClaimed ?? 0),
    itemsCompleted: Number(row.itemsCompleted ?? 0),
    itemsReleased: Number(row.itemsReleased ?? 0),
  };
}

export interface RunSpendStep {
  step: string;
  attempt: number;
  provider: string;
  model: string | null;
  state: "RESERVED" | "SETTLED" | "RELEASED";
  usd: number;
  usage: Record<string, unknown>;
}

export interface RunSpend {
  totalUsd: number;
  steps: RunSpendStep[];
}

/** What one run has cost so far, call by call: the per-task cost record kept with the run. */
export async function summarizeRunSpend(runId: string): Promise<RunSpend> {
  const { data, error } = await createAdminClient()
    .from("budget_spend")
    .select("step,attempt,provider,model,state,reserved_usd,actual_usd,usage,created_at")
    .eq("run_id", runId)
    .order("created_at", { ascending: true });
  if (error) throw toBudgetError(error, "could not read run spend");
  const steps = (data ?? [])
    .filter((row) => row.state !== "RELEASED")
    .map((row) => ({
      step: row.step,
      attempt: row.attempt,
      provider: row.provider,
      model: row.model,
      state: row.state,
      usd: Number(row.state === "SETTLED" ? row.actual_usd ?? 0 : row.reserved_usd),
      usage: row.usage && typeof row.usage === "object" && !Array.isArray(row.usage) ? (row.usage as Record<string, unknown>) : {},
    }));
  return { totalUsd: round6(steps.reduce((sum, step) => sum + step.usd, 0)), steps };
}

/**
 * Closes whatever money a run left open. A reservation that was never settled belongs to a call whose outcome is
 * unknown (the process died, the run was reaped), so it is booked as spent at its reserved amount: the ledger may
 * overcount, never undercount. Returns how many reservations were closed.
 */
export async function settleOpenReservations(runId: string, note = "run closed with the call outcome unknown"): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("budget_spend").select("id,reserved_usd").eq("run_id", runId).eq("state", "RESERVED");
  if (error) throw toBudgetError(error, "could not read open reservations");
  for (const row of data ?? []) await settleSpend(row.id, Number(row.reserved_usd), { assumed: note });
  return data?.length ?? 0;
}

/** Marks the run's item slot as made (success) or gives it back (the run produced nothing). Looks the slot up by run, whatever period it was claimed in. */
export async function closeRunItem(runId: string, outcome: "COMPLETED" | "RELEASED"): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("budget_items").select("period_key,kind").eq("run_id", runId).eq("state", "CLAIMED");
  if (error) throw toBudgetError(error, "could not read the run's budget item");
  for (const row of data ?? []) {
    const { error: closeError } = await admin.rpc(outcome === "COMPLETED" ? "budget_complete_item" : "budget_release_item", { p_period: row.period_key, p_kind: row.kind, p_run_id: runId });
    if (closeError) throw toBudgetError(closeError, "could not close the run's budget item");
  }
}

/** Everything a failed or abandoned run still holds: open reservations are booked as spent, the item slot is given back. */
export async function closeFailedRunBudget(runId: string, note?: string): Promise<void> {
  await settleOpenReservations(runId, note);
  await closeRunItem(runId, "RELEASED");
}
