import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  MAX_EVENTS_PER_USER,
  calendarEventInputSchema,
  type CalendarEventInput,
  type CalendarEventView,
  type CalendarSearchHit,
  type EditScope,
  type EventCategory,
  type EventColor,
  type RecurrenceInput,
} from "@/types/calendar-events";
import {
  DAY_MS,
  addDays,
  expandEvents,
  instantToKstWall,
  isValidDateString,
  kstDateOf,
  kstWallToInstant,
  nextOccurrenceDate,
  seriesDates,
  type CalendarEventRow,
  type CalendarOccurrence,
} from "./recurrence";

type Db = SupabaseClient<Database>;
type EventInsert = Database["public"]["Tables"]["calendar_events"]["Insert"];

export type EventResult = { ok: true; id?: string } | { ok: false; error: string };
const fail = (error: string): EventResult => ({ ok: false, error });

/** Largest window one request may ask for: enough for a month grid plus slack, small enough to stay cheap. */
const MAX_WINDOW_DAYS = 120;
const ROW_LIMIT = 1_000;

function recurrenceOf(row: Pick<CalendarEventRow, "recur_freq" | "recur_interval" | "recur_weekdays" | "recur_until" | "recur_count">): RecurrenceInput | null {
  if (!row.recur_freq) return null;
  return {
    freq: row.recur_freq,
    interval: row.recur_interval,
    ...(row.recur_weekdays && row.recur_weekdays.length > 0 ? { weekdays: row.recur_weekdays } : {}),
    ...(row.recur_until ? { until: row.recur_until } : {}),
    ...(row.recur_count ? { count: row.recur_count } : {}),
  };
}

/** Everything the screen needs about one occurrence, in Seoul wall-clock text. */
export function toView(occurrence: CalendarOccurrence, series: CalendarEventRow | undefined): CalendarEventView {
  const wall = (iso: string) => (occurrence.allDay ? instantToKstWall(iso).slice(0, 10) : instantToKstWall(iso));
  return {
    occurrenceId: occurrence.occurrenceId,
    eventId: occurrence.eventId,
    seriesId: occurrence.seriesId,
    occurrenceDate: occurrence.occurrenceDate,
    isRecurring: occurrence.isRecurring,
    title: occurrence.title,
    description: occurrence.description,
    start: wall(occurrence.startsAt),
    end: wall(occurrence.endsAt),
    allDay: occurrence.allDay,
    color: occurrence.color as EventColor,
    category: occurrence.category as EventCategory,
    recurrence: series ? recurrenceOf(series) : null,
  };
}

/** The input's wall-clock times as stored instants (all-day: Seoul midnights, end exclusive). */
export function timesOf(input: Pick<CalendarEventInput, "allDay" | "start" | "end">): { starts_at: string; ends_at: string } {
  return { starts_at: kstWallToInstant(input.start).toISOString(), ends_at: kstWallToInstant(input.end).toISOString() };
}

function recurrenceColumns(recurrence: RecurrenceInput | null): Pick<EventInsert, "recur_freq" | "recur_interval" | "recur_weekdays" | "recur_until" | "recur_count"> {
  if (!recurrence) return { recur_freq: null, recur_interval: 1, recur_weekdays: null, recur_until: null, recur_count: null };
  return {
    recur_freq: recurrence.freq,
    recur_interval: recurrence.interval,
    recur_weekdays: recurrence.freq === "WEEKLY" && recurrence.weekdays && recurrence.weekdays.length > 0 ? [...new Set(recurrence.weekdays)].sort() : null,
    recur_until: recurrence.until ?? null,
    recur_count: recurrence.count ?? null,
  };
}

export function parseEventInput(raw: unknown): { ok: true; input: CalendarEventInput } | { ok: false; error: string } {
  const parsed = calendarEventInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "일정 내용을 확인해주세요." };
  const { input } = { input: parsed.data };
  const { starts_at, ends_at } = timesOf(input);
  if (Number.isNaN(Date.parse(starts_at)) || Number.isNaN(Date.parse(ends_at))) return { ok: false, error: "날짜와 시간을 확인해주세요." };
  if (!isValidDateString(input.start.slice(0, 10)) || !isValidDateString(input.end.slice(0, 10))) return { ok: false, error: "존재하지 않는 날짜예요." };
  if ((Date.parse(ends_at) - Date.parse(starts_at)) / DAY_MS > 366) return { ok: false, error: "일정은 최대 1년까지 만들 수 있어요." };
  return { ok: true, input };
}

async function loadRow(db: Db, userId: string, id: string): Promise<CalendarEventRow | null> {
  const { data, error } = await db.from("calendar_events").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return (data as CalendarEventRow | null) ?? null;
}

