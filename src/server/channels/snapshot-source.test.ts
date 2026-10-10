import { describe, expect, it } from "vitest";
import { CHANNEL_SNAPSHOT_SOURCES } from "./snapshot-source";
import { extractCheckConstraintValues, readLatestMigrationSql } from "@/server/shared/check-constraint-testing";

describe("channel snapshot source consistency", () => {
  it("the latest marketing_metric_snapshots_source_check migration matches CHANNEL_SNAPSHOT_SOURCES", () => {
    const sql = readLatestMigrationSql("marketing_metric_snapshots_source_check");
    const dbValues = extractCheckConstraintValues(sql, "marketing_metric_snapshots_source_check");

    expect(new Set(dbValues)).toEqual(new Set(CHANNEL_SNAPSHOT_SOURCES));
  });

  it("the latest channel_diagnoses_data_source_check migration matches CHANNEL_SNAPSHOT_SOURCES", () => {
    const sql = readLatestMigrationSql("channel_diagnoses_data_source_check");
    const dbValues = extractCheckConstraintValues(sql, "channel_diagnoses_data_source_check");

    expect(new Set(dbValues)).toEqual(new Set(CHANNEL_SNAPSHOT_SOURCES));
  });
});
