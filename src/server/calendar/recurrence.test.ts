import { describe, expect, it } from "vitest";
import {
  addDays,
  expandEvents,
  instantToKstWall,
  isValidDateString,
  kstDateOf,
  kstWallToInstant,
  nextOccurrenceDate,
  seriesDates,
  type CalendarEventRow,
} from "./recurrence";

function event(overrides: Partial<CalendarEventRow> = {}): CalendarEventRow {
  return {
    id: "e1",
    user_id: "u1",
    title: "회의",
    description: null,
    starts_at: "2026-10-05T01:00:00.000Z", // Mon 10:00 KST
    ends_at: "2026-10-05T02:00:00.000Z",
    all_day: false,
    color: "blue",
    category: "GENERAL",
    recur_freq: null,
    recur_interval: 1,
    recur_weekdays: null,
    recur_until: null,
    recur_count: null,
    exdates: [],
    series_id: null,
    original_date: null,
    ...overrides,
  };
}

const range = (start: string, end: string) => ({ start: kstWallToInstant(start), end: kstWallToInstant(end) });

describe("Seoul time helpers", () => {
  it("reads wall-clock text as Seoul time and prints it back", () => {
    expect(kstWallToInstant("2026-10-05T10:00").toISOString()).toBe("2026-10-05T01:00:00.000Z");
    expect(kstWallToInstant("2026-10-05").toISOString()).toBe("2026-10-04T15:00:00.000Z");
    expect(instantToKstWall("2026-10-05T01:00:00.000Z")).toBe("2026-10-05T10:00:00");
  });

  it("puts an instant on the right Seoul day even near midnight", () => {
    expect(kstDateOf("2026-10-04T15:00:00.000Z")).toBe("2026-10-05"); // 00:00 KST
    expect(kstDateOf("2026-10-04T14:59:59.000Z")).toBe("2026-10-04"); // 23:59:59 KST
  });

  it("validates real calendar dates only", () => {
    expect(isValidDateString("2026-02-28")).toBe(true);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-13-01")).toBe(false);
    expect(isValidDateString("26-1-1")).toBe(false);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("seriesDates", () => {
  it("repeats daily with an interval and stops at the until date (inclusive)", () => {
    const dates = seriesDates(event({ recur_freq: "DAILY", recur_interval: 2, recur_until: "2026-10-11" }), "2026-12-31");
    expect(dates).toEqual(["2026-10-05", "2026-10-07", "2026-10-09", "2026-10-11"]);
  });

  it("repeats weekly on chosen weekdays, never before the first day, every n weeks", () => {
    // Mon 10-05 start; Mon(1), Wed(3), Fri(5); every 2 weeks
    const dates = seriesDates(event({ recur_freq: "WEEKLY", recur_interval: 2, recur_weekdays: [5, 1, 3] }), "2026-10-31");
    expect(dates).toEqual(["2026-10-05", "2026-10-07", "2026-10-09", "2026-10-19", "2026-10-21", "2026-10-23"]);
    // started on a Wednesday: the Monday of that week is not an occurrence
    expect(seriesDates(event({ starts_at: "2026-10-07T01:00:00.000Z", ends_at: "2026-10-07T02:00:00.000Z", recur_freq: "WEEKLY", recur_weekdays: [1, 3] }), "2026-10-14")).toEqual(["2026-10-07", "2026-10-12", "2026-10-14"]);
  });

  it("defaults a weekly repeat to the weekday it started on", () => {
    expect(seriesDates(event({ recur_freq: "WEEKLY" }), "2026-10-26")).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
  });

  it("repeats monthly on the same day number, using the last day of a shorter month", () => {
    const jan31 = event({ starts_at: "2026-01-31T01:00:00.000Z", ends_at: "2026-01-31T02:00:00.000Z", recur_freq: "MONTHLY" });
    expect(seriesDates(jan31, "2026-05-31")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
    expect(seriesDates({ ...jan31, recur_interval: 3 }, "2026-12-31")).toEqual(["2026-01-31", "2026-04-30", "2026-07-31", "2026-10-31"]);
  });

  it("honours a count and caps runaway series", () => {
    expect(seriesDates(event({ recur_freq: "DAILY", recur_count: 3 }), "2030-01-01")).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
    expect(seriesDates(event({ recur_freq: "DAILY" }), "2099-01-01").length).toBe(1_000);
  });
});

describe("expandEvents", () => {
  it("returns single events that overlap the window and drops the rest", () => {
    const rows = [event(), event({ id: "e2", starts_at: "2026-11-05T01:00:00.000Z", ends_at: "2026-11-05T02:00:00.000Z" })];
    const result = expandEvents(rows, range("2026-10-01T00:00", "2026-11-01T00:00"));
    expect(result.map((item) => item.occurrenceId)).toEqual(["e1"]);
  });

  it("includes an event that began before the window but still runs into it", () => {
    const overnight = event({ starts_at: "2026-10-04T14:00:00.000Z", ends_at: "2026-10-05T02:00:00.000Z" });
    expect(expandEvents([overnight], range("2026-10-05T00:00", "2026-10-06T00:00"))).toHaveLength(1);
  });

  it("expands a weekly series into its dates inside the window, keeping the Seoul time of day", () => {
    const series = event({ recur_freq: "WEEKLY" });
    const result = expandEvents([series], range("2026-10-12T00:00", "2026-10-26T00:00"));
    expect(result.map((item) => item.occurrenceDate)).toEqual(["2026-10-12", "2026-10-19"]);
    expect(result.map((item) => instantToKstWall(item.startsAt))).toEqual(["2026-10-12T10:00:00", "2026-10-19T10:00:00"]);
    expect(result.every((item) => item.isRecurring && item.eventId === "e1" && item.seriesId === "e1")).toBe(true);
    expect(result[0].occurrenceId).toBe("e1:2026-10-12");
  });

  it("skips deleted days and shows a changed day through its replacement row", () => {
    const series = event({ recur_freq: "DAILY", exdates: ["2026-10-06", "2026-10-07"] });
    const replacement = event({
      id: "r1",
      title: "회의(시간 변경)",
      starts_at: "2026-10-07T05:00:00.000Z",
      ends_at: "2026-10-07T06:00:00.000Z",
      series_id: "e1",
      original_date: "2026-10-07",
    });
    const result = expandEvents([series, replacement], range("2026-10-05T00:00", "2026-10-09T00:00"));
    expect(result.map((item) => `${item.occurrenceId}`)).toEqual(["e1:2026-10-05", "r1", "e1:2026-10-08"]);
    const changed = result.find((item) => item.occurrenceId === "r1")!;
    expect(changed).toMatchObject({ seriesId: "e1", occurrenceDate: "2026-10-07", isRecurring: false, title: "회의(시간 변경)" });
  });

  it("keeps all-day events whole", () => {
    const allDay = event({ all_day: true, starts_at: "2026-10-04T15:00:00.000Z", ends_at: "2026-10-06T15:00:00.000Z" }); // Oct 5-6 inclusive
    const result = expandEvents([allDay], range("2026-10-06T00:00", "2026-10-07T00:00"));
    expect(result).toHaveLength(1);
    expect(result[0].allDay).toBe(true);
    expect(expandEvents([allDay], range("2026-10-07T00:00", "2026-10-08T00:00"))).toHaveLength(0);
  });

  it("sorts by start time", () => {
    const later = event({ id: "later", starts_at: "2026-10-05T08:00:00.000Z", ends_at: "2026-10-05T09:00:00.000Z" });
    expect(expandEvents([later, event()], range("2026-10-05T00:00", "2026-10-06T00:00")).map((item) => item.eventId)).toEqual(["e1", "later"]);
  });
});

describe("nextOccurrenceDate", () => {
  it("finds the next repeat that has not been deleted", () => {
    const series = event({ recur_freq: "DAILY", exdates: ["2026-10-12"] });
    expect(nextOccurrenceDate(series, kstWallToInstant("2026-10-12T00:00"))).toBe("2026-10-13");
  });

  it("returns the single event's own date, and null once a finite series is over", () => {
    expect(nextOccurrenceDate(event(), new Date())).toBe("2026-10-05");
    expect(nextOccurrenceDate(event({ recur_freq: "DAILY", recur_until: "2026-10-07" }), kstWallToInstant("2026-10-20T00:00"))).toBeNull();
  });
});