/** Events (and their repeats) that touch [startDate, endDate): Seoul dates, end exclusive. */
export async function listEvents(db: Db, userId: string, startDate: string, endDate: string): Promise<CalendarEventView[]> {
  if (!isValidDateString(startDate) || !isValidDateString(endDate) || endDate <= startDate) throw new Error("INVALID_RANGE");
  if ((Date.parse(endDate) - Date.parse(startDate)) / DAY_MS > MAX_WINDOW_DAYS) throw new Error("RANGE_TOO_LARGE");
  const start = kstWallToInstant(startDate);
  const end = kstWallToInstant(endDate);

  const [singles, series] = await Promise.all([
    db.from("calendar_events").select("*").eq("user_id", userId).is("recur_freq", null)
      .lt("starts_at", end.toISOString()).gte("ends_at", start.toISOString()).order("starts_at").limit(ROW_LIMIT),
    db.from("calendar_events").select("*").eq("user_id", userId).not("recur_freq", "is", null)
      .lt("starts_at", end.toISOString()).or(`recur_until.is.null,recur_until.gte.${startDate}`).limit(ROW_LIMIT),
  ]);
  if (singles.error) throw singles.error;
  if (series.error) throw series.error;

  const rows = [...(singles.data ?? []), ...(series.data ?? [])] as CalendarEventRow[];
  const seriesById = new Map((series.data ?? []).map((row) => [row.id, row as CalendarEventRow]));
  return expandEvents(rows, { start, end }).map((occurrence) => toView(occurrence, occurrence.isRecurring ? seriesById.get(occurrence.eventId) : undefined));
}

export async function createEvent(db: Db, userId: string, raw: unknown): Promise<EventResult> {
  const parsed = parseEventInput(raw);
  if (!parsed.ok) return fail(parsed.error);
  const { input } = parsed;

  const { count, error: countError } = await db.from("calendar_events").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (countError) throw countError;
  if ((count ?? 0) >= MAX_EVENTS_PER_USER) return fail(`일정은 최대 ${MAX_EVENTS_PER_USER.toLocaleString()}개까지 만들 수 있어요. 지난 일정을 정리해주세요.`);

  const { data, error } = await db.from("calendar_events").insert({
    user_id: userId,
    title: input.title,
    description: input.description || null,
    all_day: input.allDay,
    color: input.color,
    category: input.category,
    ...timesOf(input),
    ...recurrenceColumns(input.recurrence),
  }).select("id").single();
  if (error || !data) return fail("일정을 저장하지 못했어요. 잠시 후 다시 시도해주세요.");
  return { ok: true, id: data.id };
}

interface TargetParams {
  id: string;
  scope: EditScope;
  /** Seoul date of the occurrence being changed (needed for a repeating series). */
  occurrenceDate?: string;
}

/** Change one event, one day of a series, or a whole series. */
export async function updateEvent(db: Db, userId: string, target: TargetParams, raw: unknown): Promise<EventResult> {
  const parsed = parseEventInput(raw);
  if (!parsed.ok) return fail(parsed.error);
  const { input } = parsed;

  const row = await loadRow(db, userId, target.id);
  if (!row) return fail("일정을 찾을 수 없어요.");
  const fields = {
    title: input.title,
    description: input.description || null,
    all_day: input.allDay,
    color: input.color,
    category: input.category,
    ...timesOf(input),
  };

  // A plain event, or the replacement row of a changed occurrence.
  if (!row.recur_freq) {
    const recurrence = row.series_id ? {} : recurrenceColumns(input.recurrence);
    const { error } = await db.from("calendar_events").update({ ...fields, ...recurrence }).eq("id", row.id).eq("user_id", userId);
    return error ? fail("일정을 수정하지 못했어요. 잠시 후 다시 시도해주세요.") : { ok: true, id: row.id };
  }

  const occurrenceDate = target.occurrenceDate;
  if (!occurrenceDate || !isValidDateString(occurrenceDate)) return fail("반복 일정은 날짜를 함께 알려주세요.");

  if (target.scope === "THIS") {
    if (!seriesDates(row, addDays(occurrenceDate, 1)).includes(occurrenceDate) || row.exdates.includes(occurrenceDate)) return fail("이 날짜에는 반복 일정이 없어요.");
    const { error: replaceError } = await db.from("calendar_events").insert({
      user_id: userId,
      ...fields,
      series_id: row.id,
      original_date: occurrenceDate,
    });
    if (replaceError) return fail("이 일정만 수정하지 못했어요. 잠시 후 다시 시도해주세요.");
    const { error } = await db.from("calendar_events").update({ exdates: [...new Set([...row.exdates, occurrenceDate])].sort() }).eq("id", row.id).eq("user_id", userId);
    return error ? fail("이 일정만 수정하지 못했어요. 잠시 후 다시 시도해주세요.") : { ok: true, id: row.id };
  }

  // ALL: the series moves with the occurrence that was edited (a different date shifts the whole series).
  const firstDate = kstDateOf(row.starts_at);
  const editedDate = input.start.slice(0, 10);
  const shiftDays = Math.round((Date.parse(`${editedDate}T00:00:00Z`) - Date.parse(`${occurrenceDate}T00:00:00Z`)) / DAY_MS);
  const newFirst = addDays(firstDate, shiftDays);
  const timeOfDay = input.allDay ? "" : input.start.slice(10, 16);
  const durationMs = Date.parse(fields.ends_at) - Date.parse(fields.starts_at);
  const newStart = kstWallToInstant(`${newFirst}${timeOfDay}`);

  const recurrence = input.recurrence;
  if (!recurrence) {
    // The repeat was switched off: it becomes one event and its changed days no longer make sense.
    await db.from("calendar_events").delete().eq("series_id", row.id).eq("user_id", userId);
  }
  const { error } = await db.from("calendar_events").update({
    ...fields,
    starts_at: newStart.toISOString(),
    ends_at: new Date(newStart.getTime() + durationMs).toISOString(),
    ...recurrenceColumns(recurrence),
    exdates: recurrence ? row.exdates.map((date) => addDays(date, shiftDays)) : [],
  }).eq("id", row.id).eq("user_id", userId);
  return error ? fail("반복 일정을 수정하지 못했어요. 잠시 후 다시 시도해주세요.") : { ok: true, id: row.id };
}

