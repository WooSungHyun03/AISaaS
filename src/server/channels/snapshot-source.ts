import { z } from "zod";

/**
 * Single source of truth for `marketing_metric_snapshots.source` and
 * `channel_diagnoses.data_source` (same values, same meaning: which
 * CHANNEL_DATA_PROVIDER produced this row). See platform.ts for the
 * matching-migration-test pattern this mirrors.
 *
 * Lowercase, matching the provider-selection convention (`AI_PROVIDER`,
 * `BILLING_PROVIDER`) rather than the uppercase lifecycle-status
 * convention — this isn't a status, it's which provider ran.
 *
 * Deliberately distinct from growth-report.ts's `MetricSource` (INTERNAL /
 * EXTERNAL_VERIFIED / ESTIMATED / UNAVAILABLE): that type classifies how
 * trustworthy an already-computed report number is for display. This type
 * instead records which concrete provider implementation wrote the row.
 */
export const CHANNEL_SNAPSHOT_SOURCES = ["live", "mock"] as const;

export type ChannelSnapshotSource = (typeof CHANNEL_SNAPSHOT_SOURCES)[number];

export const channelSnapshotSourceSchema = z.enum(CHANNEL_SNAPSHOT_SOURCES);
