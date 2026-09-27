import { describe, expect, it } from "vitest";
import { DIRECTORY_CATEGORIES } from "./taxonomy";
import { classifyCategory } from "./classifier";
import { extractCheckConstraintValues, readLatestMigrationSql } from "@/server/shared/check-constraint-testing";

const CONSTRAINT_NAME = "directory_tools_category_check";

describe("directory taxonomy consistency", () => {
  it("the latest directory_tools_category_check migration matches DIRECTORY_CATEGORIES", () => {
    const sql = readLatestMigrationSql(CONSTRAINT_NAME);
    const dbValues = extractCheckConstraintValues(sql, CONSTRAINT_NAME);

    expect(new Set(dbValues)).toEqual(new Set(DIRECTORY_CATEGORIES));
  });

  it("classifyCategory never returns a value outside DIRECTORY_CATEGORIES", () => {
    expect(DIRECTORY_CATEGORIES).toContain(classifyCategory("a no-code workflow automation tool"));
    expect(DIRECTORY_CATEGORIES).toContain(classifyCategory("a Postgres-backed BaaS"));
    expect(DIRECTORY_CATEGORIES).toContain(classifyCategory("nothing recognizable here"));
  });

  it("falls back to 'other' when no keyword matches", () => {
    expect(classifyCategory("completely unrelated project about gardening")).toBe("other");
  });
});