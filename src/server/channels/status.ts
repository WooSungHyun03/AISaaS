import { z } from "zod";

/**
 * Single source of truth for `tracked_channels.status`. Uppercase,
 * matching this project's existing lifecycle-status convention
 * (`automations.status`, `setup_requests.status`). See platform.ts for
 * the matching-migration-test pattern this mirrors.
 *
 * - ACTIVE: normal polling target for the (future) snapshot scheduler.
 * - PAUSED: user turned off tracking without deleting the row/history.
 * - ERROR: last snapshot attempt failed; surfaced to the user, excluded
 *   from the scheduler's "due" lookup until manually retried.
 */
export const TRACKED_CHANNEL_STATUSES = ["ACTIVE", "PAUSED", "ERROR"] as const;

export type TrackedChannelStatus = (typeof TRACKED_CHANNEL_STATUSES)[number];

export const trackedChannelStatusSchema = z.enum(TRACKED_CHANNEL_STATUSES);
