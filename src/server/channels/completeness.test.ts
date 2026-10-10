import { describe, expect, it } from "vitest";
import { CHANNEL_DIAGNOSIS_COMPLETENESS } from "./completeness";
import { extractCheckConstraintValues, readLatestMigrationSql } from "@/server/shared/check-constraint-testing";

const CONSTRAINT_NAME = "channel_diagnoses_completeness_check";

describe("channel diagnosis completeness consistency", () => {
  it("the latest channel_diagnoses_completeness_check migration matches CHANNEL_DIAGNOSIS_COMPLETENESS", () => {
    const sql = readLatestMigrationSql(CONSTRAINT_NAME);
    const dbValues = extractCheckConstraintValues(sql, CONSTRAINT_NAME);

    expect(new Set(dbValues)).toEqual(new Set(CHANNEL_DIAGNOSIS_COMPLETENESS));
  });
});
