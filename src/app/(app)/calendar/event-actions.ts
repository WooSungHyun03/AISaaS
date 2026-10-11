"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { isMissingSchemaError } from "@/server/shared/db-errors";
import { createEvent, deleteEvent, listEvents, moveEvent, searchEvents, updateEvent, type EventResult } from "@/server/calendar/events";
import type { CalendarEventView, CalendarSearchHit, EditScope } from "@/types/calendar-events";
import type { CalendarItem } from "@/types/domain";

const idSchema = z.string().uuid();
const scopeSchema = z.enum(["THIS", "FOLLOWING", "ALL"]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export interface CalendarRangeResult {
  events: CalendarEventView[];
  /** Marketing plan items (AI plan) in the same window, for the owner's businesses. Empty without a business. */
  planItems: CalendarItem[];
  error?: string;
}

export interface CalendarEventActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

async function authed() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { supabase, userId: user.id } : null;
}

function toActionResult(result: EventResult): CalendarEventActionResult {
  return result.ok ? { ok: true, id: result.id } : { ok: false, error: result.error };
}

const FAILURE = "일정을 처리하지 못했어요. 잠시 후 다시 시도해주세요.";

/** Everything to draw between two Seoul dates (end exclusive): the owner's events plus any marketing plan items. */
export async function listCalendarRange(startDate: string, endDate: string): Promise<CalendarRangeResult> {
  const session = await authed();
  if (!session) return { events: [], planItems: [], error: "로그인이 필요합니다." };
  if (!dateSchema.safeParse(startDate).success || !dateSchema.safeParse(endDate).success) return { events: [], planItems: [], error: "기간이 올바르지 않아요." };

  try {
    const [events, plan] = await Promise.all([
      listEvents(session.supabase, session.userId, startDate, endDate),
      // RLS limits calendar_items to the owner's businesses; a user with no business simply gets none.
      session.supabase.from("calendar_items").select("*").gte("planned_date", startDate).lt("planned_date", endDate).order("planned_date").limit(500),
    ]);
    // The plan table is newer than this screen; if it cannot be read the calendar still works.
    return { events, planItems: plan.error ? [] : (plan.data ?? []) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "RANGE_TOO_LARGE") return { events: [], planItems: [], error: "한 번에 볼 수 있는 기간을 넘었어요." };
    const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : undefined;
    logger.error("calendar_list_failed", { code, message: error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error) });
    // calendar_events comes from migration 0061: until it is applied, say so instead of "try again later".
    if (isMissingSchemaError(error)) return { events: [], planItems: [], error: "캘린더를 준비하는 중이에요. 서비스 관리자가 데이터베이스 업데이트를 마치면 바로 쓸 수 있어요." };
    return { events: [], planItems: [], error: "일정을 불러오지 못했어요. 잠시 후 다시 시도해주세요." };
  }
}

export async function createCalendarEvent(input: unknown): Promise<CalendarEventActionResult> {
  const session = await authed();
  if (!session) return { ok: false, error: "로그인이 필요합니다." };
  try {
    return toActionResult(await createEvent(session.supabase, session.userId, input));
  } catch (error) {
    logger.error("calendar_create_failed", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: FAILURE };
  }
}

export async function updateCalendarEvent(id: string, scope: EditScope, occurrenceDate: string | undefined, input: unknown): Promise<CalendarEventActionResult> {
  const session = await authed();
  if (!session) return { ok: false, error: "로그인이 필요합니다." };
  if (!idSchema.safeParse(id).success || !scopeSchema.safeParse(scope).success) return { ok: false, error: "잘못된 요청이에요." };
  try {
    return toActionResult(await updateEvent(session.supabase, session.userId, { id, scope, occurrenceDate }, input));
  } catch (error) {
    logger.error("calendar_update_failed", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: FAILURE };
  }
}

/** Dragging or resizing an event on the calendar. */
export async function moveCalendarEvent(id: string, scope: EditScope, occurrenceDate: string | undefined, move: { start: string; end: string; allDay: boolean }): Promise<CalendarEventActionResult> {
  const session = await authed();
  if (!session) return { ok: false, error: "로그인이 필요합니다." };
  if (!idSchema.safeParse(id).success || !scopeSchema.safeParse(scope).success) return { ok: false, error: "잘못된 요청이에요." };
  try {
    return toActionResult(await moveEvent(session.supabase, session.userId, { id, scope, occurrenceDate }, move));
  } catch (error) {
    logger.error("calendar_move_failed", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: FAILURE };
  }
}

export async function deleteCalendarEvent(id: string, scope: EditScope, occurrenceDate?: string): Promise<CalendarEventActionResult> {
  const session = await authed();
  if (!session) return { ok: false, error: "로그인이 필요합니다." };
  if (!idSchema.safeParse(id).success || !scopeSchema.safeParse(scope).success) return { ok: false, error: "잘못된 요청이에요." };
  try {
    return toActionResult(await deleteEvent(session.supabase, session.userId, { id, scope, occurrenceDate }));
  } catch (error) {
    logger.error("calendar_delete_failed", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: FAILURE };
  }
}

export async function searchCalendarEvents(query: string): Promise<{ hits: CalendarSearchHit[]; error?: string }> {
  const session = await authed();
  if (!session) return { hits: [], error: "로그인이 필요합니다." };
  try {
    return { hits: await searchEvents(session.supabase, session.userId, String(query ?? "")) };
  } catch (error) {
    logger.error("calendar_search_failed", { message: error instanceof Error ? error.message : String(error) });
    return { hits: [], error: "검색하지 못했어요. 잠시 후 다시 시도해주세요." };
  }
}
