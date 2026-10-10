import { describe, expect, it } from "vitest";
import { TRACKED_CHANNEL_STATUSES } from "./status";
import { extractCheckConstraintValues, readLatestMigrationSql } from "@/server/shared/check-constraint-testing";

const CONSTRAINT_NAME = "tracked_channels_status_check";

describe("tracked channel status consistency", () => {
  it("the latest tracked_channels_status_check migration matches TRACKED_CHANNEL_STATUSES", () => {
    const sql = readLatestMigrationSql(CONSTRAINT_NAME);
    const dbValues = extractCheckConstraintValues(sql, CONSTRAINT_NAME);

    expect(new Set(dbValues)).toEqual(new Set(TRACKED_CHANNEL_STATUSES));
  });
});
