import { z } from "zod";

/**
 * Single source of truth for `channel_diagnoses.completeness`. See
 * platform.ts for the matching-migration-test pattern this mirrors.
 *
 * - COMPLETE: every metric the diagnosis needs was collected.
 * - PARTIAL: some metrics are missing (e.g. a rate-limited API call) but
 *   enough was collected to still compute scores.
 * - INSUFFICIENT_DATA: too little was collected to compute a meaningful
 *   score — the UI must show this explicitly rather than a fabricated number.
 */
export const CHANNEL_DIAGNOSIS_COMPLETENESS = ["COMPLETE", "PARTIAL", "INSUFFICIENT_DATA"] as const;

export type ChannelDiagnosisCompleteness = (typeof CHANNEL_DIAGNOSIS_COMPLETENESS)[number];

export const channelDiagnosisCompletenessSchema = z.enum(CHANNEL_DIAGNOSIS_COMPLETENESS);
