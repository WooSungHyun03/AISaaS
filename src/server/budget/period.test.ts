import { describe, expect, it } from "vitest";
import { BudgetError } from "./errors";
import { budgetPeriodKeyFrom } from "./period";

const config = { start: "2026-10-12", end: "2026-11-12" };

describe("budget period", () => {
  it("returns a stable key inside the period, with Seoul midnight as the boundary", () => {
    expect(budgetPeriodKeyFrom(config, new Date("2026-10-11T15:00:00Z"))).toBe("2026-10-12..2026-11-12");
    expect(budgetPeriodKeyFrom(config, new Date("2026-11-11T14:59:59Z"))).toBe("2026-10-12..2026-11-12");
  });

  it("refuses before the start and from the end date on (end exclusive)", () => {
    expect(() => budgetPeriodKeyFrom(config, new Date("2026-10-11T14:59:59Z"))).toThrow(expect.objectContaining({ code: "BUDGET_PERIOD_CLOSED" }));
    expect(() => budgetPeriodKeyFrom(config, new Date("2026-11-11T15:00:00Z"))).toThrow(expect.objectContaining({ code: "BUDGET_PERIOD_CLOSED" }));
  });

  it("never resets by itself: a missing or invalid period refuses paid work", () => {
    expect(() => budgetPeriodKeyFrom({}, new Date("2026-10-20T00:00:00Z"))).toThrow(BudgetError);
    expect(() => budgetPeriodKeyFrom({ start: "2026-10-12" })).toThrow(expect.objectContaining({ code: "BUDGET_NOT_CONFIGURED" }));
    expect(() => budgetPeriodKeyFrom({ start: "2026-11-12", end: "2026-10-12" })).toThrow(expect.objectContaining({ code: "BUDGET_NOT_CONFIGURED" }));
    expect(() => budgetPeriodKeyFrom({ start: "nope", end: "2026-10-12" })).toThrow(expect.objectContaining({ code: "BUDGET_NOT_CONFIGURED" }));
  });
});
