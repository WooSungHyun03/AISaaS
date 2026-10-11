"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import koLocale from "@fullcalendar/core/locales/ko";
import type { DatesSetArg, EventClickArg, EventDropArg, DateSelectArg, EventInput, EventSourceFuncArg } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import { CalendarPlus, ChevronLeft, ChevronRight, Loader2, Repeat, Search } from "lucide-react";
import { toast } from "sonner";
import { listCalendarRange, moveCalendarEvent, searchCalendarEvents } from "@/app/(app)/calendar/event-actions";
import { CalendarItemDialog } from "@/components/marketing/calendar-item-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CalendarEventView, CalendarSearchHit, EditScope } from "@/types/calendar-events";
import type { CalendarItem } from "@/types/domain";
import { EventEditorDialog, type EditorState } from "./event-editor-dialog";
import { describeRecurrence, valuesForNew } from "./event-form-model";
import { EVENT_COLOR_HEX } from "./palette";

const VIEWS = [
  { value: "dayGridMonth", label: "월" },
  { value: "timeGridWeek", label: "주" },
  { value: "timeGridDay", label: "일" },
  { value: "listMonth", label: "목록" },
] as const;
type ViewName = (typeof VIEWS)[number]["value"];

const SEOUL_OFFSET_MS = 9 * 3_600_000;
/** The widget runs in "UTC" mode so it never applies the browser's zone; feeding it Seoul wall-clock text keeps every screen on Korean time. */
const seoulNow = () => new Date(Date.now() + SEOUL_OFFSET_MS);
const wall = (date: Date) => date.toISOString().slice(0, 19);
const day = (date: Date) => date.toISOString().slice(0, 10);

type Extended = { kind: "event"; view: CalendarEventView } | { kind: "plan"; item: CalendarItem };

const PLAN_PLATFORM: Record<string, string> = { blog: "블로그", instagram_reels: "인스타 릴스", youtube_shorts: "유튜브 쇼츠" };

function eventInput(view: CalendarEventView): EventInput {
  const color = EVENT_COLOR_HEX[view.color] ?? EVENT_COLOR_HEX.blue;
  return {
    id: view.occurrenceId,
    title: view.title,
    start: view.start,
    end: view.end,
    allDay: view.allDay,
    backgroundColor: color,
    borderColor: color,
    textColor: "#ffffff",
    extendedProps: { kind: "event", view } satisfies Extended,
  };
}

function planInput(item: CalendarItem): EventInput {
  return {
    id: `plan:${item.id}`,
    title: item.topic,
    start: item.planned_date,
    allDay: true,
    editable: false,
    classNames: ["ev-plan", item.status === "SKIPPED" ? "ev-plan-skipped" : item.status === "PLANNED" ? "" : "ev-plan-done"],
    extendedProps: { kind: "plan", item } satisfies Extended,
  };
}

/** What dragging or resizing produced, as the input the server action takes. */
function movedTimes(event: { start: Date | null; end: Date | null; allDay: boolean }, previousDurationMs: number): { start: string; end: string; allDay: boolean } | null {
  if (!event.start) return null;
  if (event.allDay) {
    const end = event.end ?? new Date(event.start.getTime() + 86_400_000);
    return { start: day(event.start), end: day(end), allDay: true };
  }
  const end = event.end ?? new Date(event.start.getTime() + (previousDurationMs > 0 ? previousDurationMs : 3_600_000));
  return { start: wall(event.start).slice(0, 16), end: wall(end).slice(0, 16), allDay: false };
}

