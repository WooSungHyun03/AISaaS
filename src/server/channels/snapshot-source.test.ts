import { describe, expect, it } from "vitest";
import { CHANNEL_SNAPSHOT_SOURCES, MARKETING_METRIC_SNAPSHOTS_DB_SOURCES, channelSnapshotSourceSchema } from "./snapshot-source";
import { extractCheckConstraintValues, readLatestMigrationSql } from "@/server/shared/check-constraint-testing";

describe("channel snapshot source consistency", () => {
  it("the latest marketing_metric_snapshots_source_check migration matches MARKETING_METRIC_SNAPSHOTS_DB_SOURCES (DB allows DEMO_SEED; the app-facing zod enum intentionally does not)", () => {
    const sql = readLatestMigrationSql("marketing_metric_snapshots_source_check");
    const dbValues = extractCheckConstraintValues(sql, "marketing_metric_snapshots_source_check");

    expect(new Set(dbValues)).toEqual(new Set(MARKETING_METRIC_SNAPSHOTS_DB_SOURCES));
  });

  it("channelSnapshotSourceSchema (what app code can write) rejects DEMO_SEED even though the DB constraint allows it", () => {
    expect(channelSnapshotSourceSchema.safeParse("DEMO_SEED").success).toBe(false);
    expect(channelSnapshotSourceSchema.safeParse("live").success).toBe(true);
    expect(channelSnapshotSourceSchema.safeParse("mock").success).toBe(true);
  });

  it("the latest channel_diagnoses_data_source_check migration matches CHANNEL_SNAPSHOT_SOURCES (no DEMO_SEED here — diagnoses aren't seeded)", () => {
    const sql = readLatestMigrationSql("channel_diagnoses_data_source_check");
    const dbValues = extractCheckConstraintValues(sql, "channel_diagnoses_data_source_check");

    expect(new Set(dbValues)).toEqual(new Set(CHANNEL_SNAPSHOT_SOURCES));
  });
});
