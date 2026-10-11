import {
  EVENT_CATEGORY_COLOR,
  type CalendarEventInput,
  type CalendarEventView,
  type EventCategory,
  type EventColor,
} from "@/types/calendar-events";

/** The event form's fields as the inputs hold them (date and time apart, repeat flattened). */
export interface EditorValues {
  title: string;
  description: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  /** All-day: the LAST day (inclusive, what people think of); the stored end is the day after. */
  endDate: string;
  endTime: string;
  category: EventCategory;
  color: EventColor;
  repeat: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
  weekdays: number[];
  endMode: "NEVER" | "UNTIL" | "COUNT";
  until: string;
  /** Total number of occurrences of the series (COUNT). */
  count: number;
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** A new event starting at `startWall` ("YYYY-MM-DD" or "YYYY-MM-DDTHH:mm…"); timed events default to one hour. */
export function valuesForNew(startWall: string, endWall?: string, allDay = false): EditorValues {
  const startDate = startWall.slice(0, 10);
  const startTime = allDay ? "09:00" : startWall.length >= 16 ? startWall.slice(11, 16) : "09:00";
  let endDate = startDate;
  let endTime = addHour(startTime);
  if (endWall) {
    endDate = allDay ? addDays(endWall.slice(0, 10), -1) : endWall.slice(0, 10);
    if (!allDay && endWall.length >= 16) endTime = endWall.slice(11, 16);
  }
  if (allDay && endDate < startDate) endDate = startDate;
  return {
    title: "",
    description: "",
    allDay,
    startDate,
    startTime,
    endDate: !allDay && !endWall && endTime < startTime ? startDate : endDate,
    endTime,
    category: "GENERAL",
    color: EVENT_CATEGORY_COLOR.GENERAL,
    repeat: "NONE",
    interval: 1,
    weekdays: [weekdayOf(startDate)],
    endMode: "NEVER",
    until: "",
    count: 10,
  };
}

function addHour(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  return `${String(Math.min(hour + 1, 23)).padStart(2, "0")}:${String(hour + 1 > 23 ? 59 : minute).padStart(2, "0")}`;
}

export function valuesFromView(view: CalendarEventView): EditorValues {
  const recurrence = view.recurrence;
  const startDate = view.start.slice(0, 10);
  return {
    title: view.title,
    description: view.description ?? "",
    allDay: view.allDay,
    startDate,
    startTime: view.allDay ? "09:00" : view.start.slice(11, 16),
    endDate: view.allDay ? addDays(view.end.slice(0, 10), -1) : view.end.slice(0, 10),
    endTime: view.allDay ? "10:00" : view.end.slice(11, 16),
    category: view.category,
    color: view.color,
    repeat: recurrence?.freq ?? "NONE",
    interval: recurrence?.interval ?? 1,
    weekdays: recurrence?.weekdays && recurrence.weekdays.length > 0 ? recurrence.weekdays : [weekdayOf(startDate)],
    endMode: recurrence?.until ? "UNTIL" : recurrence?.count ? "COUNT" : "NEVER",
    until: recurrence?.until ?? "",
    count: recurrence?.count ?? 10,
  };
}

/** What gets validated and sent: all-day becomes "dates, end exclusive", timed becomes Seoul wall-clock text. */
export function toInput(values: EditorValues): CalendarEventInput {
  const start = values.allDay ? values.startDate : `${values.startDate}T${values.startTime}`;
  const end = values.allDay ? addDays(values.endDate, 1) : `${values.endDate}T${values.endTime}`;
  return {
    title: values.title,
    description: values.description || undefined,
    allDay: values.allDay,
    start,
    end,
    color: values.color,
    category: values.category,
    recurrence: values.repeat === "NONE"
      ? null
      : {
        freq: values.repeat,
        interval: values.interval,
        ...(values.repeat === "WEEKLY" && values.weekdays.length > 0 ? { weekdays: [...new Set(values.weekdays)].sort() } : {}),
        ...(values.endMode === "UNTIL" && values.until ? { until: values.until } : {}),
        ...(values.endMode === "COUNT" ? { count: values.count } : {}),
      },
  };
}

/** "매일", "2주마다 월·수", "3개월마다" — the repeat as it reads in a list. */
export function describeRecurrence(freq: "DAILY" | "WEEKLY" | "MONTHLY", interval: number, weekdays?: number[]): string {
  const names = ["일", "월", "화", "수", "목", "금", "토"];
  const unit = freq === "DAILY" ? "일" : freq === "WEEKLY" ? "주" : "개월";
  const every = interval === 1 ? (freq === "DAILY" ? "매일" : freq === "WEEKLY" ? "매주" : "매월") : `${interval}${unit}마다`;
  return freq === "WEEKLY" && weekdays && weekdays.length > 0 ? `${every} ${weekdays.map((day) => names[day]).join("·")}` : every;
}
