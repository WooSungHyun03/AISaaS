import { describe, expect, it } from "vitest";
import { parseEventInput, timesOf, toView } from "./events";
import { expandEvents, kstWallToInstant, type CalendarEventRow } from "./recurrence";

const base = { title: "회의", allDay: false, start: "2026-10-05T10:00", end: "2026-10-05T11:00", color: "blue", category: "GENERAL", recurrence: null };

describe("parseEventInput", () => {
  it("accepts a normal event and a repeating one", () => {
    expect(parseEventInput(base).ok).toBe(true);
    expect(parseEventInput({ ...base, recurrence: { freq: "WEEKLY", interval: 2, weekdays: [1, 3] } }).ok).toBe(true);
  });

  it("explains what is wrong in Korean, one thing at a time", () => {
    const message = (value: unknown) => {
      const result = parseEventInput(value);
      return result.ok ? "" : result.error;
    };
    expect(message({ ...base, title: "  " })).toContain("제목");
    expect(message({ ...base, title: "가".repeat(201) })).toContain("200자");
    expect(message({ ...base, end: "2026-10-05T09:00" })).toContain("종료");
    expect(message({ ...base, start: "2026-02-30T10:00", end: "2026-02-30T11:00" })).toContain("존재하지 않는");
    expect(message({ ...base, allDay: true, start: "2026-10-05T10:00", end: "2026-10-06" })).toContain("종일");
    expect(message({ ...base, color: "pink" })).not.toBe("");
    expect(message({ ...base, start: "2026-10-05T10:00", end: "2028-10-05T10:00" })).toContain("1년");
    expect(message(null)).not.toBe("");
  });
});

describe("storing times", () => {
  it("stores Seoul wall-clock times as UTC instants", () => {
    expect(timesOf({ allDay: false, start: "2026-10-05T10:00", end: "2026-10-05T11:30" })).toEqual({ starts_at: "2026-10-05T01:00:00.000Z", ends_at: "2026-10-05T02:30:00.000Z" });
  });

  it("stores an all-day event as Seoul midnights with the end the day after the last day", () => {
    expect(timesOf({ allDay: true, start: "2026-10-05", end: "2026-10-07" })).toEqual({ starts_at: "2026-10-04T15:00:00.000Z", ends_at: "2026-10-06T15:00:00.000Z" });
  });
});

describe("toView", () => {
  const row: CalendarEventRow = {
    id: "s1",
    user_id: "u1",
    title: "스탠드업",
    description: null,
    starts_at: "2026-10-05T00:30:00.000Z",
    ends_at: "2026-10-05T01:00:00.000Z",
    all_day: false,
    color: "green",
    category: "MEETING",
    recur_freq: "DAILY",
    recur_interval: 1,
    recur_weekdays: null,
    recur_until: "2026-10-30",
    recur_count: null,
    exdates: [],
    series_id: null,
    original_date: null,
  };

  it("hands the screen Seoul wall-clock text and the series' repeat rule", () => {
    const [occurrence] = expandEvents([row], { start: kstWallToInstant("2026-10-07T00:00"), end: kstWallToInstant("2026-10-08T00:00") });
    expect(toView(occurrence, row)).toMatchObject({
      occurrenceId: "s1:2026-10-07",
      eventId: "s1",
      start: "2026-10-07T09:30:00",
      end: "2026-10-07T10:00:00",
      isRecurring: true,
      recurrence: { freq: "DAILY", interval: 1, until: "2026-10-30" },
      color: "green",
      category: "MEETING",
    });
  });

  it("gives all-day events as plain dates", () => {
    const allDay = { ...row, recur_freq: null, all_day: true, starts_at: "2026-10-04T15:00:00.000Z", ends_at: "2026-10-05T15:00:00.000Z" } as CalendarEventRow;
    const [occurrence] = expandEvents([allDay], { start: kstWallToInstant("2026-10-05T00:00"), end: kstWallToInstant("2026-10-06T00:00") });
    expect(toView(occurrence, undefined)).toMatchObject({ allDay: true, start: "2026-10-05", end: "2026-10-06", recurrence: null });
  });
});
