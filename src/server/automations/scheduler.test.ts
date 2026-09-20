import { describe, expect, it } from "vitest";
import { computeNextRunAt } from "./scheduler";

describe("computeNextRunAt", () => {
  it("picks the next matching weekday for a WEEKLY schedule, skipping today if the time already passed", () => {
    // 2026-09-21 is a Monday. 00:00 UTC == 09:00 KST, so `from` is exactly
    // this Monday's 09:00 KST slot — the schedule should not re-fire "now",
    // it should roll forward to the next matching day.
    const from = new Date("2026-09-21T00:00:00.000Z");

    const next = computeNextRunAt(
      { frequency: "WEEKLY", daysOfWeek: [1, 3, 5], timeOfDay: "09:00", timezone: "Asia/Seoul" },
      from,
    );

    // Wednesday 2026-09-23, 09:00 KST.
    expect(next.toISOString()).toBe("2026-09-23T00:00:00.000Z");
  });

  it("rolls over to the next day for a DAILY schedule once today's time has passed", () => {
    const from = new Date("2026-09-20T01:00:00.000Z"); // 10:00 KST, Sunday

    const next = computeNextRunAt({ frequency: "DAILY", timeOfDay: "09:00", timezone: "Asia/Seoul" }, from);

    expect(next.toISOString()).toBe("2026-09-21T00:00:00.000Z"); // next day, 09:00 KST
  });

  it("always returns an instant strictly after `from`", () => {
    const from = new Date();
    const next = computeNextRunAt({ frequency: "DAILY", timeOfDay: "00:00" }, from);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });
});
