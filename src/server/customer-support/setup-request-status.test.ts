import { describe, expect, it } from "vitest";
import { SETUP_REQUEST_STATUSES } from "./setup-request-status";
import { extractCheckConstraintValues, readLatestMigrationSql } from "@/server/shared/check-constraint-testing";

const CONSTRAINT_NAME = "setup_requests_status_values_check";

describe("setup request status consistency", () => {
  it("the latest setup_requests_status_values_check migration matches SETUP_REQUEST_STATUSES", () => {
    const sql = readLatestMigrationSql(CONSTRAINT_NAME);
    const dbValues = extractCheckConstraintValues(sql, CONSTRAINT_NAME);

    expect(new Set(dbValues)).toEqual(new Set(SETUP_REQUEST_STATUSES));
  });
});
