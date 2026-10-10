import { describe, expect, it } from "vitest";
import { CHANNEL_PLATFORMS } from "./platform";
import { extractCheckConstraintValues, readLatestMigrationSql } from "@/server/shared/check-constraint-testing";

const CONSTRAINT_NAME = "tracked_channels_platform_check";

describe("channel platform consistency", () => {
  it("the latest tracked_channels_platform_check migration matches CHANNEL_PLATFORMS", () => {
    const sql = readLatestMigrationSql(CONSTRAINT_NAME);
    const dbValues = extractCheckConstraintValues(sql, CONSTRAINT_NAME);

    expect(new Set(dbValues)).toEqual(new Set(CHANNEL_PLATFORMS));
  });
});
