/**
 * Calendar events and their repeats, computed on Seoul calendar dates. Pure functions (no I/O) so the rules
 * are the same wherever they run and easy to test. Korea has no daylight saving, so adding whole days to a
 * Seoul wall-clock time is always exactly 24 hours.
 */
export const KST_OFFSET_MS = 9 * 3_600_000;
export const DAY_MS = 86_400_000;
/** One series never produces more occurrences than this in a single query. */
const MAX_OCCURRENCES_PER_SERIES = 1_000;

export type RecurFreq = "DAILY" | "WEEKLY" | "MONTHLY";

export interface CalendarEventRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  color: string;
  category: string;
  recur_freq: RecurFreq | null;
  recur_interval: number;
  recur_weekdays: number[] | null;
  recur_until: string | null;
  recur_count: number | null;
  exdates: string[];
  series_id: string | null;
  original_date: string | null;
}

/** One thing to draw on the calendar: a single event, a changed occurrence, or one day of a repeating series. */
export interface CalendarOccurrence {
  /** Unique per drawn item: the row id, or `${seriesId}:${date}` for a repeat. */
  occurrenceId: string;
  /** The row to edit: the series for a repeat, otherwise the event itself. */
  eventId: string;
  seriesId: string | null;
  /** Seoul date this occurrence belongs to (the series' own day for a repeat, `original_date` for a changed one). */
  occurrenceDate: string;
  isRecurring: boolean;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  color: string;
  category: string;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Seoul calendar date (YYYY-MM-DD) of an instant. */
export function kstDateOf(instant: Date | string | number): string {
  return new Date(new Date(instant).getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** "2026-10-11T14:30" (or with seconds) read as Seoul wall-clock time -> the instant. A bare date is Seoul midnight. */
export function kstWallToInstant(wall: string): Date {
  const text = wall.length === 10 ? `${wall}T00:00:00` : wall.length === 16 ? `${wall}:00` : wall.slice(0, 19);
  return new Date(`${text}+09:00`);
}

/** The instant as Seoul wall-clock text "YYYY-MM-DDTHH:mm:ss" (what the calendar widget displays). */
export function instantToKstWall(instant: Date | string | number): string {
  return new Date(new Date(instant).getTime() + KST_OFFSET_MS).toISOString().slice(0, 19);
}

export function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function parts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Seoul dates the series occurs on, from its first day up to `limitDate` (inclusive), honouring until/count. */
export function seriesDates(series: Pick<CalendarEventRow, "starts_at" | "recur_freq" | "recur_interval" | "recur_weekdays" | "recur_until" | "recur_count">, limitDate: string): string[] {
  if (!series.recur_freq) return [];
  const first = kstDateOf(series.starts_at);
  const interval = Math.max(1, series.recur_interval || 1);
  const until = series.recur_until && series.recur_until < limitDate ? series.recur_until : limitDate;
  const maxCount = Math.min(series.recur_count ?? MAX_OCCURRENCES_PER_SERIES, MAX_OCCURRENCES_PER_SERIES);
  const dates: string[] = [];
  const push = (date: string): boolean => {
    if (date > until) return false;
    dates.push(date);
    return dates.length < maxCount;
  };

  if (series.recur_freq === "DAILY") {
    for (let date = first; date <= until; date = addDays(date, interval)) if (!push(date)) break;
    return dates;
  }

  if (series.recur_freq === "WEEKLY") {
    const days = series.recur_weekdays && series.recur_weekdays.length > 0 ? [...new Set(series.recur_weekdays)].sort((a, b) => a - b) : [weekday(first)];
    // Weeks start on Sunday; the first week is the one containing the start date.
    const firstWeekStart = addDays(first, -weekday(first));
    for (let weekStart = firstWeekStart; weekStart <= until; weekStart = addDays(weekStart, 7 * interval)) {
      for (const day of days) {
        const date = addDays(weekStart, day);
        if (date < first) continue;
        if (!push(date)) return dates;
      }
    }
    return dates;
  }

  // MONTHLY: the same day number each month; a month without it (the 31st) uses its last day.
  const start = parts(first);
  for (let step = 0; ; step++) {
    const monthIndex = start.month - 1 + step * interval;
    const year = start.year + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const date = `${year}-${pad(month)}-${pad(Math.min(start.day, lastDay))}`;
    if (date > until) break;
    if (!push(date)) break;
  }
  return dates;
}

/**
 * Everything that should be drawn in [rangeStart, rangeEnd): single events, changed occurrences, and every
 * repeat of every series in the window except the days that were deleted or replaced.
 */
export function expandEvents(rows: CalendarEventRow[], range: { start: Date; end: Date }): CalendarOccurrence[] {
  const out: CalendarOccurrence[] = [];
  const startMs = range.start.getTime();
  const endMs = range.end.getTime();
  const overlaps = (a: number, b: number) => a < endMs && (b > startMs || (a === b && a >= startMs));
  const limitDate = kstDateOf(new Date(endMs - 1));

  for (const row of rows) {
    const startsAt = Date.parse(row.starts_at);
    const durationMs = Date.parse(row.ends_at) - startsAt;

    if (!row.recur_freq) {
      if (!overlaps(startsAt, startsAt + durationMs)) continue;
      out.push({
        occurrenceId: row.id,
        eventId: row.id,
        seriesId: row.series_id,
        occurrenceDate: row.original_date ?? kstDateOf(row.starts_at),
        isRecurring: false,
        title: row.title,
        description: row.description,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        allDay: row.all_day,
        color: row.color,
        category: row.category,
      });
      continue;
    }

    const first = kstDateOf(row.starts_at);
    const skipped = new Set(row.exdates);
    for (const date of seriesDates(row, limitDate)) {
      if (skipped.has(date)) continue;
      const shift = daysBetween(first, date) * DAY_MS;
      const occStart = startsAt + shift;
      if (!overlaps(occStart, occStart + durationMs)) continue;
      out.push({
        occurrenceId: `${row.id}:${date}`,
        eventId: row.id,
        seriesId: row.id,
        occurrenceDate: date,
        isRecurring: true,
        title: row.title,
        description: row.description,
        startsAt: new Date(occStart).toISOString(),
        endsAt: new Date(occStart + durationMs).toISOString(),
        allDay: row.all_day,
        color: row.color,
        category: row.category,
      });
    }
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title));
}

/** The next time a series (or single event) happens at or after `from`; used by search results. */
export function nextOccurrenceDate(row: CalendarEventRow, from: Date): string | null {
  if (!row.recur_freq) return kstDateOf(row.starts_at);
  const fromDate = kstDateOf(from);
  const horizon = addDays(fromDate, 366 * 2);
  const skipped = new Set(row.exdates);
  return seriesDates(row, horizon).find((date) => date >= fromDate && !skipped.has(date)) ?? null;
}
