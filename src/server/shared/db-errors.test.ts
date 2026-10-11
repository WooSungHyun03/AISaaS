import { describe, expect, it } from "vitest";
import { isMissingSchemaError } from "./db-errors";

describe("isMissingSchemaError", () => {
  it("recognises missing tables, columns and functions", () => {
    for (const code of ["42P01", "42703", "42883", "PGRST205", "PGRST204", "PGRST202"]) {
      expect(isMissingSchemaError({ code, message: "x" })).toBe(true);
    }
  });

  it("looks through wrapped errors (ChannelsError keeps the database error as its cause)", () => {
    expect(isMissingSchemaError(new Error("wrapped", { cause: { code: "42P01" } }))).toBe(true);
  });

  it("does not mistake ordinary failures for a missing migration", () => {
    expect(isMissingSchemaError({ code: "23505" })).toBe(false);
    expect(isMissingSchemaError(new Error("boom"))).toBe(false);
    expect(isMissingSchemaError(null)).toBe(false);
    expect(isMissingSchemaError(undefined)).toBe(false);
  });
});
