import { z } from "zod";

export const EVENT_COLORS = ["blue", "green", "red", "orange", "purple", "gray"] as const;
export type EventColor = (typeof EVENT_COLORS)[number];
export const EVENT_COLOR_LABEL: Record<EventColor, string> = { blue: "파랑", green: "초록", red: "빨강", orange: "주황", purple: "보라", gray: "회색" };

export const EVENT_CATEGORIES = ["GENERAL", "MARKETING", "MEETING", "DEADLINE", "PERSONAL"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export const EVENT_CATEGORY_LABEL: Record<EventCategory, string> = { GENERAL: "일반", MARKETING: "마케팅", MEETING: "미팅", DEADLINE: "마감", PERSONAL: "개인" };
/** A category suggests a colour so new events are readable at a glance; the owner can still pick any colour. */
export const EVENT_CATEGORY_COLOR: Record<EventCategory, EventColor> = { GENERAL: "blue", MARKETING: "purple", MEETING: "green", DEADLINE: "red", PERSONAL: "orange" };

export const EVENT_TITLE_MAX = 200;
export const EVENT_DESCRIPTION_MAX = 4_000;
/** A user's calendar is a personal schedule; this guards against runaway imports/scripts. */
export const MAX_EVENTS_PER_USER = 3_000;

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식이 올바르지 않아요.");
const dateTimeText = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, "날짜와 시간 형식이 올바르지 않아요.");

export const recurrenceSchema = z.object({
  freq: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  interval: z.number().int().min(1).max(52).default(1),
  /** WEEKLY: 0 (Sunday) – 6 (Saturday). */
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  until: dateText.optional(),
  count: z.number().int().min(1).max(500).optional(),
});
export type RecurrenceInput = z.infer<typeof recurrenceSchema>;

/**
 * What the form (or a drag on the calendar) sends. Times are Seoul wall-clock text. For an all-day event
 * `start`/`end` are dates and `end` is exclusive (the day after the last day), the way the calendar widget reports it.
 */
export const calendarEventInputSchema = z
  .object({
    title: z.string().trim().min(1, "제목을 입력해주세요.").max(EVENT_TITLE_MAX, `제목은 ${EVENT_TITLE_MAX}자 이하로 입력해주세요.`),
    description: z.string().trim().max(EVENT_DESCRIPTION_MAX, `설명은 ${EVENT_DESCRIPTION_MAX}자 이하로 입력해주세요.`).optional(),
    allDay: z.boolean(),
    start: z.union([dateText, dateTimeText]),
    end: z.union([dateText, dateTimeText]),
    color: z.enum(EVENT_COLORS).default("blue"),
    category: z.enum(EVENT_CATEGORIES).default("GENERAL"),
    recurrence: recurrenceSchema.nullable().default(null),
  })
  .superRefine((value, ctx) => {
    const expectedLength = value.allDay ? 10 : 16;
    if (value.start.length < expectedLength || (value.allDay && value.start.length !== 10) || (value.allDay && value.end.length !== 10)) {
      ctx.addIssue({ code: "custom", path: ["start"], message: value.allDay ? "종일 일정은 날짜만 입력해주세요." : "시작 날짜와 시간을 입력해주세요." });
      return;
    }
    if (!value.allDay && (value.start.length < 16 || value.end.length < 16)) {
      ctx.addIssue({ code: "custom", path: ["end"], message: "시작과 종료의 날짜와 시간을 입력해주세요." });
      return;
    }
    if (value.allDay ? value.end <= value.start : value.end < value.start) {
      ctx.addIssue({ code: "custom", path: ["end"], message: "종료가 시작보다 빠를 수 없어요." });
    }
    if (value.recurrence?.until && value.recurrence.count) {
      ctx.addIssue({ code: "custom", path: ["recurrence"], message: "반복 종료는 날짜 또는 횟수 중 하나만 정해주세요." });
    }
    if (value.recurrence?.until && value.recurrence.until < value.start.slice(0, 10)) {
      ctx.addIssue({ code: "custom", path: ["recurrence"], message: "반복 종료일이 첫 일정보다 빠를 수 없어요." });
    }
  });
export type CalendarEventInput = z.infer<typeof calendarEventInputSchema>;

/** "this one" or "the whole series" when changing a repeating event. */
export type EditScope = "THIS" | "ALL";

/** What the screen draws. Times are Seoul wall-clock (all-day: dates, `end` exclusive). */
export interface CalendarEventView {
  occurrenceId: string;
  eventId: string;
  seriesId: string | null;
  occurrenceDate: string;
  isRecurring: boolean;
  title: string;
  description: string | null;
  start: string;
  end: string;
  allDay: boolean;
  color: EventColor;
  category: EventCategory;
  /** The series' repeat rule (present on every occurrence of a series). */
  recurrence: RecurrenceInput | null;
}

export interface CalendarSearchHit {
  eventId: string;
  title: string;
  /** Seoul date to jump to. */
  date: string;
  allDay: boolean;
  isRecurring: boolean;
}
