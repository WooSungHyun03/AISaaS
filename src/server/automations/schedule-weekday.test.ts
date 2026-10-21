import { describe, expect, it } from "vitest";
import { computeNextRunAt, planDueClaim } from "./scheduler";
import { parseScheduleFromForm } from "./schedule-input";
import { getZonedParts } from "@/lib/utils/date";
import type { AutomationSchedule } from "@/types/automation";

const KST = "Asia/Seoul";
const kstWeekday = (date: Date) => {
  const parts = getZonedParts(date, KST);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
};
const kstClock = (date: Date) => {
  const parts = getZonedParts(date, KST);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
};
const NAMES = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * Plays a scheduler forward the way the cron does: every tick takes the due slot with planDueClaim (the same function the
 * database claim uses) and produces content unless the slot was missed for too long. Returns when content is produced.
 */
function simulate(schedule: AutomationSchedule, start: Date, until: Date, options: { downBetween?: [Date, Date] } = {}): Date[] {
  const produced: Date[] = [];
  let nextRunAt = computeNextRunAt(schedule, start);
  for (let now = new Date(start.getTime()); now < until; now = new Date(now.getTime() + 5 * 60_000)) {
    if (options.downBetween && now >= options.downBetween[0] && now < options.downBetween[1]) continue; // scheduler is down
    if (nextRunAt.getTime() > now.getTime()) continue;
    const plan = planDueClaim(schedule, nextRunAt.toISOString(), now);
    nextRunAt = plan.next;
    if (!plan.skip) produced.push(now);
  }
  return produced;
}

describe("weekly schedules run on the weekday the owner picked (KST)", () => {
  for (let day = 0; day < 7; day++) {
    it(`every ${NAMES[day]}요일 09:00 → the next run is a ${NAMES[day]}요일 09:00 KST, from any moment of the week`, () => {
      const schedule: AutomationSchedule = { frequency: "WEEKLY", daysOfWeek: [day], timeOfDay: "09:00", timezone: KST };
      // from every 7 hours across two weeks, including KST midnight boundaries
      for (let hours = 0; hours < 24 * 14; hours += 7) {
        const from = new Date(Date.UTC(2026, 9, 5, 0, 0) + hours * 3_600_000);
        const next = computeNextRunAt(schedule, from);
        expect(kstWeekday(next), `from ${from.toISOString()}`).toBe(day);
        expect(kstClock(next)).toBe("09:00");
        expect(next.getTime()).toBeGreaterThan(from.getTime());
        expect(next.getTime() - from.getTime()).toBeLessThanOrEqual(7 * 86_400_000);
      }
    });
  }

  it("does not move a late-night slot to the next day when UTC and KST dates differ (00:30 KST is the previous UTC day)", () => {
    // Wednesday 00:30 KST = Tuesday 15:30 UTC
    const schedule: AutomationSchedule = { frequency: "WEEKLY", daysOfWeek: [3], timeOfDay: "00:30", timezone: KST };
    const next = computeNextRunAt(schedule, new Date("2026-10-19T12:00:00.000Z")); // Mon 21:00 KST
    expect(next.toISOString()).toBe("2026-10-20T15:30:00.000Z");
    expect(kstWeekday(next)).toBe(3);
    // 23:30 KST on Tuesday is already Tuesday evening in UTC too, but the weekday must still be the KST one
    const evening = computeNextRunAt({ frequency: "WEEKLY", daysOfWeek: [2], timeOfDay: "23:30", timezone: KST }, new Date("2026-10-19T12:00:00.000Z"));
    expect(evening.toISOString()).toBe("2026-10-20T14:30:00.000Z");
    expect(kstWeekday(evening)).toBe(2);
  });

  it("a multi-day selection runs on exactly those days and on no other day, over eight weeks", () => {
    const schedule: AutomationSchedule = { frequency: "WEEKLY", daysOfWeek: [1, 3, 5], timeOfDay: "09:00", timezone: KST };
    const runs = simulate(schedule, new Date("2026-10-05T00:00:00.000Z"), new Date("2026-11-30T00:00:00.000Z"));
    const weekdays = new Set(runs.map(kstWeekday));
    expect([...weekdays].sort()).toEqual([1, 3, 5]);
    // never twice on the same KST date, always at the 5-minute tick right after 09:00 KST
    const dates = runs.map((run) => run.toISOString().slice(0, 10));
    expect(new Set(dates).size).toBe(dates.length);
    expect(runs.every((run) => kstClock(run) === "09:00")).toBe(true);
    // the start is the Monday slot itself (not "after" it): Wed + Fri of week one, then 7 full weeks
    expect(runs).toHaveLength(2 + 7 * 3);
  });

  it("DAILY and a selection of all seven days behave the same", () => {
    const start = new Date("2026-10-05T00:00:00.000Z");
    const end = new Date("2026-10-19T00:00:00.000Z");
    const daily = simulate({ frequency: "DAILY", timeOfDay: "09:00", timezone: KST }, start, end).map((d) => d.toISOString());
    const all = simulate({ frequency: "WEEKLY", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], timeOfDay: "09:00", timezone: KST }, start, end).map((d) => d.toISOString());
    expect(all).toEqual(daily);
    expect(daily).toHaveLength(13); // the start instant is itself the first slot (09:00 KST), which is not "after" it
  });
});

