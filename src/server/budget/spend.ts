import "server-only";
import { randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";
import { assertPaidCallsAllowed, type BudgetKind } from "./config";
import { releaseSpend, reserveSpend, settleSpend } from "./ledger";

export interface PaidCall<T> {
  kind: BudgetKind;
  runId: string | null;
  step: string;
  attempt: number;
  provider: string;
  model: string | null;
  /** Worst-case cost, reserved before the call. */
  reserveUsd: number;
  /** Stable for the same logical call, so a repeated request cannot reserve twice. Default: unique per call. */
  idempotencyKey?: string;
  note?: string;
  /** Runs the call and reports what it really cost. */
  run: () => Promise<{ value: T; actualUsd: number; usage?: Record<string, unknown> }>;
  /**
   * Decides what a failed call cost. "release": it cannot have been billed (rejected before any work). A number: the
   * provider reported what it billed. Anything else (a timeout, a dropped connection): assume the worst and keep the
   * whole reservation as spent.
   */
  onError?: (error: unknown) => "release" | { actualUsd: number; usage?: Record<string, unknown> } | undefined;
}

/**
 * The one way a paid call is made: check the switches, reserve its worst case in the ledger, run it, settle to the
 * real cost. If settling fails the reservation simply stays (counted as spent) — never lost, never undercounted.
 */
export async function runPaidCall<T>(call: PaidCall<T>): Promise<T> {
  assertPaidCallsAllowed();
  const reservation = await reserveSpend({
    kind: call.kind,
    runId: call.runId,
    step: call.step,
    attempt: call.attempt,
    provider: call.provider,
    model: call.model,
    usd: call.reserveUsd,
    idempotencyKey: call.idempotencyKey ?? `${call.runId ?? "none"}:${call.step}:${call.attempt}:${randomUUID()}`,
    note: call.note,
  });

  let outcome: { value: T; actualUsd: number; usage?: Record<string, unknown> };
  try {
    outcome = await call.run();
  } catch (error) {
    const verdict = call.onError?.(error);
    try {
      if (verdict === "release") await releaseSpend(reservation.id, "call rejected before any work");
      else if (verdict) await settleSpend(reservation.id, verdict.actualUsd, verdict.usage);
      else await settleSpend(reservation.id, reservation.usd, { assumed: "billed at reservation (outcome unknown)" });
    } catch (ledgerError) {
      logger.error("budget_settle_after_failure_failed", { step: call.step, reservationId: reservation.id, message: ledgerError instanceof Error ? ledgerError.message : String(ledgerError) });
    }
    throw error;
  }

  try {
    await settleSpend(reservation.id, outcome.actualUsd, outcome.usage);
  } catch (ledgerError) {
    logger.error("budget_settle_failed", { step: call.step, reservationId: reservation.id, message: ledgerError instanceof Error ? ledgerError.message : String(ledgerError) });
  }
  // The ledger books what was really spent even when it is above the reservation; it only flags it.
  if (outcome.actualUsd > call.reserveUsd * 1.0001) {
    logger.warn("budget_actual_above_reservation", { step: call.step, reservedUsd: call.reserveUsd, actualUsd: outcome.actualUsd });
  }
  return outcome.value;
}
