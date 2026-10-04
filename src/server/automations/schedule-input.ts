import type { AutomationSchedule } from "@/types/automation";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Parses the schedule fields every "how often / when" form submits
 * (frequency, timeOfDay, daysOfWeek[], dayOfMonth). Returns null for
 * anything the scheduler could not compute a next run from, so a request
 * that bypasses the UI can't store a schedule that later throws in cron.
 */
export function parseScheduleFromForm(formData: FormData, timezone?: string): AutomationSchedule | null {
  const frequency = String(formData.get("frequency") ?? "");
  const timeOfDay = String(formData.get("timeOfDay") ?? "09:00");
  if (!TIME_PATTERN.test(timeOfDay)) return null;
  const base = { timeOfDay, ...(timezone ? { timezone } : {}) };

  if (frequency === "DAILY") return { frequency, ...base };

  if (frequency === "WEEKLY") {
    const daysOfWeek = formData.getAll("daysOfWeek").map((value) => Number(value));
    if (daysOfWeek.length === 0 || daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return null;
    return { frequency, ...base, daysOfWeek: [...new Set(daysOfWeek)] };
  }

  if (frequency === "MONTHLY") {
    const dayOfMonth = Number(formData.get("dayOfMonth"));
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return null;
    return { frequency, ...base, dayOfMonth };
  }

  return null;
}

const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

/** Korean one-line description of a schedule, e.g. "매주 월·수·금요일 09:00". */
export function describeSchedule(schedule: Pick<AutomationSchedule, "frequency" | "daysOfWeek" | "dayOfMonth" | "timeOfDay"> | null | undefined): string {
  if (!schedule) return "일정 없음";
  if (schedule.frequency === "WEEKLY") {
    return `매주 ${(schedule.daysOfWeek ?? []).map((day) => WEEKDAY_LABEL[day]).join("·")}요일 ${schedule.timeOfDay}`;
  }
  if (schedule.frequency === "MONTHLY") return `매월 ${schedule.dayOfMonth}일 ${schedule.timeOfDay}`;
  return `매일 ${schedule.timeOfDay}`;
}