describe("the scheduler being down", () => {
  const schedule: AutomationSchedule = { frequency: "WEEKLY", daysOfWeek: [1, 3, 5], timeOfDay: "09:00", timezone: KST };
  const start = new Date("2026-10-05T00:00:00.000Z");
  const end = new Date("2026-10-19T00:00:00.000Z");

  it("makes up for a slot missed by an outage of a few hours exactly once", () => {
    // Monday 2026-10-12 09:00 KST = 00:00 UTC; the scheduler is down from 23:00 UTC (Sun) to 03:00 UTC Mon
    const down: [Date, Date] = [new Date("2026-10-11T23:00:00.000Z"), new Date("2026-10-12T03:00:00.000Z")];
    const runs = simulate(schedule, start, end, { downBetween: down });
    const monday = runs.filter((run) => run.toISOString().startsWith("2026-10-12"));
    expect(monday).toHaveLength(1);
    expect(monday[0].toISOString()).toBe("2026-10-12T03:00:00.000Z"); // first tick after it came back
    // the other slots are untouched: Wed + Fri of week one, Mon (made up) + Wed + Fri of week two
    expect(runs.map((run) => run.toISOString().slice(0, 10))).toEqual(["2026-10-07", "2026-10-09", "2026-10-12", "2026-10-14", "2026-10-16"]);
  });

  it("skips a slot missed by more than 12 hours, and a long outage never turns into a burst of back-dated runs", () => {
    // down from Tue 10-13 00:00 UTC to Fri 10-16 00:00 UTC: the Wednesday slot (10-14) is 48 h old when the scheduler returns
    const down: [Date, Date] = [new Date("2026-10-13T00:00:00.000Z"), new Date("2026-10-16T00:00:00.000Z")];
    const runs = simulate(schedule, start, end, { downBetween: down }).map((run) => run.toISOString());
    // Wed 10-14 is skipped (not run late on a Friday). Friday's own slot is not eaten by the skip: it runs at the next tick.
    expect(runs).toEqual(["2026-10-07T00:00:00.000Z", "2026-10-09T00:00:00.000Z", "2026-10-12T00:00:00.000Z", "2026-10-16T00:05:00.000Z"]);
  });

  it("an outage that ends well before the next slot only skips the old one", () => {
    const down: [Date, Date] = [new Date("2026-10-13T00:00:00.000Z"), new Date("2026-10-15T12:00:00.000Z")];
    const runs = simulate(schedule, start, end, { downBetween: down }).map((run) => run.toISOString().slice(0, 10));
    expect(runs).toEqual(["2026-10-07", "2026-10-09", "2026-10-12", "2026-10-16"]);
  });
});

describe("the weekday picker's form fields reach the scheduler unchanged", () => {
  it("stores the picked days (Sunday = 0 … Saturday = 6), once each, with the KST timezone", () => {
    const form = new FormData();
    form.set("frequency", "WEEKLY");
    form.set("timeOfDay", "18:30");
    for (const day of ["6", "0", "6", "3"]) form.append("daysOfWeek", day);
    expect(parseScheduleFromForm(form, KST)).toEqual({ frequency: "WEEKLY", timeOfDay: "18:30", timezone: KST, daysOfWeek: [6, 0, 3] });
  });

  it("refuses a weekly schedule with no day, an out-of-range day, or a bad time (nothing unschedulable is stored)", () => {
    const base = (days: string[], time = "09:00") => {
      const form = new FormData();
      form.set("frequency", "WEEKLY");
      form.set("timeOfDay", time);
      for (const day of days) form.append("daysOfWeek", day);
      return parseScheduleFromForm(form);
    };
    expect(base([])).toBeNull();
    expect(base(["7"])).toBeNull();
    expect(base(["1"], "24:00")).toBeNull();
    expect(base(["1"], "9:00")).toBeNull();
  });
});
