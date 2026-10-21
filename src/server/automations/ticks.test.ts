import { describe, expect, it } from "vitest";
import { SCHEDULER_STALE_MINUTES, schedulerHealthFrom } from "./ticks";

const NOW = new Date("2026-10-21T12:00:00.000Z");

describe("schedulerHealthFrom", () => {
  it("is unhealthy when the scheduler never ran", () => {
    expect(schedulerHealthFrom(null, NOW)).toEqual({ lastTickAt: null, ageMinutes: null, healthy: false });
  });

  it("is healthy right after a tick and up to the stale limit (pg_cron fires every 5 minutes)", () => {
    expect(schedulerHealthFrom("2026-10-21T11:56:00.000Z", NOW)).toMatchObject({ ageMinutes: 4, healthy: true });
    expect(schedulerHealthFrom(new Date(NOW.getTime() - SCHEDULER_STALE_MINUTES * 60_000).toISOString(), NOW).healthy).toBe(true);
  });

  it("is unhealthy once ticks stop arriving", () => {
    expect(schedulerHealthFrom("2026-10-21T11:00:00.000Z", NOW)).toMatchObject({ ageMinutes: 60, healthy: false });
  });

  it("never reports a negative age for a clock that is slightly ahead", () => {
    expect(schedulerHealthFrom("2026-10-21T12:00:30.000Z", NOW)).toMatchObject({ ageMinutes: 0, healthy: true });
  });
});
