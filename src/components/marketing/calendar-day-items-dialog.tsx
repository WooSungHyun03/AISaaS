"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CalendarItemDialog } from "@/components/marketing/calendar-item-dialog";
import type { CalendarItem } from "@/types/domain";

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];

function formatDayLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = WEEKDAYS[(new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7];
  return `${month}월 ${day}일 · ${weekday}요일`;
}

/**
 * The month grid cell only ever renders the first 3 items for a day
 * (CalendarDay in page.tsx) — before this, the 4th+ item had no way to be
 * opened on a wide screen at all, just an inert "+N개 더 있어요" label
 * (ticket 1-9). This makes that label a trigger for a dialog listing every
 * item for the day, each still opening its own full CalendarItemDialog —
 * same nested-dialog pattern already used elsewhere in this app (e.g. the
 * delete confirmation inside CalendarItemDialog itself).
 */
export function CalendarDayItemsDialog({ dateKey, items }: { dateKey: string; items: CalendarItem[] }) {
  const [open, setOpen] = useState(false);
  const overflow = items.length - 3;
  if (overflow <= 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="block w-full rounded-md px-1 py-0.5 text-left text-[11px] font-semibold text-primary hover:underline">
          +{overflow}개 더 있어요
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{formatDayLabel(dateKey)}</DialogTitle>
          <DialogDescription>이 날의 콘텐츠 계획 {items.length}건</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {items.map((item) => <CalendarItemDialog key={item.id} item={item} variant="card" />)}
        </div>
      </DialogContent>
    </Dialog>
  );
}
