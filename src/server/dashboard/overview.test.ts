import { describe, expect, it } from "vitest";
import { buildDashboardNextAction } from "./overview";

describe("buildDashboardNextAction", () => {
  it.each([
    [{ hasBusiness: false, channelCount: 0, hasDiagnosis: false, calendarCount: 0, contentCount: 0 }, "BUSINESS"],
    [{ hasBusiness: true, channelCount: 0, hasDiagnosis: false, calendarCount: 0, contentCount: 0 }, "CHANNEL"],
    [{ hasBusiness: true, channelCount: 1, hasDiagnosis: false, calendarCount: 0, contentCount: 0 }, "DIAGNOSIS"],
    [{ hasBusiness: true, channelCount: 1, hasDiagnosis: true, calendarCount: 0, contentCount: 0 }, "CALENDAR"],
    [{ hasBusiness: true, channelCount: 1, hasDiagnosis: true, calendarCount: 2, contentCount: 0 }, "CONTENT"],
    [{ hasBusiness: true, channelCount: 1, hasDiagnosis: true, calendarCount: 2, contentCount: 1 }, "GROWTH"],
  ] as const)("selects the next unfinished step", (input, expected) => {
    expect(buildDashboardNextAction(input).stage).toBe(expected);
  });
});
