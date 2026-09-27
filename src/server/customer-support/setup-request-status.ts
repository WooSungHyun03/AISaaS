import { z } from "zod";

/**
 * Single source of truth for `setup_requests.status`. Same pattern as
 * directory's taxonomy.ts/status.ts: any change here must ship with a new
 * migration that re-creates `setup_requests_status_values_check` (same
 * constraint name) with the same values — setup-request-status.test.ts
 * finds the highest-numbered migration mentioning that name and asserts it
 * matches this list.
 */
export const SETUP_REQUEST_STATUSES = ["REQUESTED", "CONTACTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;

export type SetupRequestStatus = (typeof SETUP_REQUEST_STATUSES)[number];

export const setupRequestStatusSchema = z.enum(SETUP_REQUEST_STATUSES);
