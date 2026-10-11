"use client";

import { useState, useTransition } from "react";
import { Loader2, Repeat, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
} from "@/app/(app)/calendar/event-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  EVENT_CATEGORIES,
  EVENT_CATEGORY_COLOR,
  EVENT_CATEGORY_LABEL,
  EVENT_COLORS,
  EVENT_COLOR_LABEL,
  EVENT_DESCRIPTION_MAX,
  EVENT_TITLE_MAX,
  calendarEventInputSchema,
  type CalendarEventView,
  type EditScope,
  type EventCategory,
  type EventColor,
} from "@/types/calendar-events";
import { EVENT_COLOR_HEX } from "./palette";
import { toInput, valuesFromView, type EditorValues } from "./event-form-model";

export type EditorState = { mode: "create"; values: EditorValues } | { mode: "edit"; view: CalendarEventView };

const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function ScopeChoice({ value, onChange, verb }: { value: EditScope; onChange: (scope: EditScope) => void; verb: string }) {
  return (
    <fieldset className="space-y-2 rounded-xl border bg-muted/40 p-3">
      <legend className="px-1 text-sm font-semibold">반복 일정 {verb} 범위</legend>
      {([["THIS", "이 일정만"], ["ALL", "모든 반복 일정"]] as const).map(([scope, label]) => (
        <label key={scope} className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="radio" name={`scope-${verb}`} checked={value === scope} onChange={() => onChange(scope)} className="size-4 accent-[var(--primary)]" />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

/** Create or change one event (or one day / the whole of a repeating one). Everything is validated twice: here for instant feedback, on the server for real. */
export function EventEditorDialog({ state, onClose, onSaved }: { state: EditorState | null; onClose: () => void; onSaved: () => void }) {
  // The parent re-keys this component for every opening, so each event starts from its own values.
  const [values, setValues] = useState<EditorValues | null>(() => (state ? (state.mode === "create" ? state.values : valuesFromView(state.view)) : null));
  const [scope, setScope] = useState<EditScope>("THIS");
  const [colorTouched, setColorTouched] = useState(state?.mode === "edit");
  const [error, setError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!state || !values) return null;
  const editing = state.mode === "edit" ? state.view : null;
  const isRepeating = Boolean(editing?.isRecurring);
  const update = (patch: Partial<EditorValues>) => setValues((current) => (current ? { ...current, ...patch } : current));

  function submit() {
    if (!values) return;
    const input = toInput(values);
    const checked = calendarEventInputSchema.safeParse(input);
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? "입력 내용을 확인해주세요.");
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        const result = editing
          ? await updateCalendarEvent(editing.eventId, isRepeating ? scope : "ALL", editing.occurrenceDate, input)
          : await createCalendarEvent(input);
        if (!result.ok) {
          setError(result.error ?? "저장하지 못했어요.");
          return;
        }
        toast.success(editing ? "일정을 수정했어요." : "일정을 만들었어요.");
        onSaved();
        onClose();
      } catch {
        setError("저장하지 못했어요. 잠시 후 다시 시도해주세요.");
      }
    });
  }

  function remove() {
    if (!editing) return;
    startTransition(async () => {
      try {
        const result = await deleteCalendarEvent(editing.eventId, isRepeating ? scope : "ALL", editing.occurrenceDate);
        if (!result.ok) {
          setError(result.error ?? "삭제하지 못했어요.");
          return;
        }
        toast.success("일정을 삭제했어요.");
        onSaved();
        onClose();
      } catch {
        setError("삭제하지 못했어요. 잠시 후 다시 시도해주세요.");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !isPending) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "일정 수정" : "새 일정"}</DialogTitle>
          <DialogDescription>한국 시간(서울) 기준이에요.</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => { event.preventDefault(); submit(); }}
          className="space-y-4"
          aria-describedby={error ? "event-error" : undefined}
        >
          <div className="space-y-2">
            <Label htmlFor="event-title">제목</Label>
            <Input id="event-title" value={values.title} onChange={(event) => update({ title: event.target.value })} maxLength={EVENT_TITLE_MAX} placeholder="일정 제목" autoFocus required disabled={isPending} />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5">
            <Label htmlFor="event-allday" className="cursor-pointer">종일</Label>
            <Switch id="event-allday" checked={values.allDay} onCheckedChange={(checked) => update({ allDay: checked })} disabled={isPending} />
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="event-start-date">시작</Label>
              <div className="flex gap-2">
                <Input id="event-start-date" type="date" value={values.startDate} onChange={(event) => update({ startDate: event.target.value, ...(values.endDate < event.target.value ? { endDate: event.target.value } : {}) })} required disabled={isPending} className="min-w-0 flex-1" />
                {!values.allDay ? <Input aria-label="시작 시간" type="time" value={values.startTime} onChange={(event) => update({ startTime: event.target.value })} required disabled={isPending} className="w-36 shrink-0" /> : null}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-end-date">종료</Label>
              <div className="flex gap-2">
                <Input id="event-end-date" type="date" value={values.endDate} min={values.startDate} onChange={(event) => update({ endDate: event.target.value })} required disabled={isPending} className="min-w-0 flex-1" />
                {!values.allDay ? <Input aria-label="종료 시간" type="time" value={values.endTime} onChange={(event) => update({ endTime: event.target.value })} required disabled={isPending} className="w-36 shrink-0" /> : null}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="event-category">분류</Label>
              <NativeSelect
                id="event-category"
                value={values.category}
                onChange={(event) => {
                  const category = event.target.value as EventCategory;
                  update({ category, ...(colorTouched ? {} : { color: EVENT_CATEGORY_COLOR[category] }) });
                }}
                disabled={isPending}
              >
                {EVENT_CATEGORIES.map((category) => <option key={category} value={category}>{EVENT_CATEGORY_LABEL[category]}</option>)}
              </NativeSelect>
            </div>
            <fieldset className="space-y-2" disabled={isPending}>
              <legend className="text-sm leading-none font-medium">색상</legend>
              <div className="flex h-11 items-center gap-2" role="radiogroup" aria-label="일정 색상">
                {EVENT_COLORS.map((color: EventColor) => (
                  <label key={color} title={EVENT_COLOR_LABEL[color]} className={cn("flex size-8 cursor-pointer items-center justify-center rounded-full border-2 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40", values.color === color ? "border-foreground" : "border-transparent")}>
                    <input type="radio" name="event-color" value={color} checked={values.color === color} onChange={() => { setColorTouched(true); update({ color }); }} className="sr-only" />
                    <span className="size-5 rounded-full" style={{ backgroundColor: EVENT_COLOR_HEX[color] }} />
                    <span className="sr-only">{EVENT_COLOR_LABEL[color]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="space-y-3 rounded-xl border p-3.5">
            <div className="space-y-2">
              <Label htmlFor="event-repeat" className="flex items-center gap-1.5"><Repeat className="size-3.5" aria-hidden="true" />반복</Label>
              <NativeSelect id="event-repeat" value={values.repeat} onChange={(event) => update({ repeat: event.target.value as EditorValues["repeat"] })} disabled={isPending}>
                <option value="NONE">반복 안 함</option>
                <option value="DAILY">매일</option>
                <option value="WEEKLY">매주</option>
                <option value="MONTHLY">매월</option>
              </NativeSelect>
            </div>
            {values.repeat !== "NONE" ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Input aria-label="반복 간격" type="number" min={1} max={52} value={values.interval} onChange={(event) => update({ interval: Math.max(1, Math.min(52, Number(event.target.value) || 1)) })} disabled={isPending} className="w-20" />
                  <span>{values.repeat === "DAILY" ? "일마다" : values.repeat === "WEEKLY" ? "주마다" : "개월마다"}</span>
                </div>
                {values.repeat === "WEEKLY" ? (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="반복 요일">
                    {WEEKDAY_NAMES.map((name, day) => {
                      const on = values.weekdays.includes(day);
                      return (
                        <button
                          key={name}
                          type="button"
                          aria-pressed={on}
                          disabled={isPending}
                          onClick={() => update({ weekdays: on ? values.weekdays.filter((item) => item !== day) : [...values.weekdays, day] })}
                          className={cn("size-9 cursor-pointer rounded-full border text-sm font-semibold transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-muted-foreground hover:border-primary/40")}
                        >
                          {name}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <NativeSelect aria-label="반복 종료" value={values.endMode} onChange={(event) => update({ endMode: event.target.value as EditorValues["endMode"] })} disabled={isPending} className="w-36">
                    <option value="NEVER">계속 반복</option>
                    <option value="UNTIL">종료일까지</option>
                  </NativeSelect>
                  {values.endMode === "UNTIL" ? <Input aria-label="반복 종료일" type="date" value={values.until} min={values.startDate} onChange={(event) => update({ until: event.target.value })} required disabled={isPending} className="w-44" /> : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="event-description">설명 <span className="font-normal text-muted-foreground">(선택)</span></Label>
            <Textarea id="event-description" value={values.description} onChange={(event) => update({ description: event.target.value })} maxLength={EVENT_DESCRIPTION_MAX} rows={3} disabled={isPending} />
          </div>

          {isRepeating && !confirmingDelete ? <ScopeChoice value={scope} onChange={setScope} verb="수정" /> : null}
          {error ? <FormMessage id="event-error">{error}</FormMessage> : null}

          {confirmingDelete ? (
            <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/[0.04] p-3.5">
              <p className="text-sm font-semibold">이 일정을 삭제할까요? 되돌릴 수 없어요.</p>
              {isRepeating ? <ScopeChoice value={scope} onChange={setScope} verb="삭제" /> : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setConfirmingDelete(false)} disabled={isPending}>취소</Button>
                <Button type="button" variant="destructive" onClick={remove} disabled={isPending}>{isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}삭제하기</Button>
              </div>
            </div>
          ) : (
            <DialogFooter className="gap-2">
              {editing ? (
                <Button type="button" variant="ghost" className="text-destructive hover:text-destructive sm:mr-auto" onClick={() => setConfirmingDelete(true)} disabled={isPending}>
                  <Trash2 aria-hidden="true" />삭제
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>취소</Button>
              <Button type="submit" disabled={isPending}>{isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}{isPending ? "저장하는 중…" : "저장"}</Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
