import { describe, expect, it } from "vitest";
import { describeSchedule, parseScheduleFromForm } from "./schedule-input";

function form(entries: Array<[string, string]>) {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("parseScheduleFromForm", () => {
  it("parses DAILY, WEEKLY and MONTHLY", () => {
    expect(parseScheduleFromForm(form([["frequency", "DAILY"], ["timeOfDay", "18:30"]]))).toEqual({ frequency: "DAILY", timeOfDay: "18:30" });
    expect(parseScheduleFromForm(form([["frequency", "WEEKLY"], ["timeOfDay", "09:00"], ["daysOfWeek", "1"], ["daysOfWeek", "1"], ["daysOfWeek", "3"]])))
      .toEqual({ frequency: "WEEKLY", timeOfDay: "09:00", daysOfWeek: [1, 3] });
    expect(parseScheduleFromForm(form([["frequency", "MONTHLY"], ["timeOfDay", "09:00"], ["dayOfMonth", "15"]]), "Asia/Seoul"))
      .toEqual({ frequency: "MONTHLY", timeOfDay: "09:00", timezone: "Asia/Seoul", dayOfMonth: 15 });
  });

  it("rejects values the scheduler could not use", () => {
    expect(parseScheduleFromForm(form([["frequency", "HOURLY"], ["timeOfDay", "09:00"]]))).toBeNull();
    expect(parseScheduleFromForm(form([["frequency", "DAILY"], ["timeOfDay", "25:00"]]))).toBeNull();
    expect(parseScheduleFromForm(form([["frequency", "WEEKLY"], ["timeOfDay", "09:00"]]))).toBeNull();
    expect(parseScheduleFromForm(form([["frequency", "WEEKLY"], ["timeOfDay", "09:00"], ["daysOfWeek", "7"]]))).toBeNull();
    expect(parseScheduleFromForm(form([["frequency", "MONTHLY"], ["timeOfDay", "09:00"], ["dayOfMonth", "0"]]))).toBeNull();
    expect(parseScheduleFromForm(form([["frequency", "MONTHLY"], ["timeOfDay", "09:00"]]))).toBeNull();
  });
});

describe("describeSchedule", () => {
  it("describes each frequency in Korean", () => {
    expect(describeSchedule({ frequency: "DAILY", timeOfDay: "09:00" })).toBe("매일 09:00");
    expect(describeSchedule({ frequency: "WEEKLY", daysOfWeek: [1, 3, 5], timeOfDay: "09:00" })).toBe("매주 월·수·금요일 09:00");
    expect(describeSchedule({ frequency: "MONTHLY", dayOfMonth: 15, timeOfDay: "10:00" })).toBe("매월 15일 10:00");
  });
});
