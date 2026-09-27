import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { SetupRequest, SetupRequestStatus } from "@/types/domain";
import { CustomerSupportError } from "./errors";

/**
 * The full intended state machine for the whole lead funnel — kept here as
 * a reference (e.g. for docs/dev3/SETUP_REQUESTS_OPERATIONS.md, or a future
 * operator tool), NOT as a claim that every one of these transitions is
 * reachable through updateSetupRequestStatus() below. It isn't: main's
 * `setup_requests_cancel_own` RLS policy (0018_setup_request_funnel.sql)
 * only ever lets a user's own row move to CANCELLED, and only from
 * REQUESTED or CONTACTED — CONTACTED->IN_PROGRESS, IN_PROGRESS->COMPLETED,
 * etc. have no application code path at all today; an operator makes those
 * changes directly in Supabase Studio (service-role, bypasses RLS
 * entirely) — see docs/dev3/SETUP_REQUESTS_OPERATIONS.md.
 */
const STATUS_TRANSITIONS: Record<SetupRequestStatus, SetupRequestStatus[]> = {
  REQUESTED: ["CONTACTED", "CANCELLED"],
  CONTACTED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * Mirrors setup_requests_cancel_own's `using` clause exactly: a user's own
 * cancel can only ever succeed from these two states (notably NOT
 * IN_PROGRESS, even though the abstract state machine above allows
 * IN_PROGRESS -> CANCELLED as a concept an operator could still act on
 * manually). This list must stay in sync with that RLS policy by hand — it
 * lives in main's setup_requests_cancel_own migration, not something this
 * domain owns, so there's no shared-migration-constraint test wiring it up
 * automatically the way taxonomy.ts/status.ts are.
 */
const USER_CANCELLABLE_FROM: readonly SetupRequestStatus[] = ["REQUESTED", "CONTACTED"];

export function canTransition(from: SetupRequestStatus, to: SetupRequestStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Cancels a setup request on behalf of its owner. Guarded three ways:
 *
 * 1. `canTransition()` — rejects a transition the state machine doesn't
 *    recognize at all (e.g. COMPLETED -> CANCELLED) with a clear error
 *    before ever touching the database.
 * 2. `USER_CANCELLABLE_FROM` — rejects the one case `canTransition` alone
 *    would wrongly allow through: IN_PROGRESS -> CANCELLED is a valid
 *    *abstract* transition, but RLS never permits a user's own update to
 *    land from IN_PROGRESS (only an operator, outside this code path, can
 *    move it from there). Checking this here means that specific case
 *    fails with INVALID_TRANSITION immediately, instead of reaching the
 *    database and coming back as 0 rows updated — which step 3 below
 *    would otherwise (wrongly) report as a concurrent-change race.
 * 3. The update itself is a compare-and-swap (`.eq("status", current)`),
 *    so a status change that happened between the read and this write —
 *    by anyone, through any path — is still caught as a real race, now
 *    that step 2 has already ruled out the RLS-policy-shaped false
 *    positive.
 */
export async function updateSetupRequestStatus(
  supabase: SupabaseClient<Database>,
  id: string,
  to: SetupRequestStatus,
): Promise<SetupRequest> {
  const { data: existing, error: readError } = await supabase
    .from("setup_requests")
    .select("status")
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    throw new CustomerSupportError("UNKNOWN", `Failed to read setup request ${id}: ${readError.message}`, {
      cause: readError,
    });
  }
  if (!existing) {
    throw new CustomerSupportError("NOT_FOUND", `No setup request found for id "${id}".`);
  }

  const current = existing.status;

  if (!canTransition(current, to)) {
    throw new CustomerSupportError(
      "INVALID_TRANSITION",
      `Cannot move setup request ${id} from ${current} to ${to}.`,
    );
  }

  if (to === "CANCELLED" && !USER_CANCELLABLE_FROM.includes(current)) {
    throw new CustomerSupportError(
      "INVALID_TRANSITION",
      `Setup request ${id} can no longer be self-cancelled — it's already ${current}, and only REQUESTED/CONTACTED requests can be.`,
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from("setup_requests")
    .update({ status: to })
    .eq("id", id)
    .eq("status", current)
    .select()
    .maybeSingle();

  if (updateError) {
    throw new CustomerSupportError("UNKNOWN", `Failed to update setup request ${id}: ${updateError.message}`, {
      cause: updateError,
    });
  }
  if (!updated) {
    throw new CustomerSupportError(
      "INVALID_TRANSITION",
      `Setup request ${id} changed status before this update landed — refetch and retry.`,
    );
  }

  return updated;
}