export function CalendarWorkspace() {
  const calendarRef = useRef<FullCalendar | null>(null);
  // This component only renders in the browser, so the screen size can decide the first view:
  // phones get the agenda list, because a month grid of seven narrow columns is hard to read there.
  const [initialView] = useState<ViewName>(() => (window.matchMedia("(max-width: 640px)").matches ? "listMonth" : "dayGridMonth"));
  const [view, setView] = useState<ViewName>(initialView);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [editor, setEditorState] = useState<EditorState | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const setEditor = (next: EditorState | null) => {
    setEditorState(next);
    if (next) setEditorKey((key) => key + 1);
  };
  const [planItem, setPlanItem] = useState<CalendarItem | null>(null);
  const [pendingMove, setPendingMove] = useState<{ view: CalendarEventView; times: { start: string; end: string; allDay: boolean }; revert: () => void } | null>(null);
  const [hasPlanItems, setHasPlanItems] = useState(false);
  const lastOpened = useRef(0);

  const api = () => calendarRef.current?.getApi();
  const refetch = useCallback(() => api()?.refetchEvents(), []);

  const fetchEvents = useCallback(async (arg: EventSourceFuncArg, success: (events: EventInput[]) => void, failure: (error: Error) => void) => {
    setLoading(true);
    try {
      const result = await listCalendarRange(day(arg.start), day(arg.end));
      if (result.error) throw new Error(result.error);
      setHasPlanItems(result.planItems.length > 0);
      success([...result.events.map(eventInput), ...result.planItems.map(planInput)]);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "일정을 불러오지 못했어요.");
      failure(error instanceof Error ? error : new Error("load failed"));
    } finally {
      setLoading(false);
    }
  }, []);

  function openCreate(start: string, end: string | undefined, allDay: boolean) {
    // select and dateClick both fire for one click; open the editor once.
    if (Date.now() - lastOpened.current < 400) return;
    lastOpened.current = Date.now();
    setEditor({ mode: "create", values: valuesForNew(start, end, allDay) });
  }

  function onSelect(info: DateSelectArg) {
    api()?.unselect();
    if (info.view.type === "dayGridMonth" && info.allDay) {
      // A click on a month cell: a timed event that day (the usual quick add); a drag over several days: all-day.
      const days = (info.end.getTime() - info.start.getTime()) / 86_400_000;
      if (days <= 1) openCreate(`${day(info.start)}T09:00:00`, undefined, false);
      else openCreate(day(info.start), day(info.end), true);
      return;
    }
    openCreate(info.allDay ? day(info.start) : wall(info.start), info.allDay ? day(info.end) : wall(info.end), info.allDay);
  }

  function onEventClick(info: EventClickArg) {
    info.jsEvent.preventDefault();
    const extended = info.event.extendedProps as Extended;
    if (extended.kind === "plan") setPlanItem(extended.item);
    else setEditor({ mode: "edit", view: extended.view });
  }

  async function commitMove(view: CalendarEventView, times: { start: string; end: string; allDay: boolean }, scope: EditScope, revert: () => void) {
    try {
      const result = await moveCalendarEvent(view.eventId, scope, view.occurrenceDate, times);
      if (!result.ok) {
        toast.error(result.error ?? "일정을 옮기지 못했어요.");
        revert();
        return;
      }
      toast.success("일정을 옮겼어요.");
    } catch {
      toast.error("일정을 옮기지 못했어요. 잠시 후 다시 시도해주세요.");
      revert();
    }
    refetch();
  }

  function onMove(info: EventDropArg | EventResizeDoneArg) {
    const extended = info.event.extendedProps as Extended;
    if (extended.kind !== "event") {
      info.revert();
      return;
    }
    const previousDuration = extended.view.allDay ? 0 : Date.parse(`${extended.view.end}Z`) - Date.parse(`${extended.view.start}Z`);
    const times = movedTimes(info.event, previousDuration);
    if (!times) {
      info.revert();
      return;
    }
    if (extended.view.isRecurring) {
      setPendingMove({ view: extended.view, times, revert: info.revert });
      return;
    }
    void commitMove(extended.view, times, "ALL", info.revert);
  }

  // ---- search -----------------------------------------------------------
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CalendarSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const text = query.trim();
    if (!text) return;
    const timer = window.setTimeout(async () => {
      const result = await searchCalendarEvents(text);
      setSearching(false);
      if (result.error) toast.error(result.error);
      setHits(result.hits);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  function onQueryChange(value: string) {
    setQuery(value);
    const empty = value.trim().length === 0;
    setSearching(!empty);
    if (empty) setHits(null);
  }

  function jumpTo(hit: CalendarSearchHit) {
    api()?.gotoDate(hit.date);
    onQueryChange("");
  }

  function changeView(next: ViewName) {
    setView(next);
    api()?.changeView(next);
  }

  function onDatesSet(info: DatesSetArg) {
    setTitle(info.view.title);
    setView(info.view.type as ViewName);
  }

  return (
    <section aria-label="내 캘린더" className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => api()?.today()}>오늘</Button>
          <Button type="button" variant="outline" size="icon-sm" aria-label="이전" onClick={() => api()?.prev()}><ChevronLeft aria-hidden="true" /></Button>
          <Button type="button" variant="outline" size="icon-sm" aria-label="다음" onClick={() => api()?.next()}><ChevronRight aria-hidden="true" /></Button>
          <h2 className="ml-1 min-w-0 text-lg font-extrabold tracking-[-0.03em] sm:text-xl" aria-live="polite">{title}</h2>
          {loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="불러오는 중" /> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-muted p-1" role="group" aria-label="보기 방식">
            {VIEWS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={view === item.value}
                onClick={() => changeView(item.value)}
                className={cn("min-h-8 cursor-pointer rounded-md px-3 text-sm font-semibold transition-colors", view === item.value ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {item.label}
              </button>
            ))}
          </div>
          <Button type="button" onClick={() => setEditor({ mode: "create", values: valuesForNew(`${day(seoulNow())}T${String(seoulNow().getUTCHours() + 1).padStart(2, "0")}:00:00`) })}>
            <CalendarPlus aria-hidden="true" /> 일정 추가
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="일정 검색 (제목·설명)"
          aria-label="일정 검색"
          maxLength={50}
          className="pl-10"
        />
        {hits !== null ? (
          <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg" role="listbox" aria-label="검색 결과">
            {searching ? <p className="px-3 py-2 text-sm text-muted-foreground">검색하는 중…</p> : null}
            {!searching && hits.length === 0 ? <p className="px-3 py-3 text-sm text-muted-foreground">검색 결과가 없어요.</p> : null}
            {hits.map((hit) => (
              <button key={`${hit.eventId}:${hit.date}`} type="button" role="option" aria-selected="false" onClick={() => jumpTo(hit)} className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent">
                <span className="flex min-w-0 items-center gap-1.5 truncate font-semibold">{hit.isRecurring ? <Repeat className="size-3.5 shrink-0 text-muted-foreground" aria-label="반복" /> : null}<span className="truncate">{hit.title}</span></span>
                <span className="tabular shrink-0 text-[13px] text-muted-foreground">{hit.date.replaceAll("-", ".")}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="calendar-surface overflow-hidden rounded-2xl border bg-card p-2 sm:p-3">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView={initialView}
          headerToolbar={false}
          locales={[koLocale]}
          locale="ko"
          timeZone="UTC"
          now={seoulNow}
          firstDay={0}
          height={view === "timeGridWeek" || view === "timeGridDay" ? 640 : "auto"}
          fixedWeekCount={false}
          dayMaxEvents={3}
          eventDisplay="block"
          nowIndicator
          selectable
          selectMirror
          editable
          eventResizableFromStart
          slotDuration="00:30:00"
          scrollTime="08:00:00"
          allDayText="종일"
          eventTimeFormat={{ hour: "numeric", minute: "2-digit", hour12: false }}
          slotLabelFormat={{ hour: "numeric", minute: "2-digit", hour12: false }}
          dayCellContent={(arg) => arg.dayNumberText.replace("일", "")}
          events={fetchEvents}
          datesSet={onDatesSet}
          select={onSelect}
          dateClick={(info) => {
            if (info.view.type === "dayGridMonth") openCreate(`${info.dateStr}T09:00:00`, undefined, false);
            else openCreate(info.allDay ? info.dateStr : wall(info.date), undefined, info.allDay);
          }}
          eventClick={onEventClick}
          eventDrop={onMove}
          eventResize={onMove}
          eventContent={(arg) => {
            const extended = arg.event.extendedProps as Extended;
            if (extended.kind === "event" && extended.view.isRecurring) {
              return (
                <div className="fc-event-main-frame">
                  {arg.timeText ? <div className="fc-event-time">{arg.timeText}</div> : null}
                  <div className="fc-event-title-container"><div className="fc-event-title fc-sticky"><Repeat className="mr-1 inline size-3" aria-label="반복 일정" />{arg.event.title}</div></div>
                </div>
              );
            }
            if (extended.kind === "plan") {
              return <div className="fc-event-title fc-sticky truncate px-1">📝 {PLAN_PLATFORM[extended.item.platform] ?? "콘텐츠"} · {arg.event.title}</div>;
            }
            return true;
          }}
        />
      </div>

      {hasPlanItems ? <p className="text-[13px] text-muted-foreground">📝 점선 표시는 AI가 짜준 마케팅 계획이에요. 눌러서 바로 콘텐츠로 만들 수 있어요. 내 일정은 끌어서 옮길 수 있어요.</p> : <p className="text-[13px] text-muted-foreground">날짜를 누르면 일정을 만들 수 있고, 일정을 끌어서 옮기거나 늘릴 수 있어요. 모든 시간은 한국 시간(서울)이에요.</p>}

      <EventEditorDialog key={editorKey} state={editor} onClose={() => setEditor(null)} onSaved={refetch} />
      {planItem ? <CalendarItemDialog item={planItem} open onOpenChange={(open) => { if (!open) { setPlanItem(null); refetch(); } }} /> : null}

      <Dialog open={pendingMove !== null} onOpenChange={(open) => { if (!open && pendingMove) { pendingMove.revert(); setPendingMove(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>반복 일정을 옮길까요?</DialogTitle>
            <DialogDescription>{pendingMove ? `“${pendingMove.view.title}” (${pendingMove.view.recurrence ? describeRecurrence(pendingMove.view.recurrence.freq, pendingMove.view.recurrence.interval, pendingMove.view.recurrence.weekdays) : "반복"})` : ""}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:flex-col sm:items-stretch">
            <Button type="button" onClick={() => { if (pendingMove) { void commitMove(pendingMove.view, pendingMove.times, "THIS", pendingMove.revert); setPendingMove(null); } }}>이 일정만 옮기기</Button>
            <Button type="button" variant="outline" onClick={() => { if (pendingMove) { void commitMove(pendingMove.view, pendingMove.times, "FOLLOWING", pendingMove.revert); setPendingMove(null); } }}>이 일정과 이후 일정 옮기기</Button>
            <Button type="button" variant="outline" onClick={() => { if (pendingMove) { void commitMove(pendingMove.view, pendingMove.times, "ALL", pendingMove.revert); setPendingMove(null); } }}>모든 반복 일정 옮기기</Button>
            <Button type="button" variant="ghost" onClick={() => { pendingMove?.revert(); setPendingMove(null); }}>취소</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
