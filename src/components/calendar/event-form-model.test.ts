import { describe, expect, it } from "vitest";
import { calendarEventInputSchema, type CalendarEventView } from "@/types/calendar-events";
import { describeRecurrence, toInput, valuesForNew, valuesFromView } from "./event-form-model";

const view: CalendarEventView = {
  occurrenceId: "e1:2026-10-12",
  eventId: "e1",
  seriesId: "e1",
  occurrenceDate: "2026-10-12",
  isRecurring: true,
  title: "주간 회의",
  description: "안건 정리",
  start: "2026-10-12T10:00:00",
  end: "2026-10-12T11:30:00",
  allDay: false,
  color: "green",
  category: "MEETING",
  recurrence: { freq: "WEEKLY", interval: 2, weekdays: [1, 3], until: "2026-12-31" },
};

describe("event form model", () => {
  it("starts a new timed event at the clicked time and runs it for an hour", () => {
    const values = valuesForNew("2026-10-11T14:30:00");
    expect(values).toMatchObject({ startDate: "2026-10-11", startTime: "14:30", endDate: "2026-10-11", endTime: "15:30", allDay: false, repeat: "NONE" });
    expect(values.weekdays).toEqual([0]); // Sunday
  });

  it("never runs past midnight when started late in the evening", () => {
    expect(valuesForNew("2026-10-11T23:30:00")).toMatchObject({ endDate: "2026-10-11", endTime: "23:59" });
  });

  it("turns a dragged all-day selection (end exclusive) into an inclusive last day", () => {
    const values = valuesForNew("2026-10-11", "2026-10-14", true);
    expect(values).toMatchObject({ allDay: true, startDate: "2026-10-11", endDate: "2026-10-13" });
    expect(toInput({ ...values, title: "출장" })).toMatchObject({ allDay: true, start: "2026-10-11", end: "2026-10-14" });
  });

  it("round-trips an existing repeating event through the form unchanged", () => {
    const input = toInput(valuesFromView(view));
    expect(input).toEqual({
      title: "주간 회의",
      description: "안건 정리",
      allDay: false,
      start: "2026-10-12T10:00",
      end: "2026-10-12T11:30",
      color: "green",
      category: "MEETING",
      recurrence: { freq: "WEEKLY", interval: 2, weekdays: [1, 3], until: "2026-12-31" },
    });
    expect(calendarEventInputSchema.safeParse(input).success).toBe(true);
  });

  it("builds input that the shared schema accepts, and rejects what it should", () => {
    const ok = toInput({ ...valuesForNew("2026-10-11T09:00:00"), title: "점심" });
    expect(calendarEventInputSchema.safeParse(ok).success).toBe(true);
    expect(calendarEventInputSchema.safeParse({ ...ok, title: "   " }).success).toBe(false);
    expect(calendarEventInputSchema.safeParse({ ...ok, end: "2026-10-11T08:00" }).success).toBe(false);
    expect(calendarEventInputSchema.safeParse({ ...ok, recurrence: { freq: "DAILY", interval: 1, until: "2026-10-01" } }).success).toBe(false);
    expect(calendarEventInputSchema.safeParse({ ...ok, recurrence: { freq: "DAILY", interval: 1, until: "2026-12-01", count: 4 } }).success).toBe(false);
    expect(calendarEventInputSchema.safeParse({ ...ok, allDay: true, start: "2026-10-11", end: "2026-10-11" }).success).toBe(false);
  });

  it("describes repeats the way people say them", () => {
    expect(describeRecurrence("DAILY", 1)).toBe("매일");
    expect(describeRecurrence("WEEKLY", 2, [1, 3])).toBe("2주마다 월·수");
    expect(describeRecurrence("MONTHLY", 3)).toBe("3개월마다");
  });

  it("keeps a repeat count through the form", () => {
    const counted = { ...view, recurrence: { freq: "DAILY" as const, interval: 1, count: 4 } };
    const values = valuesFromView(counted);
    expect(values).toMatchObject({ endMode: "COUNT", count: 4 });
    expect(toInput(values).recurrence).toEqual({ freq: "DAILY", interval: 1, count: 4 });
  });
});