/** Drag / resize: only the time changes; everything else of the occurrence stays. */
export async function moveEvent(db: Db, userId: string, target: TargetParams, move: { start: string; end: string; allDay: boolean }): Promise<EventResult> {
  const row = await loadRow(db, userId, target.id);
  if (!row) return fail("일정을 찾을 수 없어요.");
  const input = {
    title: row.title,
    description: row.description ?? undefined,
    allDay: move.allDay,
    start: move.start,
    end: move.end,
    color: row.color,
    category: row.category,
    recurrence: recurrenceOf(row),
  };
  return updateEvent(db, userId, target, input);
}

export async function deleteEvent(db: Db, userId: string, target: TargetParams): Promise<EventResult> {
  const row = await loadRow(db, userId, target.id);
  if (!row) return fail("일정을 찾을 수 없어요.");

  if (row.recur_freq && target.scope === "THIS") {
    const date = target.occurrenceDate;
    if (!date || !isValidDateString(date)) return fail("반복 일정은 날짜를 함께 알려주세요.");
    const { error } = await db.from("calendar_events").update({ exdates: [...new Set([...row.exdates, date])].sort() }).eq("id", row.id).eq("user_id", userId);
    return error ? fail("일정을 삭제하지 못했어요. 잠시 후 다시 시도해주세요.") : { ok: true };
  }

  // A single event, a changed occurrence (its day stays hidden: the series already lists it as replaced) or a whole series.
  const { error } = await db.from("calendar_events").delete().eq("id", row.id).eq("user_id", userId);
  return error ? fail("일정을 삭제하지 못했어요. 잠시 후 다시 시도해주세요.") : { ok: true };
}

/** Characters that could change the meaning of a PostgREST filter value; a search never needs them. */
function cleanQuery(query: string): string {
  return query.replace(/[%_*,()\\"'`:;]/g, " ").replace(/\s+/g, " ").trim().slice(0, 50);
}

export async function searchEvents(db: Db, userId: string, rawQuery: string, now: Date = new Date()): Promise<CalendarSearchHit[]> {
  const query = cleanQuery(rawQuery);
  if (query.length < 1) return [];
  const { data, error } = await db.from("calendar_events").select("*").eq("user_id", userId)
    .or(`title.ilike.%${query}%,description.ilike.%${query}%`).order("starts_at", { ascending: false }).limit(40);
  if (error) throw error;

  const today = kstDateOf(now);
  const hits: CalendarSearchHit[] = [];
  for (const row of (data ?? []) as CalendarEventRow[]) {
    // For a repeating series jump to its next day; once it is over (or for a one-off in the past) jump to its first/own day.
    const date = row.recur_freq ? (nextOccurrenceDate(row, now) ?? kstDateOf(row.starts_at)) : kstDateOf(row.starts_at);
    hits.push({ eventId: row.id, title: row.title, date, allDay: row.all_day, isRecurring: Boolean(row.recur_freq) });
  }
  // Upcoming first, then the most recent past ones.
  return hits.sort((a, b) => (a.date >= today ? 0 : 1) - (b.date >= today ? 0 : 1) || (a.date >= today ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date))).slice(0, 30);
}
