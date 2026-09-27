import { describe, expect, it } from "vitest";
import { CLASSIFICATION_SOURCES } from "./classification-source";
import { extractCheckConstraintValues, readLatestMigrationSql } from "./check-constraint-testing";

const CONSTRAINT_NAME = "directory_tools_classification_source_check";

describe("directory classification_source consistency", () => {
  it("the latest directory_tools_classification_source_check migration matches CLASSIFICATION_SOURCES", () => {
    const sql = readLatestMigrationSql(CONSTRAINT_NAME);
    const dbValues = extractCheckConstraintValues(sql, CONSTRAINT_NAME);

    expect(new Set(dbValues)).toEqual(new Set(CLASSIFICATION_SOURCES));
  });
});
