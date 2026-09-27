import { describe, expect, it } from "vitest";
import { DIRECTORY_TOOL_STATUSES } from "./status";
import { extractCheckConstraintValues, readLatestMigrationSql } from "./check-constraint-testing";

const CONSTRAINT_NAME = "directory_tools_status_check";

describe("directory status consistency", () => {
  it("the latest directory_tools_status_check migration matches DIRECTORY_TOOL_STATUSES", () => {
    const sql = readLatestMigrationSql(CONSTRAINT_NAME);
    const dbValues = extractCheckConstraintValues(sql, CONSTRAINT_NAME);

    expect(new Set(dbValues)).toEqual(new Set(DIRECTORY_TOOL_STATUSES));
  });
});
