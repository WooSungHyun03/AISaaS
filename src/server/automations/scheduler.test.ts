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

  it("rolls a DAILY schedule across a year boundary (KST, no DST — Asia/Seoul has a fixed UTC+9 offset)", () => {
    // 2026-12-31 is a Thursday, 10:00 KST — after the 09:00 slot for that day.
    const from = new Date("2026-12-31T01:00:00.000Z");
    const next = computeNextRunAt({ frequency: "DAILY", timeOfDay: "09:00", timezone: "Asia/Seoul" }, from);
    // Rolls into 2027-01-01, 09:00 KST.
    expect(next.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("rolls a WEEKLY schedule across a year boundary onto the correct weekday", () => {
    // 2026-12-31 is a Thursday, 10:00 KST. Next Friday (5) 09:00 KST slot
    // falls in the new year.
    const from = new Date("2026-12-31T01:00:00.000Z");
    const next = computeNextRunAt(
      { frequency: "WEEKLY", daysOfWeek: [5], timeOfDay: "09:00", timezone: "Asia/Seoul" },
      from,
    );
    expect(next.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("rolls a WEEKLY schedule across a month boundary (28 -> 29 Feb, non-leap Feb -> Mar)", () => {
    // 2026-02-26 is a Thursday. Next Sunday (0) 09:00 KST slot is 2026-03-01.
    const from = new Date("2026-02-26T01:00:00.000Z");
    const next = computeNextRunAt(
      { frequency: "WEEKLY", daysOfWeek: [0], timeOfDay: "09:00", timezone: "Asia/Seoul" },
      from,
    );
    expect(next.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("resolves a DAILY schedule time inside a spring-forward DST gap by rolling forward with the local clock (non-KST timezone)", () => {
    // Asia/Seoul never observes DST, so the default/production path has no
    // gap/ambiguous-time cases at all — computeNextRunAt takes an optional
    // per-schedule IANA timezone though (types/automation.ts), so this
    // documents the resolution strategy if a DST timezone were ever used.
    // In America/New_York, clocks jump from 01:59:59 EST straight to
    // 03:00:00 EDT on 2027-03-14 — 02:30 local time never exists that day.
    const from = new Date("2027-03-13T12:00:00.000Z");
    const next = computeNextRunAt({ frequency: "DAILY", timeOfDay: "02:30", timezone: "America/New_York" }, from);
    // The gap is resolved by treating the nonexistent 02:30 as if the clock
    // had already jumped, landing on 03:30 EDT (07:30 UTC) rather than
    // throwing or silently picking the pre-jump offset.
    expect(next.toISOString()).toBe("2027-03-14T07:30:00.000Z");
  });

  it("resolves a DAILY schedule time inside a fall-back ambiguous hour by picking its first (pre-fallback) occurrence (non-KST timezone)", () => {
    // In America/New_York, 01:30 local occurs twice on 2027-11-07 (EDT then
    // EST). This locks in the current deterministic choice — the first
    // occurrence, before the clocks fall back — so a future change to this
    // resolution is a visible, deliberate diff instead of a silent regression.
    const from = new Date("2027-11-06T12:00:00.000Z");
    const next = computeNextRunAt({ frequency: "DAILY", timeOfDay: "01:30", timezone: "America/New_York" }, from);
    expect(next.toISOString()).toBe("2027-11-07T05:30:00.000Z"); // 01:30 EDT (UTC-4), the first occurrence
  });
});
