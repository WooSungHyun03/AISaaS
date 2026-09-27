import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { SetupRequest } from "@/types/domain";
import { CustomerSupportError } from "./errors";
import { setupRequestStatusSchema, type SetupRequestStatus } from "./setup-request-status";

/**
 * The full intended state machine. Only REQUESTED/CONTACTED/IN_PROGRESS ->
 * CANCELLED is actually reachable through updateSetupRequestStatus() below —
 * RLS's `setup_requests_update_own` policy (0023_setup_requests_workflow.sql)
 * only ever lets a user's own update land as CANCELLED, and only while the
 * row isn't already terminal. The rest of this table exists so the
 * intended state machine is documented and unit-testable, and so it's
 * ready for a future operator-facing tool — which would run through the
 * service-role client, bypassing that RLS restriction entirely, the same
 * way Supabase Studio does today (see docs/dev3/SETUP_REQUESTS_OPERATIONS.md).
 */
const STATUS_TRANSITIONS: Record<SetupRequestStatus, SetupRequestStatus[]> = {
  REQUESTED: ["CONTACTED", "CANCELLED"],
  CONTACTED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: SetupRequestStatus, to: SetupRequestStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

/**
 * `supabase` must be the RLS-scoped client — `setup_requests_select_own`
 * is what actually enforces "own requests only" here, this function just
 * runs the query. Capped at 50 — not real pagination, just a sane bound
 * for a single user's own lead-funnel history.
 */
export async function listMySetupRequests(supabase: SupabaseClient<Database>): Promise<SetupRequest[]> {
  const { data, error } = await supabase
    .from("setup_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new CustomerSupportError("UNKNOWN", `Failed to list setup requests: ${error.message}`, { cause: error });
  }
  return data ?? [];
}

/**
 * Moves a setup request to `to`, guarded twice:
 *
 * 1. `canTransition()` checks the state machine before ever touching the
 *    database — a clear INVALID_TRANSITION error instead of a confusing
 *    RLS-denied write with no explanation.
 * 2. The update itself is a compare-and-swap (`.eq("status", current)`),
 *    so a status change that happened between the read above and this
 *    write — by anyone, through any path — is detected (0 rows updated)
 *    instead of silently clobbered.
 *
 * RLS (`setup_requests_update_own`) is the actual security boundary for
 * what a regular user's session can achieve here (own row, non-terminal
 * only, result must be CANCELLED) — these two checks exist to fail with a
 * useful message before relying on that, not instead of it.
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

  const current = setupRequestStatusSchema.parse(existing.status);
  if (!canTransition(current, to)) {
    throw new CustomerSupportError(
      "INVALID_TRANSITION",
      `Cannot move setup request ${id} from ${current} to ${to}.`,
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
