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

/**
 * DB-only: `marketing_metric_snapshots.source` additionally allows
 * 'DEMO_SEED' (ticket 1-6) — written only by scripts/seed-growth-demo.sql
 * via raw SQL, a local-only path that never goes through app code.
 * `channelSnapshotSourceSchema` above deliberately excludes it, so no app
 * code path can produce a DEMO_SEED row even by mistake. This constant
 * exists only so snapshot-source.test.ts can assert that exact,
 * intentional gap instead of requiring the DB constraint to exactly match
 * CHANNEL_SNAPSHOT_SOURCES the way every other enum in this domain does.
 */
export const MARKETING_METRIC_SNAPSHOTS_DB_SOURCES = [...CHANNEL_SNAPSHOT_SOURCES, "DEMO_SEED"] as const;
