import { z } from "zod";

/**
 * Single source of truth for `directory_tools.status`. Mirrors the
 * category pattern (taxonomy.ts): any change here must ship with a new
 * migration that re-creates `directory_tools_status_check` (same
 * constraint name) with the same values — status.test.ts finds the
 * highest-numbered migration mentioning that name and asserts it matches
 * this list.
 *
 * Casing matches this project's existing status-column convention
 * (`automations.status`, `setup_requests.status`): uppercase values.
 */
export const DIRECTORY_TOOL_STATUSES = ["ACTIVE", "INACTIVE"] as const;

export type DirectoryToolStatus = (typeof DIRECTORY_TOOL_STATUSES)[number];

export const directoryToolStatusSchema = z.enum(DIRECTORY_TOOL_STATUSES);
